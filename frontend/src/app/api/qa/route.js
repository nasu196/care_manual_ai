import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ConversationChain, LLMChain } from "langchain/chains";
import { ConversationSummaryBufferMemory } from "langchain/memory"; // BufferWindowMemory は memoGenerationChain で使用
import { PromptTemplate } from "@langchain/core/prompts";

// 環境変数
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;

// グローバルスコープでの初期化 (App Routerの性質上、リクエストごとに再初期化される可能性に注意)
let supabase;
let embeddings;
let chatModel;
let queryAnalysisChain;
let answerGenerationChain; // memory も内部で初期化またはここで保持

// 初期化関数
function initializeClientsAndChains() {
  if (!supabaseUrl || !supabaseAnonKey || !geminiApiKey) {
    console.error("エラー: 必要な環境変数 (SUPABASE_URL, SUPABASE_ANON_KEY, GEMINI_API_KEY) が設定されていません。");
    // このエラーはリクエスト処理中に適切にハンドリングされるべき
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
        model: "gemini-2.5-flash-preview-05-20", // server.jsからモデル名をコピー
        temperature: 0.4,
    });
  }

  // --- 第1段階LLM用: 質問分析とクエリ生成 ---
  if (!queryAnalysisChain) {
    const queryAnalysisPromptTemplateString = `
あなたは、ユーザーからの質問を深く理解し、その質問に答えるために必要な情報を網羅的に収集するための戦略を立てる、非常に優秀なリサーチアシスタントです。

以下のユーザーの質問を分析してください。
そして、ユーザーが本当に知りたい核心的な情報、その情報を提供するために補足すべき有益な情報、そしてそれらの情報を効率的に検索するための具体的な検索クエリを提案してください。

ユーザーの質問の曖昧さを解消し、より具体的で多角的な視点から情報を捉えられるように、検索クエリは複数提案することが望ましいです。
元の質問のキーワードをそのまま使うだけでなく、関連性の高い同義語、より専門的な用語、具体的な事例を問うような表現なども考慮してください。

出力は必ず以下のJSON形式で、キーは日本語で記述してください。値には分析結果や提案を文字列または文字列の配列として格納してください。

\\\`\\\`\\\`json
{{
  "質問の要約": "ユーザーが最も知りたいポイントを1～2文で簡潔に記述",
  "補足情報候補": [
    "ユーザーにとって有益と思われる関連情報や背景情報を箇条書きで3～5点記述",
    "それぞれの補足情報は、ユーザーが次に知りたくなるであろう質問を想定して記述"
  ],
  "検索クエリ群": [
    "効果的だと思われる検索クエリを3～7個提案する",
    "検索クエリは、具体的なキーワードの組み合わせで記述する",
    "一つの検索クエリは、10～20文字程度の簡潔なものが望ましい"
  ]
}}
\\\`\\\`\\\`

ユーザーの質問:
「{user_query}」

あなたの分析結果と提案（JSON形式）:
`;
    const queryAnalysisPromptTemplate = PromptTemplate.fromTemplate(queryAnalysisPromptTemplateString);
    queryAnalysisChain = new LLMChain({
      llm: chatModel,
      prompt: queryAnalysisPromptTemplate,
      outputKey: "analysis_result",
    });
  }

  // --- 第2段階LLM用: 回答生成 ---
  if (!answerGenerationChain) {
    // ConversationSummaryBufferMemory はリクエストごとに初期化する方が安全かもしれない
    // ここでは server.js の構造に合わせてグローバルに一度だけ初期化する試み
    const memory = new ConversationSummaryBufferMemory({
        llm: chatModel,
        maxTokenLimit: 2000,
        memoryKey: "chat_history",
        inputKey: "input", // server.js と合わせる
    });

    const answerGenerationPromptString = `
あなたは高度な分析能力と優れた説明能力を持つAIアシスタントです。提供された「背景情報」を主な情報源として参照しつつ、ユーザーの質問の意図を深く理解し、役立つ回答を生成してください。
**特に、直前の会話の流れやユーザーからの指示の変更（例えば、言語の変更や話題の転換など）があった場合は、それを的確に捉え、柔軟に対応してください。**
{analysis_summary}

ユーザーからの質問「{input}」に対して、以下の思考プロセスに従って、網羅的かつ分かりやすい回答を生成してください。

1.  **質問の分解と理解**: ユーザーの質問の意図、主要なキーワード、求めている情報の種類を正確に特定します。特に「{input}」という質問から、ユーザーが何を知りたいのかの核心を掴んでください。

2.  **背景情報の徹底的なスキャン**: 提供された「背景情報」全体を注意深く読み込み、ユーザーの質問に関連する可能性のある全ての箇所をリストアップします。

3.  **情報の抽出と整理**: リストアップした箇所から、質問に答えるために必要な情報を正確に抽出します。複数の箇所に関連情報がある場合は、それらを統合し、矛盾がないか確認します。情報の重要度や関連性に応じて順序付けを行います。

4.  **回答の構築**: 抽出・整理した情報のみに基づいて、質問の核心に直接的かつ明確に回答します。ユーザーが情報を理解し、活用できるように、具体的で、**可能な限り詳細に、かつ平易な言葉で説明を補足し**、論理的な順序で構成してください。
    回答は以下の構成とポイントを参考に、適切で分かりやすい見出しを付けてください。

    *   **導入 (または はじめに)**: これから説明する内容の概要や、回答全体の目的を簡潔に述べてください。例えば、「以下に、主な注意点をまとめましたのでご確認ください」や「この手続きをスムーズに進めるために特に重要な点をいくつか解説します」のように、主要なポイントのリストへ自然に繋がるような前置きを記述します。あなたの回答の最初の文で、ユーザーの質問の主要なトピックや「背景情報に基づく」という点に既に触れている場合は、この「導入」セクションでそれらの情報を不必要に繰り返さないようにしてください。

    *   **主要な情報の提示**: ユーザーが求める情報を、背景情報から抽出した内容に基づいて、以下の観点などを参考に整理し、番号付きリストや記号付き箇条書きを用いて提示してください。各項目には、その内容を的確に表す簡潔な見出しを付けてください。各リスト項目や見出しと説明の間、および各説明文の後には、**視覚的な区切りとしてMarkdownの改行（空行を1行以上）を適切に挿入**してください。
        *   **概要・定義 (What is it?)**: 質問されている事項の基本的な説明、目的、背景など。
        *   **対象・条件 (Who/What qualifies?)**: 対象となる人、物、事柄や、それらに関する条件、基準など。
        *   **内容・詳細 (Details)**: 具体的な内容、種類、例、含まれるもの・含まれないものなど。
        *   **手順・方法 (How to?)**: 何かを行うための具体的なステップ、手続き、プロセス、必要なもの（書類、ツール、情報など）。
        *   **時期・期間・期限 (When?)**: いつからいつまで、どのくらいの期間、締め切りなど。
        *   **場所・範囲 (Where?)**: どこで、どの範囲で適用されるかなど。
        *   **理由・根拠 (Why?)**: なぜそうなるのか、その理由や根拠。
        *   **数量・金額・制限 (How much/many?)**: 数値的な情報、費用、上限・下限など。
        *   **利点・欠点 (Pros and Cons)**: もし背景情報にあれば、メリットやデメリット。
        *   **重要な注意点・考慮事項 (Important Notes/Considerations)**: 特に気をつけるべきこと、リスク、アドバイスなど。
        *   **関連情報・参照先 (Related Info/References)**: もし背景情報にあれば、関連する他の情報や、問い合わせ先、さらに詳しい情報源など。
        （上記はあくまで例です。背景情報の内容に応じて、最も適切で分かりやすい項目立てを行ってください。）
        各ポイントについて、背景情報から得られた具体的な説明や例を**できる限り多く、詳細に**加えてください。

    *   **補足情報 (必要な場合)**: 主要なポイントに関連する重要な補足情報があれば、ここで**詳細に**説明してください。ここでも、説明の区切りにはMarkdownの改行を適切に使用してください。

    *   **まとめと次のステップへの示唆**: 全体を簡潔にまとめ、ユーザーがこの情報をどのように活用できるか、次に何を考えるべきか、どのような行動をとるべきかのヒントや具体的な推奨事項があれば提示してください。

5.  **自己検証**: 生成した回答が、上記の構成と指示に従い、背景情報に基づいており、質問の意図に完全に合致しているか、そしてユーザーが求めるであろう情報の深さと網羅性を満たしているかを確認します。もし不足があれば、ステップ3に戻り情報を再検討してください。

**重要な指示:**
*   背景情報を最優先の根拠とします。ただし、ユーザーの質問に答える上で背景情報だけでは明らかに不足しており、かつ一般的なビジネス慣習や公知の事実で安全に補完できる範囲の情報であれば、**必ず「これは一般的な注意点ですが、」や「補助金の要項には直接の記載がありませんが、企業の一般的な対応としては、」のように、その情報が背景情報由来ではないことを明確に示した上で**補足することを検討してください。推測や不確実な情報、個人的な意見は決して含めないでください。
*   ユーザーが「対象となる経費」について尋ねた場合は、まず「対象となる経費」を具体的に説明し、その後に必要であれば補足情報（対象外の経費など）を加えてください。ユーザーが直接尋ねていない情報から話し始めないでください。
*   もし「背景情報」だけでは答えられない場合や、質問が「背景情報」の内容と明らかに関連がないと判断される場合は、その旨を正直に、そして明確に伝えてください。
*   **回答は必ず日本語で、自然で分かりやすい文章で記述してください。**

これまでの会話履歴:
{chat_history}

背景情報:
{context}

ユーザーの質問 (再度掲載):
{input}

あなたの回答 (日本語で記述):
`;
    const answerGenerationPrompt = PromptTemplate.fromTemplate(answerGenerationPromptString);
    answerGenerationChain = new ConversationChain({
        llm: chatModel,
        memory: memory,
        prompt: answerGenerationPrompt,
        // outputKey: "response" // server.js に合わせてデフォルトのまま
    });
  }
}

export async function POST(request) {
  try {
    initializeClientsAndChains();

    const { query: userQuery, source_filenames: sourceFilenames } = await request.json();

    if (!userQuery || typeof userQuery !== 'string' || userQuery.trim() === '') {
      return NextResponse.json({ error: '質問内容 (query) が必要です。' }, { status: 400 });
    }

    const validSourceFilenames = Array.isArray(sourceFilenames) && sourceFilenames.every(item => typeof item === 'string') 
      ? sourceFilenames 
      : null;

    console.log(`[API /api/qa] User Query: "${userQuery}", Source Filenames:`, validSourceFilenames);

    // --- 第1段階: 質問分析と検索クエリ生成 ---
    console.log(`[Phase 1] ユーザーの質問を分析中: "${userQuery}"`);
    const analysisResultRaw = await queryAnalysisChain.invoke({ user_query: userQuery });
    let analysisData;
    try {
      let jsonString = analysisResultRaw.analysis_result;
      if (jsonString.startsWith("```json\n")) {
        jsonString = jsonString.substring(7); // "```json\n".length
      } else if (jsonString.startsWith("```json")) {
        jsonString = jsonString.substring(7);
      }
      if (jsonString.endsWith("\n```")) {
        jsonString = jsonString.substring(0, jsonString.length - 4); // "\n```".length
      } else if (jsonString.endsWith("```")) {
        jsonString = jsonString.substring(0, jsonString.length - 3);
      }
      analysisData = JSON.parse(jsonString.trim());
    } catch (e) {
      console.error("[Phase 1] LLMからの分析結果(JSON)のパースに失敗しました。", e);
      console.error("[Phase 1] LLM Raw Output:", analysisResultRaw.analysis_result);
      return NextResponse.json({ error: '質問分析中にエラーが発生しました (結果不正)。' }, { status: 500 });
    }
    
    const searchQueries = analysisData.検索クエリ群 && Array.isArray(analysisData.検索クエリ群) && analysisData.検索クエリ群.length > 0 ? analysisData.検索クエリ群 : [userQuery];
    console.log(`[Phase 1] 生成された検索クエリ群: `, searchQueries);

    // --- 第2段階: 検索クエリ群に基づいてベクトル検索 ---
    console.log('[Phase 2] 複数の検索クエリで類似チャンクを検索中...');
    const matchThreshold = 0.4;
    const matchCount = 3;
    
    let allChunks = [];
    const retrievedChunkIds = new Set();

    for (const searchQuery of searchQueries) {
      if (typeof searchQuery !== 'string' || searchQuery.trim() === '') {
        console.warn(`[Phase 2] スキップされた無効な検索クエリ: "${searchQuery}"`);
        continue;
      }
      console.log(`[Phase 2] 検索実行中: "${searchQuery}"`);
      const queryEmbedding = await embeddings.embedQuery(searchQuery);
      const { data: rpcData, error: rpcError } = await supabase.rpc('match_manual_chunks', {
        query_embedding: queryEmbedding,
        match_threshold: matchThreshold,
        match_count: matchCount,
        p_selected_filenames: validSourceFilenames
      });

      if (rpcError) {
        console.warn(`[Phase 2] Supabase RPCエラー (クエリ: "${searchQuery}"):`, rpcError);
        continue; 
      }

      if (rpcData && rpcData.length > 0) {
        rpcData.forEach(chunk => {
          if (chunk && chunk.id && !retrievedChunkIds.has(chunk.id)) {
            allChunks.push(chunk);
            retrievedChunkIds.add(chunk.id);
          }
        });
      }
    }
    console.log(`[Phase 2] 合計 ${allChunks.length} 件のユニークなチャンクを取得しました。`);
    if (allChunks.length > 0) {
      console.log('[Phase 2] allChunksの内容 (最初の1件):', JSON.stringify(allChunks[0], null, 2));
    }

    let contextForLLM = "";
    if (allChunks.length > 0) {
      contextForLLM = allChunks.map(chunk => chunk.chunk_text).join('\\n\\n---\\n\\n');
    } else {
      console.log("[Phase 2] 関連するチャンクが見つかりませんでした。");
      contextForLLM = "関連する背景情報は見つかりませんでした。";
    }

    let analysisSummaryForPrompt = "";
    if (analysisData) {
        const summary = analysisData.質問の要約 || 'N/A';
        const candidates = Array.isArray(analysisData.補足情報候補) ? analysisData.補足情報候補 : [];
        analysisSummaryForPrompt = `
以下の分析結果も参考にしてください:
質問の要約: ${summary}
補足情報候補: 
${candidates.map(s => `- ${s}`).join('\\n')}
`;
    }

    // --- 第3段階: 回答生成 ---
    console.log("[Phase 3] LLMに回答生成をリクエスト中...");
    const llmResponse = await answerGenerationChain.invoke({
        input: userQuery,
        context: contextForLLM,
        analysis_summary: analysisSummaryForPrompt
    });
    
    const answer = llmResponse.response; 

    if (!answer) {
        console.error("[Phase 3] LLMからの応答形式が予期したものではありません。", llmResponse);
        return NextResponse.json({ error: 'AIからの回答取得に失敗しました。' }, { status: 500 });
    }
    console.log("[Phase 3] LLMからの回答受信完了。");

    return NextResponse.json({
      answer: answer,
      sources: allChunks.length > 0 ? allChunks.map(c => ({ 
        id: c.id, 
        manual_id: c.manual_id, 
        similarity: c.similarity, 
        text_snippet: c.chunk_text.substring(0,100) + '...' 
      })) : [],
      debug_info: {
        generated_queries: searchQueries,
        analysis_data: analysisData,
      }
    }, { status: 200 });

  } catch (error) {
    console.error("[API /api/qa] Q&A処理中に予期せぬエラー:", error);
    // エラーオブジェクトの message と stack を含める
    const errorMessage = error.message || 'サーバー内部でエラーが発生しました。';
    const errorStack = error.stack;
    return NextResponse.json({ error: errorMessage, details: errorStack }, { status: 500 });
  }
} 