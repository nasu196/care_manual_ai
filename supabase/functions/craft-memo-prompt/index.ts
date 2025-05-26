import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { ChatGoogleGenerativeAI } from "npm:@langchain/google-genai";
import { LLMChain } from "npm:langchain/chains";
import { PromptTemplate } from "npm:@langchain/core/prompts";

const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

let chatModel: ChatGoogleGenerativeAI;
let memoPromptCraftingChain: LLMChain;

function initializeModelsAndChain() {
  if (!geminiApiKey) {
    console.error("エラー: 環境変数 GEMINI_API_KEY が設定されていません。");
    throw new Error("サーバー設定エラー: APIキーが不足しています。");
  }
  if (!chatModel) {
    chatModel = new ChatGoogleGenerativeAI({
      apiKey: geminiApiKey,
      model: "gemini-2.0-flash", // LangChainの標準に合わせて model を使用
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
      llm: chatModel!,
      prompt: memoPromptCraftingTemplate,
      outputKey: "generated_memo_prompt",
    });
  }
}

serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*', // すべてのオリジンを許可 (開発用)
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-id',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let userId: string | null = null;
  try {
    const authHeader = req.headers.get('Authorization');
    console.log('[craft-memo-prompt][Auth] Authorization Header:', authHeader);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('[craft-memo-prompt][Auth] Missing or invalid Authorization header.');
      return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header. Clerk JWT Bearer token is required.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.error('[craft-memo-prompt][Auth] Invalid JWT format.');
      return new Response(JSON.stringify({ error: 'Invalid JWT format' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const payload = JSON.parse(atob(parts[1]));
    console.log('[craft-memo-prompt][Auth] Decoded Clerk JWT Payload:', payload);

    userId = payload.sub || payload.user_id || payload.user_metadata?.user_id;

    if (!userId) {
      console.error('[craft-memo-prompt][Auth] User ID (sub) not found in Clerk JWT payload.');
      return new Response(JSON.stringify({ error: 'User ID not found in token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    console.log(`[craft-memo-prompt][Auth] Authenticated user ID from Clerk JWT: ${userId}`);

    const xUserIdHeader = req.headers.get('x-user-id');
    if (xUserIdHeader) {
        console.log('[craft-memo-prompt][Auth] x-user-id header:', xUserIdHeader);
        if (userId !== xUserIdHeader) {
            console.warn(`[craft-memo-prompt][Auth] Mismatch JWT user ID (${userId}) vs x-user-id header (${xUserIdHeader})`);
        }
    }

  } catch (error) {
    console.error('[craft-memo-prompt][Auth] Error processing Authorization token:', error);
    return new Response(JSON.stringify({ error: 'Failed to process Authorization token.' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    initializeModelsAndChain();
    const body = await req.json();
    const { ideaTitle, ideaDescription, sourceFileNames } = body;

    if (!ideaTitle || !ideaDescription) {
      return new Response(JSON.stringify({ error: '活用アイデアのタイトル (ideaTitle) と詳細説明 (ideaDescription) は必須です。' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sourceFileNamesStr = Array.isArray(sourceFileNames) && sourceFileNames.length > 0
      ? sourceFileNames.join(', ')
      : 'なし';

    console.log(`[functions/craft-memo-prompt] Received: title="${ideaTitle}", desc="${ideaDescription}", files="${sourceFileNamesStr}"`);

    const result = await memoPromptCraftingChain.invoke({
      ideaTitle,
      ideaDescription,
      sourceFileNamesStr,
    });

    const generatedPrompt = result.generated_memo_prompt;

    if (!generatedPrompt) {
      console.error("[functions/craft-memo-prompt] LLMChain did not return generated_memo_prompt.", result);
      return new Response(JSON.stringify({ error: 'MemoWriterLLMへの指示プロンプト生成に失敗しました。' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log("[functions/craft-memo-prompt] Successfully generated prompt.");
    return new Response(JSON.stringify({ generatedPrompt }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[functions/craft-memo-prompt] Error:', error.message, error.stack);
    return new Response(JSON.stringify({ error: error.message || 'プロンプトの作成中にサーバー側でエラーが発生しました。' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}); 