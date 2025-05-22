import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ConversationChain } from "langchain/chains"; // LLMChain は不要
import { BufferWindowMemory } from "langchain/memory";
import { PromptTemplate } from "@langchain/core/prompts";

// 環境変数
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;

// グローバルスコープでの初期化
let supabase;
let embeddings;
let chatModel;
let memoGenerationChain; // memory も内部で初期化またはここで保持

// 初期化関数
function initializeClientsAndChains() {
  if (!supabaseUrl || !supabaseAnonKey || !geminiApiKey) {
    console.error("エラー: 必要な環境変数 (SUPABASE_URL, SUPABASE_ANON_KEY, GEMINI_API_KEY) が設定されていません。");
    throw new Error("サーバー設定エラー: APIキーが不足しています。");
  }

  if (!supabase) {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
  }
  if (!embeddings) {
    embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: geminiApiKey,
      model: "text-embedding-004",
    });
  }
  if (!chatModel) {
    chatModel = new ChatGoogleGenerativeAI({
        apiKey: geminiApiKey,
        model: "gemini-2.5-flash-preview-05-20",
        temperature: 0.4,
    });
  }

  // --- メモ生成用LLMの準備 ---
  if (!memoGenerationChain) {
    const memoGenerationMemory = new BufferWindowMemory({
        memoryKey: "memo_history",
        inputKey: "user_input", 
        k: 1, 
    });

    const memoGenerationPromptTemplateString = `
あなたは、提供された「参照情報」と「作成指示」に基づいて、高品質で実用的な「成果物メモ」を生成する、高度な執筆AIアシスタントです。

以下の「作成指示」に厳密に従ってください。
そして、「参照情報」を最大限に活用し、具体的で有用な情報を含んだメモを作成してください。

作成指示:
{crafted_instruction}

これまでの会話履歴:
{memo_history}

参照情報:
{context}

上記を全て考慮し、「作成指示」で指定された形式と言語で、成果物メモを生成してください。
成果物メモのみを出力し、それ以外の前置きや説明は一切不要です。

あなたの成果物メモ:
`;
    const memoGenerationPromptTemplate = PromptTemplate.fromTemplate(memoGenerationPromptTemplateString);

    memoGenerationChain = new ConversationChain({
        llm: chatModel,
        memory: memoGenerationMemory,
        prompt: memoGenerationPromptTemplate,
        outputKey: "generated_memo",
    });
  }
}

export async function POST(request) {
  try {
    initializeClientsAndChains();

    const { crafted_prompt: craftedPrompt, source_filenames: sourceFilenames } = await request.json();

    if (!craftedPrompt || typeof craftedPrompt !== 'string' || craftedPrompt.trim() === '') {
      return NextResponse.json({ error: 'メモ作成指示 (crafted_prompt) が必要です。' }, { status: 400 });
    }
    if (!Array.isArray(sourceFilenames) || !sourceFilenames.every(item => typeof item === 'string' && item.trim() !== '')) {
      return NextResponse.json({ error: '参照ファイル群 (source_filenames) は文字列の配列である必要があり、空のファイル名は許可されません。' }, { status: 400 });
    }

    console.log(`[API /api/generate-memo] Source Filenames:`, sourceFilenames);

    // --- RAG: 参照情報取得 ---
    console.log('[MemoGen RAG] 参照情報を検索中...');
    const matchThreshold = 0.4;
    const matchCount = 5;
    
    let allChunks = [];
    const retrievedChunkIds = new Set();

    const genericSearchQuery = "主要な情報"; 
    console.log(`[MemoGen RAG] Using generic search query: "${genericSearchQuery}" for specified files.`);
    const queryEmbedding = await embeddings.embedQuery(genericSearchQuery);

    for (const filename of sourceFilenames) {
        const { data: rpcData, error: rpcError } = await supabase.rpc('match_manual_chunks', {
            query_embedding: queryEmbedding,
            match_threshold: matchThreshold,
            match_count: matchCount, 
            p_selected_filenames: [filename]
        });

        if (rpcError) {
            console.warn(`[MemoGen RAG] Supabase RPC error for file "${filename}":`, rpcError);
            continue; 
        }

        if (rpcData && rpcData.length > 0) {
            rpcData.forEach(chunk => {
                if (chunk && chunk.id && !retrievedChunkIds.has(chunk.id)) {
                    allChunks.push(chunk);
                    retrievedChunkIds.add(chunk.id);
                }
            });
        }
    }
    console.log(`[MemoGen RAG] 合計 ${allChunks.length} 件のユニークなチャンクを取得しました。`);

    let contextForLLM = "";
    if (allChunks.length > 0) {
        contextForLLM = allChunks.map(chunk => `ファイル名: ${chunk.manual_filename}\n内容:\n${chunk.chunk_text}`).join('\n\n---\n\n');
    } else {
        console.log("[MemoGen RAG] 関連するチャンクが見つかりませんでした。");
        contextForLLM = "参照ファイルから関連性の高い具体的な情報は見つかりませんでした。作成指示に基づいて一般的な知識で記述してください。";
    }

    // --- メモ生成 ---
    console.log("[MemoGen LLM] LLMにメモ生成をリクエスト中...");
    const llmResponse = await memoGenerationChain.invoke({
        user_input: craftedPrompt, // BufferWindowMemory の inputKey に合わせる
        crafted_instruction: craftedPrompt,
        context: contextForLLM,
    });
    
    const generatedMemo = llmResponse.generated_memo; 

    if (!generatedMemo) {
        console.error("[MemoGen LLM] LLMからの応答形式が予期したものではありません。", llmResponse);
        return NextResponse.json({ error: 'AIからのメモ生成に失敗しました。' }, { status: 500 });
    }
    console.log("[MemoGen LLM] LLMからのメモ生成完了。");

    return NextResponse.json({
      generated_memo: generatedMemo,
      sources: allChunks.length > 0 ? allChunks.map(c => ({ 
        id: c.id, 
        manual_id: c.manual_id,
        file_name: c.manual_filename,
        similarity: c.similarity, 
        text_snippet: c.chunk_text.substring(0,100) + '...' 
      })) : [],
      debug_info: {}
    }, { status: 200 });

  } catch (error) {
    console.error("[API /api/generate-memo] メモ生成処理中に予期せぬエラー:", error);
    const errorMessage = error.message || 'サーバー内部でエラーが発生しました。';
    const errorStack = error.stack;
    return NextResponse.json({ error: errorMessage, details: errorStack }, { status: 500 });
  }
} 