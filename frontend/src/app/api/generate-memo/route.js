import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
// import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai'; // OpenAIを使用するためコメントアウト
import { OpenAIEmbeddings } from '@langchain/openai'; // OpenAIEmbeddingsをインポート
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ConversationChain } from "langchain/chains"; // LLMChain は不要
import { BufferWindowMemory } from "langchain/memory";
import { PromptTemplate } from "@langchain/core/prompts";

// 環境変数
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY; // OpenAI APIキーを追加

// グローバルスコープでの初期化
let supabase;
let embeddings;
let chatModel;
let memoGenerationChain; // memory も内部で初期化またはここで保持

// 初期化関数
function initializeClientsAndChains() {
  if (!supabaseUrl || !supabaseAnonKey || !geminiApiKey || !openaiApiKey) { // openaiApiKeyのチェックを追加
    console.error("エラー: 必要な環境変数 (SUPABASE_URL, SUPABASE_ANON_KEY, GEMINI_API_KEY, OPENAI_API_KEY) が設定されていません。");
    throw new Error("サーバー設定エラー: APIキーが不足しています。");
  }

  if (!supabase) {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
  }
  if (!embeddings) {
    // embeddings = new GoogleGenerativeAIEmbeddings({ // GoogleからOpenAIに変更
    //   apiKey: geminiApiKey,
    //   model: "text-embedding-004",
    // });
    embeddings = new OpenAIEmbeddings({
      apiKey: openaiApiKey,
      modelName: "text-embedding-ada-002",
    });
  }
  if (!chatModel) {
    chatModel = new ChatGoogleGenerativeAI({
        apiKey: geminiApiKey,
        model: "gemini-2.5-flash-preview-05-20", // モデル名を適切なものに
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
あなたは、提供された「参照情報」と「作成指示」、「期待される詳細度」に基づいて、高品質で実用的な「成果物メモ」を生成する、高度な執筆AIアシスタントです。

以下の「作成指示」と「期待される詳細度」に厳密に従ってください。
そして、「参照情報」を最大限に活用し、具体的で有用な情報を含んだメモを作成してください。

作成指示:
{crafted_instruction}

期待される詳細度:
{verbosity_instruction}

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

    const authHeader = request.headers.get('Authorization');
    console.log(`[API /api/generate-memo] Authorization header:`, authHeader ? 'Present' : 'Missing');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: '認証情報が必要です。' }, { status: 401 });
    }

    // トークンからuserIdを抽出
    let userIdFromToken;
    try {
      const token = authHeader.replace('Bearer ', '');
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error('Invalid JWT format');
      const payload = JSON.parse(atob(parts[1]));
      userIdFromToken = payload.sub || payload.user_id; // Clerkのトークンに合わせて調整 (sub or user_id)
      if (!userIdFromToken) throw new Error('User ID not found in token payload');
      console.log(`[API /api/generate-memo] User ID from token: ${userIdFromToken}`);
    } catch (e) {
      console.error('[API /api/generate-memo] Error decoding token or extracting user ID:', e.message);
      return NextResponse.json({ error: '無効な認証トークンです。' }, { status: 401 });
    }

    const authenticatedSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
      auth: {
        persistSession: false,
      },
    });

    const { crafted_prompt: craftedPrompt, source_filenames: sourceFilenames, verbosity } = await request.json();

    if (!craftedPrompt || typeof craftedPrompt !== 'string' || craftedPrompt.trim() === '') {
      return NextResponse.json({ error: 'メモ作成指示 (crafted_prompt) が必要です。' }, { status: 400 });
    }
    if (!Array.isArray(sourceFilenames) || !sourceFilenames.every(item => typeof item === 'string' && item.trim() !== '')) {
      return NextResponse.json({ error: '参照ファイル群 (source_filenames) は文字列の配列である必要があり、空のファイル名は許可されません。' }, { status: 400 });
    }

    console.log(`[API /api/generate-memo] Source Filenames for lookup:`, sourceFilenames);
    
    const { data: manualData, error: manualError } = await authenticatedSupabase
      .from('manuals')
      .select('id, file_name') // file_nameも取得しておく（デバッグや将来の利用のため）
      .in('original_file_name', sourceFilenames);

    console.log(`[API /api/generate-memo] Supabase manual lookup result:`, { data: manualData, error: manualError });

    if (manualError) {
      console.error(`[API /api/generate-memo] Error fetching manual data:`, manualError);
      return NextResponse.json({ error: `ファイル情報取得エラー: ${manualError.message}` }, { status: 500 });
    }

    let selectedManualIds = [];
    if (manualData && manualData.length > 0) {
      selectedManualIds = manualData.map(manual => manual.id);
      console.log(`[API /api/generate-memo] Selected Manual IDs for RPC:`, selectedManualIds);
    } else {
      console.warn(`[API /api/generate-memo] No matching manuals found for original_filenames:`, sourceFilenames);
      // 該当ファイルがない場合でも、空のコンテキストでLLMに処理を続けさせるか、エラーにするか検討。
      // ここではQA機能に合わせて、チャンクが見つからなくてもLLMは呼ぶ方針とする。
      // return NextResponse.json({ error: '指定された参照ファイルが見つかりませんでした。' }, { status: 404 }); 
    }

    console.log('[MemoGen RAG] 参照情報を検索中...');
    const matchThreshold = 0.1; // QA機能に合わせて調整 (以前は0.4だった)
    const matchCount = 7;    // QA機能に合わせて調整 (以前は5だった)
    
    let allChunks = [];
    
    if (selectedManualIds.length > 0) { // 検索対象のマニュアルIDがある場合のみRPC呼び出し
        const genericSearchQuery = "主要な情報"; 
        console.log(`[MemoGen RAG] Using generic search query: "${genericSearchQuery}" for manual IDs:`, selectedManualIds);
        const queryEmbedding = await embeddings.embedQuery(genericSearchQuery);

        const { data: rpcData, error: rpcError } = await authenticatedSupabase.rpc('match_manual_chunks', {
            query_embedding: queryEmbedding,
            match_threshold: matchThreshold,
            match_count: matchCount, 
            p_user_id: userIdFromToken,
            p_selected_manual_ids: selectedManualIds,
            // p_selected_manual_ids_count: selectedManualIds.length, // ★再度コメントアウト
            // embedding_length: 1536, // ★再度コメントアウト
            p_share_id: null
        });

        if (rpcError) {
            console.warn(`[MemoGen RAG] Supabase RPC error:`, rpcError);
            // エラーが発生しても処理を続行し、コンテキストなしでLLMを呼ぶことを試みる
        } else if (rpcData && rpcData.length > 0) {
            // QA API同様、重複排除は不要 (RPC側で対応している想定、またはここでは許容)
            allChunks = rpcData;
        }
    }
    console.log(`[MemoGen RAG] 合計 ${allChunks.length} 件のチャンクを取得しました。`);

    let contextForLLM = "";
    if (allChunks.length > 0) {
        contextForLLM = allChunks.map(chunk => 
          `ファイル名: ${chunk.original_filename || chunk.filename || '不明なファイル'}\n類似度: ${chunk.similarity ? chunk.similarity.toFixed(3) : 'N/A'}\n内容:\n${chunk.text_preview || chunk.chunk_text || 'プレビューなし'}`
        ).join('\n\n---\n\n');
    } else {
        console.log("[MemoGen RAG] 関連するチャンクが見つかりませんでした。");
        contextForLLM = "参照ファイルから関連性の高い具体的な情報は見つかりませんでした。作成指示に基づいて一般的な知識で記述してください。";
    }

    // --- メモ生成 ---
    console.log("[MemoGen LLM] LLMにメモ生成をリクエスト中...");

    let verbosityInstruction = "標準的な詳細度で、要点を押さえつつ具体例も適度に含めて記述してください。";
    if (verbosity === 'concise') {
      verbosityInstruction = "簡潔に、最も重要なポイントのみを記述してください。箇条書きなどを活用し、冗長な説明は避けてください。";
    } else if (verbosity === 'detailed') {
      verbosityInstruction = "可能な限り詳細に、背景情報、多様な具体例、考えられる影響、関連情報などを網羅的に記述してください。必要であれば複数のセクションに分けて構成してください。";
    }

    const llmResponse = await memoGenerationChain.invoke({
        user_input: craftedPrompt, // BufferWindowMemory の inputKey に合わせる
        crafted_instruction: craftedPrompt,
        context: contextForLLM,
        verbosity_instruction: verbosityInstruction,
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
        file_name: c.original_filename || c.filename || '不明なファイル',
        similarity: c.similarity, 
        text_snippet: c.text_preview || c.chunk_text || 'プレビューなし'
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