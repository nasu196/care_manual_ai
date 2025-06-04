import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
// import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai'; // OpenAIを使用するためコメントアウト
import { OpenAIEmbeddings } from '@langchain/openai'; // OpenAIEmbeddingsをインポート
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { LLMChain } from "langchain/chains"; // ConversationChain を削除
import { PromptTemplate } from "@langchain/core/prompts";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

// 環境変数
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY; // ChatGoogleGenerativeAI で引き続き使用
const openaiApiKey = process.env.OPENAI_API_KEY; // OpenAIEmbeddings で使用
// const gcpProjectId = process.env.GCP_PROJECT_ID; // Vertex AI 用のプロジェクトID -> コメントアウト
// const gcpLocation = process.env.GCP_LOCATION; // Vertex AI 用のロケーション -> コメントアウト

// グローバルスコープでの初期化 (App Routerの性質上、リクエストごとに再初期化される可能性に注意)
let supabase;
let chatModelForAnalysis;
let queryAnalysisChain;
let geminiModelForAnswer;
let chatModelForPhase0; // Phase 0 用チャットモデル（履歴はクライアント管理）
let phase0Chain; // Phase 0 用チェーン（メモリなし）

// 初期化関数
function initializeClientsAndChains() {
  // OpenAI APIキーのチェックを追加 (geminiApiKeyのチェックはChatモデル用に残す)
  if (!supabaseUrl || !supabaseAnonKey || !geminiApiKey || !openaiApiKey) {
    console.error("エラー: 必要な環境変数 (SUPABASE_URL, SUPABASE_ANON_KEY, GEMINI_API_KEY, OPENAI_API_KEY) が設定されていません。");
    throw new Error("サーバー設定エラー: APIキーまたはURLが不足しています。");
  }

  if (!supabase) {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
  }
  
  if (!chatModelForPhase0) {
    chatModelForPhase0 = new ChatGoogleGenerativeAI({
        apiKey: geminiApiKey,
        model: "gemini-1.5-flash-latest",
        temperature: 0.2,
    });
  }

  if (!phase0Chain) {
    // Phase 0 の RAG要否判定と簡易応答生成用プロンプト（履歴はクライアントから受信）
    const phase0PromptTemplateString = `あなたはユーザーとの対話履歴と現在の質問を分析し、ドキュメント検索(RAG)が必要かどうかを判断し、必要に応じて直接回答を生成するAIアシスタントです。

以下の極めて限定的な条件でのみRAGが不要と判断してください：
- 純粋な挨拶（「こんにちは」「おはよう」「こんばんは」）
- 純粋な感謝（「ありがとう」「お疲れ様」）
- 会話終了の意思表示（「さようなら」「終了します」「終わります」）
- 前回のAI回答内容の正確な翻訳依頼（「〇〇語に翻訳して」「〇〇語で教えて」）

**重要：以下は必ずRAGが必要です：**
- マニュアルの内容に関する質問
- 新しい情報を求める質問
- 手順や方法を尋ねる質問
- 機能や設定について聞く質問
- 前回の回答に対する追加の詳細を求める質問

RAGが不要と判断した場合（極めて限定的な場合のみ）：
- 会話履歴の内容を参照して応答してください
- 翻訳の場合は、前回のAIの回答内容を正確に指定言語に翻訳してください
- 回答の前に "RAG_NOT_NEEDED_ANSWER_FOLLOWS:" を付けてください

RAGが必要と判断した場合（ほとんどの場合）：
- "RAG_NEEDED" という文字列のみを出力してください

これまでの会話履歴:
{chat_history}

ユーザーの現在の質問:
{user_query}

あなたの判断と応答:`;
    const phase0PromptTemplate = PromptTemplate.fromTemplate(phase0PromptTemplateString);

    phase0Chain = new LLMChain({
      llm: chatModelForPhase0,
      prompt: phase0PromptTemplate,
      outputKey: "phase0_output",
    });
    console.log("[API /api/qa] Phase 0 chain initialized (client-side history).");
  }

  if (!chatModelForAnalysis) {
    chatModelForAnalysis = new ChatGoogleGenerativeAI({
        apiKey: geminiApiKey,
        model: "gemini-1.5-flash-latest",
        temperature: 0.4,
    });
    console.log("[API /api/qa] Gemini model for answer generation initialized with gemini-1.5-flash-latest.");
  }

  // --- 第1段階LLM用: 質問分析とクエリ生成 ---
  if (!queryAnalysisChain) {
    const queryAnalysisPromptTemplateString = `\nあなたは、ユーザーからの質問の意図を完璧に読み解き、その質問に対して最も的確かつ包括的な回答を生成するために、後続のAIアシスタント（以下、AnswerGenerationAI）がどのように情報を収集し、どのように回答を組み立てるべきかの戦略を立案する、プロフェッショナルなAIコンサルタントです。\n\nあなたのタスクは、以下のユーザーの質問を分析し、AnswerGenerationAIが最高のパフォーマンスを発揮できるように、具体的かつ実行可能な指示をJSON形式で提供することです。\n\nユーザーの質問:\n「{user_query}」\nユーザーが事前に選択した参照ファイル群についての情報: {selected_source_filenames_message}\n会話履歴: {chat_history_summary}\n\n以下の思考プロセスに従って、AnswerGenerationAIへの指示書を作成してください。\n\n1.  **質問の核心の特定**: ユーザーが本当に知りたいことは何か？質問の背景にある真のニーズは何か？を深く洞察してください。会話履歴も参考にして文脈を理解してください。\n2.  **情報収集戦略の立案**: articulating strategy for information gathering
    *   特定した核心的ニーズに答えるために、どのような情報が必要か？\n    *   **最優先事項**: ユーザーによって事前に参照すべきファイル群が指定されている場合（ユーザーが「{selected_source_filenames_message}」でファイル名を挙げている状況）、まずはそれらのファイル群から徹底的に情報を検索し、回答の主要な根拠とすること。\n    *   その情報を効率的かつ網羅的に収集するために、どのような検索クエリが最適か？（複数の観点から、具体的なキーワードで3～7個提案。**生成する検索クエリには、ユーザーが指定したファイル名そのものを含めないでください。** 指定ファイルがある場合は、それらのファイル内容と関連性の高いキーワードベースのクエリを優先）\n    *   検索結果から特に注目すべき情報や、深掘りすべきポイントは何か？（指定ファイルがある場合は、そのファイル内のどの部分が特に重要かを示すこと）\n    *   指定されたファイル群だけでは情報が不足する場合、またはファイル指定がない場合に限り、より広範な情報源からの検索も検討する。その際の検索戦略も併せて立案すること。\n3.  **AnswerGenerationAIへの指示事項の策定**:
    *   AnswerGenerationAIがユーザーに回答を提示する際に、どのような点に注意すべきか？（例: 特に強調すべきポイント、避けるべき表現、補足すべき背景情報など。指定ファイルがある場合は、その内容を最大限活用するよう指示）\n    *   ユーザーが次に知りたくなるであろう関連情報や、提示することでより満足度が高まるであろう情報は何か？\n    *   **ユーザーが要求する回答の詳細度（「{verbosity_instruction}」で示される）を踏まえ、AnswerGenerationAIが生成する回答の粒度（簡潔さ、網羅性、具体例の量など）を具体的に指示すること。**\n    *   **最重要指示**: AnswerGenerationAIが最終的にユーザーへ提示する回答文には、AI自身の内部的な処理、思考の過程、あるいは他のAIシステム（あなた自身の存在を含む）や、「指示書」「分析サマリー」「内部情報」といった言葉への言及を**絶対に含めない**ように、AnswerGenerationAIへ厳重に指示してください。AnswerGenerationAIは、あたかも全ての情報を独自に理解し、ユーザーのためだけに自然な言葉で回答を生成したかのように振る舞うべきです。この指示は、生成するJSON内の「回答の基本方針」や「回答時の注意点」に明確に反映させてください。\n\n上記の思考プロセスに基づき、以下のJSON形式で、具体的かつ実行可能な指示書を出力してください。キーは日本語で記述してください。\n\n\\\`\\\`\\\`json\n{{\n  \"ユーザー質問の分析と再定義\": {{\n    \"質問の核心\": \"ユーザーが最も知りたい本質的な問いを1～2文で記述\",\n    \"想定される背景・ニーズ\": \"ユーザーがこの質問をするに至った背景や、解決したい課題などを具体的に推測して記述\"\n  }},\n  \"情報収集戦略\": {{\n    \"推奨検索クエリ群\": [\n      \"効果的な検索クエリを具体的かつ多様なキーワードで3～7個提案\",\n      \"例: 『〇〇 具体的な手続き』、『〇〇 費用 相場』、『〇〇 メリット デメリット 最新情報』\"\n    ],\n    \"情報収集時の着眼点\": [\n      \"検索結果をレビューする際に特に注目すべきキーワードや情報カテゴリを3～5点記述\",\n      \"例: 『公的機関の発表情報』、『専門家の見解』、『最新の統計データ』。指定ファイルがある場合は、そのファイルからの情報を優先するよう指示\"\n    ]\n  }},\n  \"回答生成AIへの指示\": {{\n    \"回答の基本方針\": \"ユーザーの疑問点を解消し、次の行動を具体的に促せるような、明確で実用的な情報提供を心がける。指定ファイルからの情報を最優先とする。\",\n    \"期待される回答の詳細度\": \"{verbosity_instruction}\",\n    \"強調すべき主要ポイント\": [\n      \"ユーザーにとって特に価値の高い情報や、誤解を招きやすい点などを具体的に2～4点記述\"\n    ],\n    \"補足すべき有益情報\": [\n      \"質問の直接的な答え以外で、ユーザーが知っておくと役立つ関連情報や豆知識などを2～4点提案\"\n    ],\n    \"回答時の注意点\": [\n      \"専門用語の使用は避け、平易な言葉で説明する。\",\n      \"ユーザー向けの回答文には、AI自身の内部処理や思考プロセス、システム構造に関する言葉（例：AI、指示、分析結果など）は一切含めず、自然な対話形式で回答する。\",\n      \"情報の鮮度や正確性には最大限配慮する。\"
    ]\n  }}\n}}\n\\\`\\\`\\\`\n\nあなたの分析結果と提案（JSON形式）:\n`;
    const queryAnalysisPromptTemplate = PromptTemplate.fromTemplate(queryAnalysisPromptTemplateString);
    queryAnalysisChain = new LLMChain({
      llm: chatModelForAnalysis,
      prompt: queryAnalysisPromptTemplate,
      outputKey: "analysis_result",
    });
  }

  // --- 第2段階LLM用: 回答生成 (直接SDKを使用) ---
  if (!geminiModelForAnswer) {
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    geminiModelForAnswer = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      ],
      generationConfig: {
        temperature: 0.4,
      },
    });
    console.log("[API /api/qa] Gemini model for answer generation initialized with gemini-2.0-flash.");
  }
}

export async function POST(request) {
  try {
    initializeClientsAndChains();

    // リクエストボディを先に取得してshareIdをチェック
    const requestBody = await request.json();
    const { query: userQuery, source_filenames: initialSourceFilenames, verbosity: userVerbosity, shareId, chat_history } = requestBody; // chat_history を追加
    let sourceFilenames = initialSourceFilenames;

    // リクエストヘッダーからAuthorizationを取得
    const authHeader = request.headers.get('Authorization');
    console.log(`[API /api/qa] Authorization header:`, authHeader ? 'Present' : 'Missing');
    console.log(`[API /api/qa] ShareId:`, shareId ? 'Present' : 'Missing');

    let authenticatedSupabase;

    if (shareId) {
      // 共有ページの場合は認証不要でサービスロールキーを使用
      console.log('[API /api/qa] Using service role key for shared access');
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseServiceKey) {
        return NextResponse.json({ error: 'サーバー設定エラー: サービスロールキーが設定されていません。' }, { status: 500 });
      }
      
      authenticatedSupabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
          persistSession: false,
        },
      });

      // 共有設定を取得して有効性を確認
      const { data: shareConfig, error: shareError } = await authenticatedSupabase
        .from('share_configs')
        .select('*')
        .eq('id', shareId)
        .single();

      if (shareError || !shareConfig) {
        console.error('[API /api/qa] Share config not found:', shareError);
        return NextResponse.json({ error: '共有設定が見つかりません。' }, { status: 404 });
      }

      // 共有設定のソースファイル名を使用（リクエストのsource_filenamesは無視）
      sourceFilenames = shareConfig.selected_source_names;
      console.log('[API /api/qa] Using source filenames from share config:', sourceFilenames);
    } else {
      // 通常のページの場合は認証が必要
      if (!authHeader) {
        return NextResponse.json({ error: '認証情報が必要です。' }, { status: 401 });
      }

      // 認証情報付きのSupabaseクライアントを作成
      authenticatedSupabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
        auth: {
          persistSession: false,
        },
      });
    }

    if (!userQuery || typeof userQuery !== 'string' || userQuery.trim() === '') {
      return NextResponse.json({ error: '質問内容 (query) が必要です。' }, { status: 400 });
    }

    // クライアントから送られた会話履歴を整形
    const formattedChatHistory = Array.isArray(chat_history) && chat_history.length > 0
      ? chat_history.map(msg => `${msg.type === 'user' ? 'ユーザー' : 'AI'}: ${msg.content}`).join('\n')
      : '会話履歴なし';

    // Phase 0: RAG要否判定と簡易応答
    console.log(`[Phase 0] RAG要否判定開始: "${userQuery}"`);
    console.log(`[Phase 0] クライアント履歴:`, formattedChatHistory);

    const phase0Result = await phase0Chain.invoke({ 
      user_query: userQuery,
      chat_history: formattedChatHistory
    });
    const phase0Output = phase0Result.phase0_output;
    console.log(`[Phase 0] 判定結果: ${phase0Output}`);
    console.log(`[Phase 0] 判定結果の先頭文字列確認: "${phase0Output.substring(0, 50)}"`);
    console.log(`[Phase 0] startsWith check:`, phase0Output.startsWith("RAG_NOT_NEEDED_ANSWER_FOLLOWS:"));

    if (phase0Output.startsWith("RAG_NOT_NEEDED_ANSWER_FOLLOWS:")) {
      const directAnswer = phase0Output.substring("RAG_NOT_NEEDED_ANSWER_FOLLOWS:".length).trim();
      console.log(`[Phase 0] RAG不要と判定。直接回答を返却: "${directAnswer}"`);
      console.log(`[Phase 0] directAnswerの長さ: ${directAnswer.length}`);
      
      // ストリーミング形式で回答を返す（JSON形式ではなく）
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          try {
            console.log(`[Phase 0] ストリーミング開始: "${directAnswer}"`);
            
            // 文字を少しずつ送信して自然なストリーミング感を演出
            const chunkSize = 20; // 10文字ずつ送信
            for (let i = 0; i < directAnswer.length; i += chunkSize) {
              const chunk = directAnswer.substring(i, i + chunkSize);
              controller.enqueue(encoder.encode(chunk));
              console.log(`[Phase 0] チャンク送信: "${chunk}"`);
              
              // 少し遅延を入れて自然なストリーミング感を演出
              if (i + chunkSize < directAnswer.length) {
                await new Promise(resolve => setTimeout(resolve, 30)); // 30ms遅延
              }
            }
            
            console.log(`[Phase 0] 回答ストリーミング完了`);
            
            // ソースセパレータを別のchunkとして送信（フロントエンドの処理に合わせて）
            const sourcesSeparator = "\n\nSOURCES_SEPARATOR_MAGIC_STRING\n\n";
            controller.enqueue(encoder.encode(sourcesSeparator));
            console.log(`[Phase 0] セパレータエンコード完了`);
            
            // ソース情報を別のchunkとして送信
            controller.enqueue(encoder.encode(JSON.stringify([])));
            console.log(`[Phase 0] ソース情報エンコード完了`);
            
            console.log("[Phase 0] ストリーミング完了（直接回答）。");
          } catch (e) {
            console.error("[Phase 0] 直接回答ストリーミング中にエラー発生:", e);
            const errorMessage = `\n\nエラー: 回答の生成中に問題が発生しました。詳細: ${e.message}`;
            controller.enqueue(encoder.encode(errorMessage));
          }
          controller.close();
        },
      });

      return new Response(stream, {
        headers: { 
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff'
        },
      });
    }
    
    console.log(`[Phase 0] RAG必要と判定。従来のRAGフローへ。`);

    const validSourceFilenames = Array.isArray(sourceFilenames) && sourceFilenames.every(item => typeof item === 'string') 
      ? sourceFilenames 
      : null;

    console.log(`[API /api/qa] Received parameters:`, { query: userQuery, sourceFilenames: validSourceFilenames, verbosity: userVerbosity });

    // --- ファイル名解決 ---
    let encodedSourceFilenamesForRpc = null;
    let selectedManualIdsForRpc = null;

    if (validSourceFilenames && validSourceFilenames.length > 0) {
      console.log(`[API /api/qa] ファイル名解決開始: validSourceFilenames =`, validSourceFilenames);
      // Base64エンコード済みファイル名と元のファイル名の両方で検索し、idも取得
      const { data: manualData, error: manualError } = await authenticatedSupabase
        .from('manuals')
        .select('id, file_name, original_file_name')
        .or(`file_name.in.(${validSourceFilenames.map(f => `"${f}"`).join(',')}),original_file_name.in.(${validSourceFilenames.map(f => `"${f}"`).join(',')})`);
      
      if (manualError) {
        console.error(`[API /api/qa] Error fetching manual data:`, manualError);
        return NextResponse.json({ error: `ファイル名の解決に失敗しました: ${manualError.message}` }, { status: 500 });
      }
      console.log(`[API /api/qa] DBから取得したマニュアルデータ (manualData):`, manualData ? `${manualData.length}件` : '0件', manualData);
      if (manualData && manualData.length > 0) {
        encodedSourceFilenamesForRpc = manualData.map(manual => manual.file_name);
        selectedManualIdsForRpc = manualData.map(manual => manual.id);
        console.log('[API /api/qa] Resolved file_names from DB:', encodedSourceFilenamesForRpc);
        console.log('[API /api/qa] Resolved manual_ids from DB:', selectedManualIdsForRpc);
      } else {
        encodedSourceFilenamesForRpc = [];
        selectedManualIdsForRpc = [];
        console.log('[API /api/qa] No matching files found in DB for:', validSourceFilenames);
      }
    }
    console.log('[API /api/qa] Encoded source filenames for RPC:', encodedSourceFilenamesForRpc);
    console.log('[API /api/qa] Selected manual IDs for RPC:', selectedManualIdsForRpc);

    // --- 第1段階: 質問分析 ---
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
    
    // 会話履歴のサマリーを作成（長すぎる場合は短縮）
    const chatHistorySummary = formattedChatHistory.length > 500 
      ? formattedChatHistory.substring(0, 500) + "...(以下省略)"
      : formattedChatHistory;
    
    const analysisResultRaw = await queryAnalysisChain.invoke({ 
        user_query: userQuery,
        selected_source_filenames_message: selectedSourceFilenamesMessage,
        verbosity_instruction: verbosityInstruction,
        chat_history_summary: chatHistorySummary
    });
    let analysisData;
    try {
      let jsonString = analysisResultRaw.analysis_result;
      // ```json と ``` で囲まれた部分を抽出
      const match = jsonString.match(/```json\n([\s\S]*?)\n```/);
      if (match && match[1]) {
        jsonString = match[1];
      } else if (jsonString.startsWith("```json")) {
        jsonString = jsonString.substring(jsonString.indexOf('\n') + 1);
        if (jsonString.endsWith("```")) {
            jsonString = jsonString.substring(0, jsonString.lastIndexOf('\n'));
      }
      }
      analysisData = JSON.parse(jsonString.trim());
    } catch (e) {
      console.error("[Phase 1] LLMからの分析結果(JSON)のパースに失敗しました。", e, "Raw output:", analysisResultRaw.analysis_result);
      return NextResponse.json({ error: '質問分析中にエラーが発生しました (結果不正)。' }, { status: 500 });
    }
    const searchQueries = analysisData.情報収集戦略?.推奨検索クエリ群 && Array.isArray(analysisData.情報収集戦略.推奨検索クエリ群) && analysisData.情報収集戦略.推奨検索クエリ群.length > 0 
                        ? analysisData.情報収集戦略.推奨検索クエリ群 
                        : [userQuery];
    console.log(`[Phase 1] 生成された検索クエリ群: `, searchQueries);

    // --- 第2段階: ベクトル検索 ---
    console.log('[Phase 2] 複数の検索クエリで類似チャンクを検索中...');
    const matchThreshold = 0.6;   // 0.8 → 0.6 に調整（バランス重視）
    const matchCount = 5;          // 5 を維持
    let allChunks = [];
    const retrievedChunkIds = new Set();

    for (const searchQuery of searchQueries) {
      if (typeof searchQuery !== 'string' || searchQuery.trim() === '') continue;
      console.log(`[Phase 2] 検索実行中: "${searchQuery}"`);
      
      let embedding;
      let freshEmbeddings; 

      if (searchQuery) {
        console.log('[Phase 2] Initializing OpenAIEmbeddings for query embedding generation.');
        freshEmbeddings = new OpenAIEmbeddings(); // APIキーは環境変数から自動読み込み
        // freshEmbeddings = new GoogleGenerativeAIEmbeddings({
        //   apiKey: geminiApiKey,
        //   model: "text-embedding-004", 
        //   taskType: "SEMANTIC_SIMILARITY", // RETRIEVAL_QUERY or SEMANTIC_SIMILARITY
        // });

        console.log(`[Phase 2] Embedding生成開始: "${searchQuery}"`);
        try {
          embedding = await freshEmbeddings.embedQuery(searchQuery);
        } catch (embeddingError) {
          console.error(`[Phase 2] Embedding生成エラー:`, embeddingError);
          continue;
        }
      }
      
      let currentUserId = null;
      if (!shareId) {  
        try {
          const authHeader = request.headers.get('Authorization');
          if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.replace('Bearer ', '');
            const parts = token.split('.');
            if (parts.length === 3) {
              const payload = JSON.parse(atob(parts[1]));
              currentUserId = payload.sub || payload.user_id || payload.user_metadata?.user_id;
            }
          }
        } catch (e) {
          console.error('[Phase 2] Failed to extract user ID from JWT:', e);
        }
      }
      
      console.log(`[Phase 2] Current user ID: ${currentUserId}, ShareId: ${shareId ? 'Present' : 'None'}`);
      
      const rpcParams = {
        query_embedding: embedding,
        match_threshold: matchThreshold,
        match_count: matchCount,
        p_user_id: currentUserId,
        p_selected_manual_ids: selectedManualIdsForRpc,
        p_share_id: shareId
      };
      
      console.log('[Phase 2] Calling match_manual_chunks with params:', { 
        match_threshold: rpcParams.match_threshold, 
        match_count: rpcParams.match_count, 
        p_user_id: rpcParams.p_user_id, 
        p_selected_manual_ids: rpcParams.p_selected_manual_ids,
        p_selected_manual_ids_count: rpcParams.p_selected_manual_ids?.length,
        p_share_id: rpcParams.p_share_id,
        embedding_length: rpcParams.query_embedding?.length
      });

      // 変数名を fetchedChunks に変更して衝突を回避
      const { data: fetchedChunks, error } = await authenticatedSupabase.rpc('match_manual_chunks', rpcParams);
      
      if (error) {
        console.error(`[Phase 2] RPC呼び出しエラー:`, {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          query: searchQuery,
          params: {
            match_threshold: rpcParams.match_threshold,
            p_user_id: rpcParams.p_user_id,
            p_selected_manual_ids: rpcParams.p_selected_manual_ids,
            p_share_id: rpcParams.p_share_id
          }
        });
        continue;
      }
      
      console.log(`[Phase 2] RPC結果 - fetchedChunks数: ${fetchedChunks ? fetchedChunks.length : 0}`);
      if (fetchedChunks && fetchedChunks.length > 0) {
        console.log(`[Phase 2] 取得したチャンクの詳細:`, fetchedChunks.map(c => ({ 
          id: c.id, 
          similarity: c.similarity, 
          filename: c.manual_filename,
          original_filename: c.original_manual_filename,
          text_preview: c.chunk_text ? c.chunk_text.substring(0, 50) + '...' : 'N/A'
        })));
      } else {
        console.warn(`[Phase 2] チャンクが0件でした。クエリ: "${searchQuery}"`);
        if (selectedManualIdsForRpc && selectedManualIdsForRpc.length > 0) {
          const { data: debugChunks, error: debugError } = await authenticatedSupabase
            .from('manual_chunks')
            .select('id, manual_id')
            .in('manual_id', selectedManualIdsForRpc)
            .limit(5);
          
          if (debugError) {
            console.error(`[Phase 2 Debug] チャンク存在確認エラー:`, debugError);
          } else if (debugChunks) {
            console.log(`[Phase 2 Debug] 対象マニュアルのチャンク存在確認: ${debugChunks.length}件存在`);
          }
        }
      }
      
      // fetchedChunks を allChunks にマージする
      if (fetchedChunks && fetchedChunks.length > 0) {
        fetchedChunks.forEach(chunk => {
          if (chunk && chunk.id && !retrievedChunkIds.has(chunk.id)) {
            allChunks.push(chunk); // allChunks はループの外で宣言されている想定
            retrievedChunkIds.add(chunk.id);
          }
        });
      }
    }
    allChunks.sort((a, b) => b.similarity - a.similarity);
    const topNChunks = allChunks.slice(0, 12);  // 7 → 12 に増加
    console.log(`[Phase 2] 検索結果: ${topNChunks.length}件のチャンクを取得。`);

    // 参照元は非表示にする（関係ない情報の場合に混乱を避けるため）
    const sourcesForClient = [];

    // ★ デバッグログ追加: sourcesForClient の内容確認
    console.log("[API /api/qa] Sources for client:", JSON.stringify(sourcesForClient, null, 2));

    // --- 第3段階: 回答生成 (ストリーミング対応) ---
    console.log("[Phase 3] LLMに回答生成をリクエスト中 (ストリーミング開始)...");

    const contextForLLM = topNChunks.map((chunk, index) => 
      `背景情報 ${index + 1} (ファイル: ${chunk.manual_filename || "不明なファイル"}, ページ: ${chunk.page_number !== null ? chunk.page_number : "N/A"}, 類似度: ${chunk.similarity.toFixed(3)}):\n${chunk.chunk_text}`
    ).join('\n\n---\n\n');

    // ★ デバッグログ追加: contextForLLM の内容確認
    console.log("[API /api/qa] Context for LLM (first 500 chars):", contextForLLM.substring(0, 500));
    if (topNChunks.length > 0 && (!contextForLLM || contextForLLM.trim() === "")) {
      console.warn("[API /api/qa] Warning: contextForLLM is empty despite having chunks. Check chunk.content.");
      topNChunks.forEach((chunk, index) => {
        console.log(`[API /api/qa] Chunk ${index} content (first 100 chars):`, chunk.chunk_text ? chunk.chunk_text.substring(0,100) : "[EMPTY CHUNK CONTENT]");
      });
    }

    const analysisSummaryForPrompt = JSON.stringify(analysisData, null, 2);
    const answerGenerationSystemPrompt = `
あなたは、ユーザーの質問に対して、提供された「分析サマリー」と「背景情報」、「会話履歴」を基に、最高品質の回答を生成する高度なAIアシスタントです。

提供された「分析サマリー」は以下の通りです。これを回答生成の主要な指針としてください。
<分析サマリー>
${analysisSummaryForPrompt}
</分析サマリー>

これまでの会話履歴:
${formattedChatHistory}

上記「分析サマリー」と、別途提供される「背景情報」、「会話履歴」を徹底的に参照し、ユーザーの質問の意図を深く理解し、役立つ回答を生成してください。
**特に、「分析サマリー」内で指摘されている「強調すべき主要ポイント」や「補足すべき有益情報」、「回答時の注意点」、「期待される回答の詳細度」を必ず反映させてください。**

ユーザーからの質問「${userQuery}」に対して、以下の思考プロセスに従って、網羅的かつ分かりやすい回答を生成してください。

1.  提供された「分析サマリー」の確認と理解: 「分析サマリー」（上記）を熟読し、特に「回答の基本方針」「期待される回答の詳細度」「強調すべき主要ポイント」「補足すべき有益情報」「回答時の注意点」を完全に把握します。
2.  質問の分解と理解 (「分析サマリー」と会話履歴を踏まえて): ユーザーの質問「${userQuery}」と「分析サマリー」による「ユーザー質問の分析と再定義」、そして会話履歴を照らし合わせ、ユーザーが何を知りたいのかの核心を再確認します。
3.  背景情報の徹底的なスキャン (「分析サマリー」の着眼点を参考に): 提供された「背景情報」全体を注意深く読み込み、「分析サマリー」が示した「情報収集時の着眼点」も参考にしながら、ユーザーの質問と「分析サマリー」の指示内容に関連する可能性のある全ての箇所をリストアップします。
4.  情報の抽出と整理: リストアップした箇所から、質問に答えるために必要な情報を正確に抽出します。複数の箇所に関連情報がある場合は、それらを統合し、矛盾がないか確認します。情報の重要度や関連性に応じて順序付けを行います。
5.  回答の構築 (「分析サマリー」の指示に従って): 抽出・整理した情報のみに基づいて、「分析サマリー」の「回答の基本方針」と「期待される回答の詳細度」に沿って、質問の核心に直接的かつ明確に回答します。ユーザーが情報を理解し、活用できるように、具体的で、「分析サマリー」が指示する詳細度で説明を補足し、論理的な順序で構成してください。
    回答は以下の構成とポイントを参考に、適切で分かりやすい見出しを付けてください。
    *   導入 (または はじめに)
    *   主要な情報の提示 (「分析サマリー」の「強調すべき主要ポイント」と「期待される回答の詳細度」を反映)
    *   補足情報 (「分析サマリー」の「補足すべき有益情報」と「期待される回答の詳細度」を反映)
    *   まとめと次のステップへの示唆
6.  自己検証

**重要な指示:**
*   提供された「分析サマリー」と「背景情報」、「会話履歴」を最優先の根拠とします。推測や不確実な情報、個人的な意見は決して含めないでください。
*   もし「分析サマリー」や「背景情報」だけでは答えられない場合や、質問が「背景情報」の内容と明らかに関連がないと判断される場合は、その旨を正直に、そして明確に伝えてください。
*   回答は必ず日本語で、自然で分かりやすい文章で記述してください。
*   **最重要:** ユーザーへの回答文には、あなた自身の内部処理、思考プロセス、または「分析サマリー」や「背景情報」といった言葉を含む、内部的な情報源やシステムの存在を示唆するような記述は一切しないでください。あたかもあなたが全ての情報を直接理解し、ユーザーのためだけに回答を生成したかのように、自然に振る舞ってください。

背景情報:
${contextForLLM}

ユーザーの質問 (再度掲載):
${userQuery}

あなたの回答 (日本語で記述):
`;

    const fullPromptForGemini = answerGenerationSystemPrompt;
    // ★ デバッグログ追加: fullPromptForGemini の背景情報部分確認
    const contextStartIndex = fullPromptForGemini.indexOf("背景情報:\n");
    const promptContextExcerpt = fullPromptForGemini.substring(contextStartIndex, contextStartIndex + 500);
    console.log("[API /api/qa] Excerpt of full prompt (context part):", promptContextExcerpt);

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          const result = await geminiModelForAnswer.generateContentStream([fullPromptForGemini]);
          for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            if (chunkText) {
              controller.enqueue(encoder.encode(chunkText));
            }
          }
          if (sourcesForClient && sourcesForClient.length > 0) {
            const sourcesSeparator = "\n\nSOURCES_SEPARATOR_MAGIC_STRING\n\n";
            controller.enqueue(encoder.encode(sourcesSeparator));
            controller.enqueue(encoder.encode(JSON.stringify(sourcesForClient)));
          }
          
          // Note: クライアントサイド履歴管理のため、ここでの履歴保存は不要
          console.log("[Phase 3] ストリーミング完了。");
        } catch (e) {
          console.error("[Phase 3] 回答生成ストリーミング中にエラー発生:", e);
          const errorMessage = `\n\nエラー: 回答の生成中に問題が発生しました。詳細: ${e.message}`;
          controller.enqueue(encoder.encode(errorMessage));
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { 
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff'
      },
    });

  } catch (error) {
    console.error("[API /api/qa] 全体エラーハンドラ:", error);
    return NextResponse.json({ error: error.message || 'サーバー内部エラーが発生しました。' }, { status: 500 });
  }
}

// デバッグ用: Embedding生成のテスト
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const testQuery = searchParams.get('query') || 'テスト';
    
    if (!openaiApiKey) { // OpenAI APIキーをチェック
      return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });
    }
    
    const testEmbeddings = new OpenAIEmbeddings(); // APIキーは環境変数から自動読み込み
    // const testEmbeddings = new GoogleGenerativeAIEmbeddings({
    //   apiKey: geminiApiKey,
    //   model: "text-embedding-004",
    //   taskType: "SEMANTIC_SIMILARITY", 
    // });
    
    const embedding = await testEmbeddings.embedQuery(testQuery);
    
    const stats = {
      query: testQuery,
      dimensions: embedding.length,
      first10: embedding.slice(0, 10),
      last10: embedding.slice(-10),
      mean: embedding.reduce((a, b) => a + b, 0) / embedding.length,
      min: Math.min(...embedding),
      max: Math.max(...embedding),
      variance: embedding.reduce((sum, val) => sum + Math.pow(val - (embedding.reduce((a, b) => a + b, 0) / embedding.length), 2), 0) / embedding.length
    };
    
    return NextResponse.json({ success: true, stats });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
} 