import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
// import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai'; // OpenAIを使用するためコメントアウト
import { OpenAIEmbeddings } from '@langchain/openai'; // OpenAIEmbeddingsをインポート
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { LLMChain } from "langchain/chains"; // ConversationChainを削除
import { PromptTemplate } from "@langchain/core/prompts";
// BufferWindowMemory を削除

// 環境変数
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY; // OpenAI APIキーを追加

// グローバルスコープでの初期化
let supabase;
let embeddings;
let chatModel;
let memoChain;

// 初期化関数
function initializeClients() {
  if (!supabaseUrl || !supabaseAnonKey || !geminiApiKey || !openaiApiKey) { // openaiApiKeyのチェックを追加
    console.error("エラー: 必要な環境変数 (SUPABASE_URL, SUPABASE_ANON_KEY, GEMINI_API_KEY, OPENAI_API_KEY) が設定されていません。");
    throw new Error("サーバー設定エラー: APIキーが不足しています。");
  }

  if (!supabase) {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
  }
  if (!embeddings) {
    embeddings = new OpenAIEmbeddings({
      apiKey: openaiApiKey,
      modelName: "text-embedding-ada-002",
    });
  }
  if (!chatModel) {
    chatModel = new ChatGoogleGenerativeAI({
      apiKey: geminiApiKey,
      model: "gemini-1.5-flash-latest",
      temperature: 0.7,
    });
  }

  if (!memoChain) {
    const memoPromptTemplateString = `あなたは簡潔で分かりやすいメモを作成する専門家です。

ユーザーの要求: {input}

以下の指示に従って、適切な内容を生成してください：
- ユーザーの要求に応じて、メモ、アイデア、リスト、要約などを生成
- 簡潔で分かりやすい表現を心がける
- 必要に応じて構造化された形式（箇条書き、番号付きリスト等）を使用
- 日本語で回答する

回答:`;

    const memoPromptTemplate = PromptTemplate.fromTemplate(memoPromptTemplateString);
    
    memoChain = new LLMChain({
      llm: chatModel,
      prompt: memoPromptTemplate,
    });
  }
}

export async function POST(request) {
  try {
    initializeClients();

    const { input } = await request.json();
    
    if (!input || typeof input !== 'string' || input.trim() === '') {
      return NextResponse.json({ error: '入力内容が必要です。' }, { status: 400 });
    }

    // リクエストヘッダーからAuthorizationを取得
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '認証情報が必要です。' }, { status: 401 });
    }

    console.log(`[API /api/generate-memo] メモ生成開始: "${input}"`);

    const result = await memoChain.invoke({ input });
    const generatedText = result.text;

    console.log(`[API /api/generate-memo] メモ生成完了`);

    return NextResponse.json({ 
      result: generatedText,
    });

  } catch (error) {
    console.error('[API /api/generate-memo] エラー:', error);
    return NextResponse.json({ 
      error: 'メモの生成中にエラーが発生しました。', 
      details: error.message 
    }, { status: 500 });
  }
} 