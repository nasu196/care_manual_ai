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
        model: "gemini-2.0-flash", // モデル名を変更
        temperature: 0.4,
    });
  }

  // --- 第1段階LLM用: 質問分析とクエリ生成 ---
  if (!queryAnalysisChain) {
    const queryAnalysisPromptTemplateString = `\nあなたは、ユーザーからの質問の意図を完璧に読み解き、その質問に対して最も的確かつ包括的な回答を生成するために、後続のAIアシスタント（AnswerGenerationAI）がどのように情報を収集し、どのように回答を組み立てるべきかの戦略を立案する、プロフェッショナルなAIコンサルタントです。\n\nあなたのタスクは、以下のユーザーの質問を分析し、AnswerGenerationAIが最高のパフォーマンスを発揮できるように、具体的な指示と必要な情報をJSON形式で提供することです。\n\nユーザーの質問:\n「{user_query}」\nユーザーが事前に選択した参照ファイル群についての情報: {selected_source_filenames_message}\n\n以下の思考プロセスに従って、AnswerGenerationAIへの指示書を作成してください。\n\n1.  **質問の核心の特定**: ユーザーが本当に知りたいことは何か？質問の背景にある真のニーズは何か？を深く洞察してください。\n2.  **情報収集戦略の立案**:\n    *   特定した核心的ニーズに答えるために、どのような情報が必要か？\n    *   **最優先事項**: ユーザーによって事前に参照すべきファイル群が指定されている場合（ユーザーが「{selected_source_filenames_message}」でファイル名を挙げている状況）、まずはそれらのファイル群から徹底的に情報を検索し、回答の主要な根拠とすること。\n    *   その情報を効率的かつ網羅的に収集するために、どのような検索クエリが最適か？（複数の観点から、具体的なキーワードで3～7個提案。指定ファイルがある場合は、それらのファイル内容と関連性の高いクエリを優先）\n    *   検索結果から特に注目すべき情報や、深掘りすべきポイントは何か？（指定ファイルがある場合は、そのファイル内のどの部分が特に重要かを示すこと）\n    *   指定されたファイル群だけでは情報が不足する場合、またはファイル指定がない場合に限り、より広範な情報源からの検索も検討する。その際の検索戦略も併せて立案すること。\n3.  **回答生成AIへの指示事項の策定**:\n    *   AnswerGenerationAIがユーザーに回答を提示する際に、どのような点に注意すべきか？（例: 特に強調すべきポイント、避けるべき表現、補足すべき背景情報など。指定ファイルがある場合は、その内容を最大限活用するよう指示）\n    *   ユーザーが次に知りたくなるであろう関連情報や、提示することでより満足度が高まるであろう情報は何か？\n    *   **ユーザーが要求する回答の詳細度（「{verbosity_instruction}」で示される）を踏まえ、AnswerGenerationAIが生成する回答の粒度（簡潔さ、網羅性、具体例の量など）を具体的に指示すること。**\n\n上記の思考プロセスに基づき、以下のJSON形式で、具体的かつ実行可能な指示書を出力してください。キーは日本語で記述してください。\n\n\\\`\\\`\\\`json\n{{\n  \"ユーザー質問の分析と再定義\": {{\n    \"質問の核心\": \"ユーザーが最も知りたい本質的な問いを1～2文で記述\",\n    \"想定される背景・ニーズ\": \"ユーザーがこの質問をするに至った背景や、解決したい課題などを具体的に推測して記述\"\n  }},\n  \"情報収集戦略\": {{\n    \"推奨検索クエリ群\": [\n      \"効果的な検索クエリを具体的かつ多様なキーワードで3～7個提案\",\n      \"例: 『〇〇 具体的な手続き』、『〇〇 費用 相場』、『〇〇 メリット デメリット 最新情報』\"\n    ],\n    \"情報収集時の着眼点\": [\n      \"検索結果をレビューする際に特に注目すべきキーワードや情報カテゴリを3～5点記述\",\n      \"例: 『公的機関の発表情報』、『専門家の見解』、『最新の統計データ』。指定ファイルがある場合は、そのファイルからの情報を優先するよう指示\"\n    ]\n  }},\n  \"回答生成AIへの指示\": {{\n    \"回答の基本方針\": \"AnswerGenerationAIがユーザーに回答を生成する際の基本的なスタンスや目的を記述（例: ユーザーの不安を解消し、具体的な次のアクションを促す情報提供を心がける。指定ファイルからの情報を最優先とする）\",
    \"期待される回答の詳細度\": \"{verbosity_instruction}\",
    \"強調すべき主要ポイント\": [\n      \"ユーザーにとって特に価値の高い情報や、誤解を招きやすい点などを具体的に2～4点記述\"\n    ],\n    \"補足すべき有益情報\": [\n      \"質問の直接的な答え以外で、ユーザーが知っておくと役立つ関連情報や豆知識などを2～4点提案\"\n    ],\n    \"回答時の注意点\": [\n      \"文体、専門用語の使用、情報の鮮度など、回答品質を高めるための具体的な注意点を1～3点記述\"\n    ]\n  }}\n}}\n\\\`\\\`\\\`\n\nあなたの分析結果と提案（JSON形式）:\n`;
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
あなたは、プロフェッショナルなAIコンサルタント（QueryAnalysisAI）からの詳細な指示に基づき、ユーザーの質問に対して最高品質の回答を生成する、高度なAIアシスタントです。

QueryAnalysisAIからの指示書は以下の通りです。これを最優先の行動指針としてください。
<QueryAnalysisAIからの指示書>
{analysis_summary}
</QueryAnalysisAIからの指示書>

上記指示書と、別途提供される「背景情報」を徹底的に参照し、ユーザーの質問の意図を深く理解し、役立つ回答を生成してください。
**特に、QueryAnalysisAIが指摘する「強調すべき主要ポイント」や「補足すべき有益情報」、「回答時の注意点」、「期待される回答の詳細度」を必ず反映させてください。**

ユーザーからの質問「{input}」に対して、以下の思考プロセスに従って、網羅的かつ分かりやすい回答を生成してください。

1.  **QueryAnalysisAIの指示の確認と理解**: QueryAnalysisAIからの指示書（{analysis_summary}）を熟読し、特に「回答の基本方針」「期待される回答の詳細度」「強調すべき主要ポイント」「補足すべき有益情報」「回答時の注意点」を完全に把握します。

2.  **質問の分解と理解 (QueryAnalysisAIの分析を踏まえて)**: ユーザーの質問「{input}」とQueryAnalysisAIによる「ユーザー質問の分析と再定義」を照らし合わせ、ユーザーが何を知りたいのかの核心を再確認します。

3.  **背景情報の徹底的なスキャン (QueryAnalysisAIの着眼点を参考に)**: 提供された「背景情報」全体を注意深く読み込み、QueryAnalysisAIが示した「情報収集時の着眼点」も参考にしながら、ユーザーの質問とQueryAnalysisAIの指示内容に関連する可能性のある全ての箇所をリストアップします。

4.  **情報の抽出と整理**: リストアップした箇所から、質問に答えるために必要な情報を正確に抽出します。複数の箇所に関連情報がある場合は、それらを統合し、矛盾がないか確認します。情報の重要度や関連性に応じて順序付けを行います。

5.  **回答の構築 (QueryAnalysisAIの指示に従って)**: 抽出・整理した情報のみに基づいて、QueryAnalysisAIの「回答の基本方針」と「期待される回答の詳細度」に沿って、質問の核心に直接的かつ明確に回答します。ユーザーが情報を理解し、活用できるように、具体的で、**QueryAnalysisAIが指示する詳細度（例えば「簡潔に」であれば要点を絞り、「より丁寧に」であれば可能な限り詳細に）で説明を補足し**、論理的な順序で構成してください。
    回答は以下の構成とポイントを参考に、適切で分かりやすい見出しを付けてください。

    *   **導入 (または はじめに)**: QueryAnalysisAIの指示（特に「回答の基本方針」「期待される回答の詳細度」「強調すべき主要ポイント」）を踏まえ、これから説明する内容の概要や、回答全体の目的を簡潔に述べてください。

    *   **主要な情報の提示 (QueryAnalysisAIの「強調すべき主要ポイント」と「期待される回答の詳細度」を反映)**: ユーザーが求める情報とQueryAnalysisAIが強調するポイントを、背景情報から抽出した内容に基づいて、QueryAnalysisAIが指示する詳細度で、以下の観点などを参考に整理し、番号付きリストや記号付き箇条書きを用いて提示してください。各項目には、その内容を的確に表す簡潔な見出しを付けてください。各リスト項目や見出しと説明の間、および各説明文の後には、**視覚的な区切りとしてMarkdownの改行（空行を1行以上）を適切に挿入**してください。
        *   概要・定義 (What is it?)
        *   対象・条件 (Who/What qualifies?)
        *   内容・詳細 (Details)
        *   手順・方法 (How to?)
        *   時期・期間・期限 (When?)
        *   場所・範囲 (Where?)
        *   理由・根拠 (Why?)
        *   数量・金額・制限 (How much/many?)
        *   利点・欠点 (Pros and Cons)
        *   重要な注意点・考慮事項 (Important Notes/Considerations) (QueryAnalysisAIの「回答時の注意点」も反映)
        *   関連情報・参照先 (Related Info/References)
        （上記はあくまで例です。背景情報の内容とQueryAnalysisAIの指示に応じて、最も適切で分かりやすい項目立てを行ってください。）
        各ポイントについて、背景情報から得られた具体的な説明や例を**QueryAnalysisAIが指示する詳細度で**加えてください。

    *   **補足情報 (QueryAnalysisAIの「補足すべき有益情報」と「期待される回答の詳細度」を反映)**: QueryAnalysisAIが提案する補足情報や、その他主要なポイントに関連する重要な補足情報があれば、ここで**QueryAnalysisAIが指示する詳細度で**説明してください。ここでも、説明の区切りにはMarkdownの改行を適切に使用してください。

    *   **まとめと次のステップへの示唆**: 全体を簡潔にまとめ、ユーザーがこの情報をどのように活用できるか、次に何を考えるべきか、どのような行動をとるべきかのヒントや具体的な推奨事項があれば提示してください。

6.  **自己検証**: 生成した回答が、QueryAnalysisAIの指示（特に「期待される回答の詳細度」）と上記の構成に従い、背景情報に基づいており、質問の意図に完全に合致しているか、そしてユーザーが求めるであろう情報の深さと網羅性を満たしているかを確認します。もし不足があれば、ステップ4に戻り情報を再検討してください。

**重要な指示:**
*   QueryAnalysisAIからの指示書と背景情報を最優先の根拠とします。ただし、ユーザーの質問に答える上で背景情報だけでは明らかに不足しており、かつ一般的なビジネス慣習や公知の事実で安全に補完できる範囲の情報であれば、**必ず「これは一般的な注意点ですが、」や「QueryAnalysisAIからの指示や背景情報には直接の記載がありませんが、企業の一般的な対応としては、」のように、その情報がQueryAnalysisAIの指示や背景情報由来ではないことを明確に示した上で**補足することを検討してください。推測や不確実な情報、個人的な意見は決して含めないでください。
*   ユーザーが「対象となる経費」について尋ねた場合は、まず「対象となる経費」を具体的に説明し、その後に必要であれば補足情報（対象外の経費など）を加えてください。ユーザーが直接尋ねていない情報から話し始めないでください。
*   もしQueryAnalysisAIからの指示や「背景情報」だけでは答えられない場合や、質問が「背景情報」の内容と明らかに関連がないと判断される場合は、その旨を正直に、そして明確に伝えてください。
*   **回答は必ず日本語で、自然で分かりやすい文章で記述してください。**
*   **ユーザー向けの最終的な回答文には、AIの内部的な処理や、他のAIモジュールの存在（例：QueryAnalysisAI、AIコンサルタント、指示書といった言葉）に言及する記述は一切含めないでください。ユーザーには、あなたが単独で全ての情報を分析し、回答を生成したように自然に振る舞ってください。**

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

    const { query: userQuery, source_filenames: sourceFilenames, verbosity: userVerbosity } = await request.json();

    if (!userQuery || typeof userQuery !== 'string' || userQuery.trim() === '') {
      return NextResponse.json({ error: '質問内容 (query) が必要です。' }, { status: 400 });
    }

    const validSourceFilenames = Array.isArray(sourceFilenames) && sourceFilenames.every(item => typeof item === 'string') 
      ? sourceFilenames 
      : null;

    console.log(`[API /api/qa] User Query: "${userQuery}", Source Filenames:`, validSourceFilenames);

    // --- 第1段階: 質問分析と検索クエリ生成 ---
    console.log(`[Phase 1] ユーザーの質問を分析中: "${userQuery}"`);
    
    let selectedSourceFilenamesMessage = "ファイルは指定されていません。広範な知識ベースから回答を生成してください。";
    if (validSourceFilenames && validSourceFilenames.length > 0) {
      selectedSourceFilenamesMessage = `以下のファイルが優先的に参照されるべきです: ${validSourceFilenames.join(', ')}。これらのファイル内の情報を最優先で活用し、それでも情報が不足する場合にのみ、他の情報源を考慮してください。`;
    }

    let verbosityInstruction = "標準的な詳細度で回答してください。";
    if (userVerbosity === 'concise') {
      verbosityInstruction = "回答は簡潔に、要点を絞って記述してください。";
    } else if (userVerbosity === 'detailed') {
      verbosityInstruction = "回答は可能な限り詳細に、背景情報や具体例を豊富に盛り込んで記述してください。";
    }

    const analysisResultRaw = await queryAnalysisChain.invoke({ 
        user_query: userQuery,
        selected_source_filenames_message: selectedSourceFilenamesMessage,
        verbosity_instruction: verbosityInstruction
    });
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
        const userAnalysis = analysisData.ユーザー質問の分析と再定義 || {};
        const strategy = analysisData.情報収集戦略 || {};
        const qaAiAdvice = analysisData.回答生成AIへの指示 || {};

        const lines = [
          "ユーザー質問の分析と再定義:",
          `  質問の核心: ${userAnalysis.質問の核心 || 'N/A'}`,
          `  想定される背景・ニーズ: ${userAnalysis["想定される背景・ニーズ"] || 'N/A'}`,
          "",
          "情報収集戦略のサマリー:",
          `  推奨検索クエリ群: ${(strategy.推奨検索クエリ群 || []).join(', ') || 'N/A'}`,
          `  情報収集時の着眼点: ${(strategy.情報収集時の着眼点 || []).join(', ') || 'N/A'}`,
          "",
          "回答生成AIへの指示:",
          `  回答の基本方針: ${qaAiAdvice.回答の基本方針 || 'N/A'}`,
          `  期待される回答の詳細度: ${qaAiAdvice["期待される回答の詳細度"] || '標準的な詳細度で回答してください。'}`,
          "  強調すべき主要ポイント:",
          ...(qaAiAdvice.強調すべき主要ポイント || []).map(s => `    - ${s}`),
          qaAiAdvice.強調すべき主要ポイント && qaAiAdvice.強調すべき主要ポイント.length > 0 ? "" : "    - N/A",
          "  補足すべき有益情報:",
          ...(qaAiAdvice.補足すべき有益情報 || []).map(s => `    - ${s}`),
          qaAiAdvice.補足すべき有益情報 && qaAiAdvice.補足すべき有益情報.length > 0 ? "" : "    - N/A",
          "  回答時の注意点:",
          ...(qaAiAdvice.回答時の注意点 || []).map(s => `    - ${s}`),
          qaAiAdvice.回答時の注意点 && qaAiAdvice.回答時の注意点.length > 0 ? "" : "    - N/A",
        ];
        analysisSummaryForPrompt = lines.filter(line => line !== "" || !lines[lines.indexOf(line)-1]?.endsWith(":") ).join('\n');
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