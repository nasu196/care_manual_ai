require('dotenv').config();
const { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { TextLoader } = require("langchain/document_loaders/fs/text");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
const { RetrievalQAChain } = require("langchain/chains");

async function runPoc() {
  try {
    // 0. 環境変数からAPIキーを取得
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("エラー: GEMINI_API_KEY が .env ファイルに設定されていません。");
      process.exit(1);
    }

    // 1. LLMとEmbeddingモデルの初期化
    const llm = new ChatGoogleGenerativeAI({
      apiKey: apiKey,
      model: "gemini-2.0-flash", // LLMモデル
      temperature: 0.3, // 回答の多様性 (0-1)
    });
    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: apiKey,
      model: "text-embedding-004", // Embeddingモデル
    });

    console.log("LLMとEmbeddingモデルを初期化しました。");

    // 2. ドキュメントローディング
    const loader = new TextLoader("./data/sample-manual.txt");
    const docs = await loader.load();
    if (docs.length === 0) {
      console.error("エラー: sample-manual.txt の読み込みに失敗したか、ファイルが空です。");
      process.exit(1);
    }
    console.log(`\nドキュメントを読み込みました: ${docs.length}件`);
    console.log("最初のドキュメントの内容抜粋:", docs[0].pageContent.substring(0, 100) + "...");

    // 3. テキスト分割 (チャンク化)
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 500, // 各チャンクの最大文字数
      chunkOverlap: 50,  // チャンク間のオーバーラップ文字数
    });
    const splitDocs = await splitter.splitDocuments(docs);
    console.log(`\nドキュメントを ${splitDocs.length} 個のチャンクに分割しました。`);
    console.log("最初のチャンクの内容抜粋:", splitDocs[0].pageContent.substring(0, 100) + "...");

    // 4. ベクトル化とVectorStoreへの保存 (メモリ上)
    const vectorStore = await MemoryVectorStore.fromDocuments(splitDocs, embeddings);
    console.log("\nチャンクをベクトル化し、メモリ上のVectorStoreに保存しました。");

    // 5. Q&Aチェーンの作成と実行
    const chain = RetrievalQAChain.fromLLM(llm, vectorStore.asRetriever());
    console.log("\nQ&Aチェーンを作成しました。");

    const question1 = "個人情報を入力しても大丈夫ですか？";
    console.log(`\n質問1: ${question1}`);
    const answer1 = await chain.call({ query: question1 });
    console.log("回答1:", answer1.text);

    const question2 = "病気の診断はできますか？";
    console.log(`\n質問2: ${question2}`);
    const answer2 = await chain.call({ query: question2 });
    console.log("回答2:", answer2.text);
    
    const question3 = "AIの回答は常に正しいですか？";
    console.log(`\n質問3: ${question3}`);
    const answer3 = await chain.call({ query: question3 });
    console.log("回答3:", answer3.text);

    console.log("\n--------------------");
    console.log("LangChain PoC 処理完了！");

  } catch (error) {
    console.error("\nLangChain PoC 処理中にエラーが発生しました:", error);
  }
}

runPoc(); 