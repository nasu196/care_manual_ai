require('dotenv').config(); // プロジェクトルートの.envを参照
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAIEmbeddings } = require('@langchain/google-genai');
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ConversationChain } = require("langchain/chains");
const { BufferWindowMemory } = require("langchain/memory");
const { PromptTemplate } = require("@langchain/core/prompts");

const app = express();
const PORT = process.env.PORT || 3001;

// Supabase クライアントと Embeddings モデルの初期化
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;

if (!supabaseUrl || !supabaseAnonKey || !geminiApiKey) {
  console.error("エラー: 必要な環境変数 (SUPABASE_URL, SUPABASE_ANON_KEY, GEMINI_API_KEY) が設定されていません。");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: geminiApiKey,
  model: "text-embedding-004",
});
const chatModel = new ChatGoogleGenerativeAI({
    apiKey: geminiApiKey,
    model: "gemini-2.0-flash",
    temperature: 0.7,
});

// 会話メモリの設定 (k=3 往復分の会話を記憶)
// 注意: これは単一のグローバルメモリです。複数ユーザー対応のためにはセッション管理などが必要。
const memory = new BufferWindowMemory({ k: 6, memoryKey: "chat_history", inputKey: "input" });

// プロンプトテンプレートの定義 (会話履歴を考慮)
const chatPrompt = PromptTemplate.fromTemplate(`
あなたは親切なAIアシスタントです。ユーザーの質問に、提供された背景情報とこれまでの会話履歴を考慮して答えてください。
もし背景情報だけでは答えられない場合は、その旨を伝えてください。

これまでの会話履歴:
{chat_history}

背景情報:
{context}

ユーザーの質問:
{input}

あなたの回答:
`);

// ConversationChain の初期化
const chain = new ConversationChain({
    llm: chatModel,
    memory: memory,
    prompt: chatPrompt,
});

// ミドルウェアの設定
app.use(cors()); // CORSを有効にする
app.use(express.json()); // JSON形式のリクエストボディをパースする
app.use(express.urlencoded({ extended: true })); // URLエンコードされたリクエストボディをパースする

// Q&A API エンドポイント
app.post('/api/qa', async (req, res) => {
  const { query } = req.body;

  if (!query || typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({ error: '質問内容 (query) が必要です。' });
  }

  try {
    // 1. 質問をベクトル化
    console.log(`質問をベクトル化中: "${query}"`);
    const queryEmbedding = await embeddings.embedQuery(query);
    console.log("質問のベクトル化完了。");

    // 2. Supabase DB で類似チャンクを検索 (RPC呼び出し)
    const matchThreshold = 0.7;
    const matchCount = 3; // 参照するチャンク数を少し減らす (プロンプト長考慮)
    console.log(`類似チャンクを検索中 (threshold: ${matchThreshold}, count: ${matchCount})...`);
    const { data: chunks, error: rpcError } = await supabase.rpc('match_manual_chunks', {
      query_embedding: queryEmbedding,
      match_threshold: matchThreshold,
      match_count: matchCount,
    });

    if (rpcError) {
      console.error("Supabase RPC呼び出しエラー:", rpcError);
      return res.status(500).json({ error: 'データベース検索中にエラーが発生しました。' });
    }

    let contextForLLM = "";
    if (chunks && chunks.length > 0) {
      console.log(`${chunks.length} 件の関連チャンクが見つかりました。`);
      contextForLLM = chunks.map(chunk => chunk.chunk_text).join('\n\n---\n\n');
    } else {
      console.log("関連するチャンクが見つかりませんでした。");
      contextForLLM = "関連する背景情報は見つかりませんでした。";
    }
    
    // 3. ConversationChain を使って回答を生成 (会話履歴と背景情報を考慮)
    console.log("LLMに回答生成をリクエスト中 (会話履歴と背景情報考慮)...");
    const llmResponse = await chain.invoke({
        input: query,
        context: contextForLLM
    });
    
    // ConversationChain の応答は通常 result.response や result.text に格納される
    // chain.invoke の場合は直接文字列か、{ response: "..." } のようなオブジェクトで返る。
    // ここでは llmResponse が { response: "AIの回答" } の形を期待。 LangChainのバージョンや設定で要確認。
    const answer = llmResponse.response; // または llmResponse.output や llmResponse.text など、実際の構造に合わせる

    if (!answer) {
        console.error("LLMからの応答形式が予期したものではありません。", llmResponse);
        return res.status(500).json({ error: 'AIからの回答取得に失敗しました。応答形式を確認してください。' });
    }

    console.log("LLMからの回答受信完了。");

    // 4. 回答と参照元を返す (参照元情報はベクトル検索の結果を使う)
    res.status(200).json({
      answer: answer,
      sources: chunks && chunks.length > 0 ? chunks.map(c => ({ id: c.id, manual_id: c.manual_id, page_number: c.page_number, similarity: c.similarity, text_snippet: c.chunk_text.substring(0,100) + '...' })) : []
    });

  } catch (error) {
    console.error("Q&A処理中に予期せぬエラー:", error);
    res.status(500).json({ error: 'サーバー内部でエラーが発生しました。' });
  }
});

// ヘルスチェック用エンドポイント
app.get('/healthcheck', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    message: 'API server is running',
    timestamp: new Date().toISOString()
  });
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`API server listening on port ${PORT}`);
}); 