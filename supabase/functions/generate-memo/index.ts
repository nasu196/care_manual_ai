import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js";
import { GoogleGenerativeAIEmbeddings } from "npm:@langchain/google-genai";
import { ChatGoogleGenerativeAI } from "npm:@langchain/google-genai";
import { ConversationChain } from "npm:langchain/chains";
import { BufferWindowMemory } from "npm:langchain/memory";
import { PromptTemplate } from "npm:@langchain/core/prompts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

let supabase: SupabaseClient;
let embeddings: GoogleGenerativeAIEmbeddings;
let chatModel: ChatGoogleGenerativeAI;
let memoGenerationChain: ConversationChain;

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
      model: "gemini-1.5-flash-preview-0514",
      temperature: 0.4,
    });
  }

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
      llm: chatModel!,
      memory: memoGenerationMemory,
      prompt: memoGenerationPromptTemplate,
      outputKey: "generated_memo",
    });
  }
}

serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    initializeClientsAndChains();
    const { crafted_prompt: craftedPrompt, source_filenames: sourceFilenames, verbosity } = await req.json();

    if (!craftedPrompt || typeof craftedPrompt !== 'string' || craftedPrompt.trim() === '') {
      return new Response(JSON.stringify({ error: 'メモ作成指示 (crafted_prompt) が必要です。' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!Array.isArray(sourceFilenames) || !sourceFilenames.every(item => typeof item === 'string' && item.trim() !== '')) {
      return new Response(JSON.stringify({ error: '参照ファイル群 (source_filenames) は文字列の配列である必要があり、空のファイル名は許可されません。' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[functions/generate-memo] Source Filenames:`, sourceFilenames);

    const { data: manualData, error: manualError } = await supabase
      .from('manuals')
      .select('file_name, original_file_name')
      .in('original_file_name', sourceFilenames);

    if (manualError) {
      console.error(`[functions/generate-memo] Error fetching manual data:`, manualError);
      return new Response(JSON.stringify({ error: `ファイル名の解決に失敗しました: ${manualError.message}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let encodedSourceFilenames: string[] = [];
    if (manualData && manualData.length > 0) {
      encodedSourceFilenames = manualData.map((manual: any) => manual.file_name);
      console.log(`[functions/generate-memo] Encoded filenames for RPC:`, encodedSourceFilenames);
    } else {
      console.warn(`[functions/generate-memo] No matching files found for:`, sourceFilenames);
      return new Response(JSON.stringify({ error: '指定されたファイルが見つかりませんでした。' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[functions/generate-memo RAG] 参照情報を検索中...');
    const matchThreshold = 0.4;
    const matchCount = 5;
    let allChunks: any[] = [];
    const retrievedChunkIds = new Set();
    const genericSearchQuery = "主要な情報";
    const queryEmbedding = await embeddings.embedQuery(genericSearchQuery);

    for (const filename of encodedSourceFilenames) {
      const { data: rpcData, error: rpcError } = await supabase.rpc('match_manual_chunks', {
        query_embedding: queryEmbedding,
        match_threshold: matchThreshold,
        match_count: matchCount,
        p_selected_filenames: [filename]
      });
      if (rpcError) {
        console.warn(`[functions/generate-memo RAG] Supabase RPC error for file "${filename}":`, rpcError);
        continue;
      }
      if (rpcData && rpcData.length > 0) {
        rpcData.forEach((chunk: any) => {
          if (chunk && chunk.id && !retrievedChunkIds.has(chunk.id)) {
            allChunks.push(chunk);
            retrievedChunkIds.add(chunk.id);
          }
        });
      }
    }
    console.log(`[functions/generate-memo RAG] 合計 ${allChunks.length} 件のユニークなチャンクを取得しました。`);

    let contextForLLM = "";
    if (allChunks.length > 0) {
      contextForLLM = allChunks.map(chunk => `ファイル名: ${chunk.manual_filename}\n内容:\n${chunk.chunk_text}`).join('\n\n---\n\n');
    } else {
      console.log("[functions/generate-memo RAG] 関連するチャンクが見つかりませんでした。");
      contextForLLM = "参照ファイルから関連性の高い具体的な情報は見つかりませんでした。作成指示に基づいて一般的な知識で記述してください。";
    }

    console.log("[functions/generate-memo LLM] LLMにメモ生成をリクエスト中...");
    let verbosityInstruction = "標準的な詳細度で、要点を押さえつつ具体例も適度に含めて記述してください。";
    if (verbosity === 'concise') {
      verbosityInstruction = "簡潔に、最も重要なポイントのみを記述してください。箇条書きなどを活用し、冗長な説明は避けてください。";
    } else if (verbosity === 'detailed') {
      verbosityInstruction = "可能な限り詳細に、背景情報、多様な具体例、考えられる影響、関連情報などを網羅的に記述してください。必要であれば複数のセクションに分けて構成してください。";
    }

    const llmResponse = await memoGenerationChain.invoke({
      user_input: craftedPrompt,
      crafted_instruction: craftedPrompt,
      context: contextForLLM,
      verbosity_instruction: verbosityInstruction,
    });

    const generatedMemo = llmResponse.generated_memo;
    if (!generatedMemo) {
      console.error("[functions/generate-memo LLM] LLMからの応答形式が予期したものではありません。", llmResponse);
      return new Response(JSON.stringify({ error: 'AIからのメモ生成に失敗しました。' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    console.log("[functions/generate-memo LLM] LLMからのメモ生成完了。");

    return new Response(JSON.stringify({
      generated_memo: generatedMemo,
      sources: allChunks.length > 0 ? allChunks.map(c => ({
        id: c.id,
        manual_id: c.manual_id,
        file_name: c.manual_filename,
        similarity: c.similarity,
        text_snippet: c.chunk_text.substring(0, 100) + '...'
      })) : [],
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('[functions/generate-memo] Error:', error.message, error.stack);
    return new Response(JSON.stringify({ error: error.message || 'メモの生成中にサーバー側でエラーが発生しました。' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}); 