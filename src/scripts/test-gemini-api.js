require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

// .envファイルからAPIキーを取得
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("エラー: GEMINI_API_KEY が .env ファイルに設定されていません。");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

async function run() {
  try {
    // テキスト生成モデルを取得 (例: gemini-pro)
    // 利用可能なモデルは変更される可能性があるため、適宜ドキュメントを確認してください。
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = "日本の首都はどこですか？";

    console.log(`プロンプト: ${prompt}`);
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    console.log("APIからの応答:");
    console.log(text);
    console.log("--------------------");
    console.log("API呼び出し成功！");

  } catch (error) {
    console.error("API呼び出し中にエラーが発生しました:", error);
  }
}

run(); 