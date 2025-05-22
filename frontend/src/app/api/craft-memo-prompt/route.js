import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { LLMChain } from "langchain/chains";
import { PromptTemplate } from "@langchain/core/prompts";
import { NextResponse } from 'next/server';

// 環境変数 (Next.jsでは .env ファイルから自動で読み込まれる想定)
const geminiApiKey = process.env.GEMINI_API_KEY;

// グローバルスコープで一度だけ初期化されるようにする
let chatModel;
let memoPromptCraftingChain;

// 初期化関数 (必要に応じて呼び出す)
// 注意: App RouterのAPIルートは通常ステートレスに保たれるため、
// このようなグローバルスコープでのキャッシュは、デプロイ環境 (Vercelなど) では
// 各関数呼び出しごとに再初期化される可能性があります (Lambda関数の性質上)。
// より堅牢にするには、初期化コストが高い場合、外部キャッシュやDBを利用するか、
// リクエストごとに初期化を受け入れるかなどの検討が必要です。
// 今回は開発のシンプルさのため、このまま進めます。
function initializeModelsAndChain() {
  if (!geminiApiKey) {
    console.error("エラー: 環境変数 GEMINI_API_KEY が設定されていません。");
    throw new Error("サーバー設定エラー: APIキーが不足しています。"); // エラーをスローして呼び出し元でキャッチ
  }
  if (!chatModel) {
    chatModel = new ChatGoogleGenerativeAI({
        apiKey: geminiApiKey,
        model: "gemini-2.5-flash-preview-05-20",
        temperature: 0.4,
    });
  }

  const memoPromptCraftingTemplateString = `
あなたは、与えられた「活用アイデア」と「参照ファイル群」に基づいて、高品質な「成果物メモ」を作成するための具体的な指示プロンプトを設計する、プロンプトエンジニアリングの専門家AIです。

あなたの仕事は、別のAI（MemoWriterLLM）が最高の成果物メモを生成できるように、明確で、詳細かつ実行可能な指示プロンプトを考え出すことです。

以下の情報を参考にして、MemoWriterLLMへの指示プロンプトを作成してください。

活用アイデアのタイトル: 「{ideaTitle}」
活用アイデアの詳細説明: 「{ideaDescription}」
参照すべきファイル群: [{sourceFileNamesStr}]

MemoWriterLLMへの指示プロンプトは、以下の要素を必ず含み、MemoWriterLLMが具体的なアクションを取りやすいように記述してください。

1.  **成果物メモの目的とゴール**:
    *   このメモが何のために作られるのか、どのような価値を提供することを目指すのかを明確に記述してください。
    *   例えば、「{ideaTitle}」というアイデアに基づき、ユーザーが参照ファイル群の情報を活用して具体的なアクションに繋げられるような、実践的なメモを作成する、など。

2.  **成果物メモのターゲット読者**:
    *   想定される読者を記述してください（例: チームメンバー、顧客、自己参照用など）。これによりMemoWriterLLMが適切な文体や詳細度を判断できます。

3.  **成果物メモに含めるべき主要セクションと内容**:
    *   メモの構成案を具体的に提示してください。最低でも3つ以上の主要セクションを提案し、各セクションに何を書くべきか詳細に指示してください。
    *   例えば、「{ideaTitle}」を実現するためのステップ、関連するキーポイント、注意点、具体的な事例（参照ファイル群から引用・要約）、ネクストアクションなどを盛り込むように指示します。
    *   参照ファイル群 ({sourceFileNamesStr}) の情報をどのように各セクションに反映させるべきか、具体的な指示を含めてください。例えば、「xxxファイルの△△に関する情報を要約し、このセクションに含めてください」など。

4.  **成果物メモの文体とトーン**:
    *   プロフェッショナル、カジュアル、技術的、説明的など、適切な文体とトーンを指示してください。

5.  **成果物メモの長さ・詳細度**:
    *   期待するメモのおおよその長さ（例: 500文字程度、3パラグラフ程度など）や、どの程度詳細に記述すべきかを指示してください。

6.  **成果物メモの形式**:
    *   Markdown形式で、見出し、箇条書き、太字などを効果的に使用して、視覚的に分かりやすい形式で出力するように指示してください。

7.  **特に重視すべき点・禁止事項**:
    *   例えば、「参照ファイルに記載されている具体的なデータや数値を可能な限り引用すること」「専門用語は避け、平易な言葉で説明すること」「個人的な意見や推測は含めないこと」などを明確に指示してください。

MemoWriterLLMへの指示プロンプトの最後には、必ず以下の区切り線を入れてください。
--- MemoWriterLLMへの指示はここまで ---

上記を考慮し、最高の指示プロンプトを作成してください。
あなたの成果物は、MemoWriterLLMへの指示プロンプトそのものです。余計な前置きや後書きは不要です。
`;
  const memoPromptCraftingTemplate = PromptTemplate.fromTemplate(memoPromptCraftingTemplateString);

  if (!memoPromptCraftingChain) {
    memoPromptCraftingChain = new LLMChain({
      llm: chatModel,
      prompt: memoPromptCraftingTemplate,
      outputKey: "generated_memo_prompt",
    });
  }
}

export async function POST(request) {
  try {
    initializeModelsAndChain(); // モデルとチェーンを初期化 (または既存のものを利用)

    const { ideaTitle, ideaDescription, sourceFileNames } = await request.json();

    if (!ideaTitle || !ideaDescription) {
      return NextResponse.json({ error: '活用アイデアのタイトル (ideaTitle) と詳細説明 (ideaDescription) は必須です。' }, { status: 400 });
    }
    
    const sourceFileNamesStr = Array.isArray(sourceFileNames) && sourceFileNames.length > 0 
      ? sourceFileNames.join(', ') 
      : 'なし';

    console.log(`[api/craft-memo-prompt/route.js] Received: title="${ideaTitle}", desc="${ideaDescription}", files="${sourceFileNamesStr}"`);

    const result = await memoPromptCraftingChain.invoke({
      ideaTitle,
      ideaDescription,
      sourceFileNamesStr,
    });

    const generatedPrompt = result.generated_memo_prompt;

    if (!generatedPrompt) {
      console.error("[api/craft-memo-prompt/route.js] LLMChain did not return generated_memo_prompt.", result);
      return NextResponse.json({ error: 'MemoWriterLLMへの指示プロンプト生成に失敗しました。' }, { status: 500 });
    }

    console.log("[api/craft-memo-prompt/route.js] Successfully generated prompt.");
    return NextResponse.json({ generatedPrompt });

  } catch (error) {
    console.error('[api/craft-memo-prompt/route.js] Error:', error.message, error.stack);
    return NextResponse.json({ error: error.message || 'プロンプトの作成中にサーバー側でエラーが発生しました。' }, { status: 500 });
  }
} 