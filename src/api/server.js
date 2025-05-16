require('dotenv').config(); // プロジェクトルートの.envを参照
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAIEmbeddings } = require('@langchain/google-genai');
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ConversationChain } = require("langchain/chains");
const { BufferWindowMemory, ConversationSummaryBufferMemory } = require("langchain/memory");
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
    temperature: 0.4,
});

// 会話メモリの設定
// 注意: これは単一のグローバルメモリです。複数ユーザー対応のためにはセッション管理などが必要。
// const memory = new BufferWindowMemory({ k: 6, memoryKey: "chat_history", inputKey: "input" }); // 古いメモリ
const memory = new ConversationSummaryBufferMemory({
    llm: chatModel, // 要約に使用するLLM
    maxTokenLimit: 2000, // 要約前のバッファの最大トークン数 (デフォルト2000)
    memoryKey: "chat_history",
    inputKey: "input",
});

// プロンプトテンプレートの定義 (会話履歴を考慮)
const chatPrompt = PromptTemplate.fromTemplate(`
あなたは高度な分析能力を持つAIアシスタントです。提供された「背景情報」を徹底的に分析し、それを唯一の情報源としてユーザーの質問に答えてください。

ユーザーからの質問に対しては、以下の思考プロセスに従って回答を生成してください。
1.  **質問の分解と理解**: ユーザーの質問の意図、主要なキーワード、求めている情報の種類を正確に特定します。
2.  **背景情報の徹底的なスキャン**: 提供された「背景情報」全体を注意深く読み込み、質問に関連する可能性のある全ての箇所をリストアップします。
3.  **情報の抽出と整理**: リストアップした箇所から、質問に答えるために必要な情報を正確に抽出します。複数の箇所に関連情報がある場合は、それらを統合し、矛盾がないか確認します。情報の重要度に応じて順序付けを行います。
4.  **回答の構築**: 抽出・整理した情報のみに基づいて、質問の核心に直接的かつ明確に回答します。ユーザーが補助金の申請をスムーズに進められるように、必要な情報を網羅的かつ具体的に提供することを心がけてください。回答は以下の構成を基本として、具体的で、**可能な限り詳細に、かつ平易な言葉で説明を補足し**、論理的な順序で構成してください。
    *   **導入**: まず、何についての回答であるかを簡潔に述べ、可能であれば「提供された背景情報に基づき説明します」といった前置きを加えてください。
    *   **主要なポイントのリスト化**: ユーザーが求める情報を、番号付きリスト（例: \`1. 注意点1\`）や記号付き箇条書き（例: \`- 重要なポイント\`）を用いて、各項目に簡潔な見出しを付けながら提示してください。各リスト項目や見出しと説明の間、および各説明文の後には、**視覚的な区切りとしてMarkdownの改行（空行を1行以上）を適切に挿入**してください。各ポイントについて、背景情報から得られた具体的な説明や例を**できる限り多く、詳細に**加えてください。
    *   **補足情報 (必要な場合)**: 主要なポイントに関連する重要な補足情報があれば、ここで**詳細に**説明してください。ここでも、説明の区切りにはMarkdownの改行を適切に使用してください。
    *   **まとめと推奨事項 (可能な場合)**: 全体を簡潔にまとめ、ユーザーが次にとるべき行動や注意すべき点など、具体的な推奨事項があれば提示してください。
5.  **自己検証**: 生成した回答が、上記の構成と指示に従い、背景情報に基づいており、質問の意図に完全に合致しているか、そしてユーザーが求めるであろう情報の深さと網羅性を満たしているかを確認します。もし不足があれば、ステップ3に戻り情報を再検討してください。

**重要な指示:**
*   **背景情報に記載されていない情報は決して推測したり、あなたの一般的な知識で補ったりしないでください。**
*   ユーザーが「対象となる経費」について尋ねた場合は、まず「対象となる経費」を具体的に説明し、その後に必要であれば補足情報（対象外の経費など）を加えてください。ユーザーが直接尋ねていない情報から話し始めないでください。
*   もし「背景情報」だけでは答えられない場合や、質問が「背景情報」の内容と明らかに関連がないと判断される場合は、その旨を正直に、そして明確に伝えてください。

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
    const matchThreshold = 0.4;
    const matchCount = 7;
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