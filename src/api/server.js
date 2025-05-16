require('dotenv').config(); // プロジェクトルートの.envを参照
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAIEmbeddings } = require('@langchain/google-genai');
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");

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
    model: "gemini-1.5-flash-latest",
    temperature: 0.7,
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
    const matchThreshold = 0.7; // 類似度の閾値 (0.0 〜 1.0) 適宜調整
    const matchCount = 5;     // 取得するチャンクの最大数
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

    if (!chunks || chunks.length === 0) {
      console.log("関連するチャンクが見つかりませんでした。");
      return res.status(404).json({ answer: '関連する情報が見つかりませんでした。', sources: [] });
    }
    console.log(`${chunks.length} 件の関連チャンクが見つかりました。`);

    // 3. 取得したチャンクと質問を基にLLMで回答生成
    const context = chunks.map(chunk => chunk.chunk_text).join('\n\n---\n\n');
    const prompt = `以下の背景情報に基づいて、ユーザーの質問に答えてください。\n\n背景情報:\n${context}\n\n質問: ${query}\n\n回答:`;
    
    console.log("LLMに回答生成をリクエスト中...");
    const llmResponse = await chatModel.invoke(prompt);
    const answer = llmResponse.content; // LangChainのバージョンにより .text や .content など異なる場合あり
    console.log("LLMからの回答受信完了。");

    // 4. 回答と参照元を返す
    res.status(200).json({ 
      answer: answer,
      sources: chunks.map(c => ({ id: c.id, manual_id: c.manual_id, page_number: c.page_number, similarity: c.similarity, text_snippet: c.chunk_text.substring(0,100) + '...' })) 
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