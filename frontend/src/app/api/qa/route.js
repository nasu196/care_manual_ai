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
        model: "gemini-2.5-flash",
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
    console.log("[API /api/qa] Phase 0 chain initialized with gemini-2.0-flash (client-side history).");
  }

  if (!chatModelForAnalysis) {
    chatModelForAnalysis = new ChatGoogleGenerativeAI({
        apiKey: geminiApiKey,
        model: "gemini-2.5-flash",
        temperature: 0.4,
    });
    console.log("[API /api/qa] Gemini model for analysis initialized with gemini-2.5-flash.");
  }

  // --- 第1段階LLM用: 質問分析とクエリ生成 ---
  if (!queryAnalysisChain) {
    const queryAnalysisPromptTemplateString = `
あなたは質問分析と検索戦略を立案するAIアシスタントです。

**入力情報:**
- ユーザーの質問: 「{user_query}」
- 参照ファイル情報: {selected_source_filenames_message}
- 会話履歴: {chat_history_summary}
- 回答詳細度: {verbosity_instruction}

**タスク:**
1. **質問分析**: 質問の核心と背景ニーズを特定
2. **検索戦略**: 効果的な検索クエリ（3-7個）を生成（ファイル名そのものは含めない）
3. **回答指示**: 回答生成時の方針と注意点を策定

**重要事項:**
- 指定ファイルがある場合はそれを最優先
- マニュアル情報を最優先とし、推測は避ける

以下のJSON形式で出力してください：

\`\`\`json
{{
  "ユーザー質問の分析と再定義": {{
    "質問の核心": "質問の本質的な問いを1-2文で記述",
    "想定される背景・ニーズ": "背景や解決したい課題を具体的に記述"
  }},
  "情報収集戦略": {{
    "推奨検索クエリ群": [
      "効果的な検索クエリを3-7個提案"
    ],
    "情報収集時の着眼点": [
      "注目すべきキーワードや情報カテゴリを3-5点記述"
    ]
  }},
  "回答生成AIへの指示": {{
    "回答の基本方針": "疑問解消と次の行動を促す実用的な情報提供。指定ファイル最優先。",
    "期待される回答の詳細度": "{verbosity_instruction}",
    "強調すべき主要ポイント": [
      "特に価値の高い情報や注意点を2-4点記述"
    ],
    "補足すべき有益情報": [
      "関連する有用情報を2-4点提案"
    ],
         "回答時の注意点": [
       "平易な言葉で説明する。",
       "情報の正確性を最優先する。"
     ]
  }}
}}
\`\`\`

分析結果:
`;
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
      model: "gemini-2.5-flash",
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
    console.log("[API /api/qa] Gemini model for answer generation initialized with gemini-2.5-flash.");
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

    let authenticatedSupabase;

    if (shareId) {
      // 共有ページの場合は認証不要でサービスロールキーを使用
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
        return NextResponse.json({ error: '共有設定が見つかりません。' }, { status: 404 });
      }

      // 共有設定のレコードIDからファイル名を取得
      const selectedRecordIds = shareConfig.selected_record_ids;
      if (!selectedRecordIds || selectedRecordIds.length === 0) {
        return NextResponse.json({ error: '共有設定にファイルが選択されていません。' }, { status: 400 });
      }

      // レコードIDからファイル名を取得
      const { data: manuals, error: manualsError } = await authenticatedSupabase
        .from('manuals')
        .select('original_file_name')
        .eq('user_id', shareConfig.user_id)
        .in('id', selectedRecordIds);

      if (manualsError || !manuals || manuals.length === 0) {
        return NextResponse.json({ error: '共有設定のファイルが見つかりません。' }, { status: 404 });
      }

      // ファイル名を抽出
      sourceFilenames = manuals.map(manual => manual.original_file_name);
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
    const matchThreshold = 0.8;   // 0.6 → 0.8 に変更（関連性重視）
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
    
    // 参照元ファイルが選択されていない場合のガイダンス指示を追加
    const noSourceFilesSelected = !validSourceFilenames || validSourceFilenames.length === 0;
    const noSourceGuidancePrompt = noSourceFilesSelected && !shareId ? `
**【重要：参照元ファイル未選択時のガイダンス】**
現在、ユーザーは参照元ファイルを一つも選択していません。この場合は、質問への回答よりも、参照元ファイルの選択を促すガイダンスを優先して表示してください。

以下の形式でガイダンスメッセージを表示してください：

「申し訳ございませんが、より正確な回答をお提供するために、まず参照元ファイルを選択していただく必要があります。

**参照元ファイルの選択方法：**
1. 画面左側の「参照元の管理」セクションをご確認ください
2. 質問に関連するファイルにチェックを入れてください
3. 複数のファイルを選択することも可能です

参照元ファイルを選択することで、アップロードされた資料に基づいた正確で詳細な回答をお提供できます。

もしファイルをまだアップロードしていない場合は、「+」ボタンからPDF、Word、Excel、PowerPoint、テキストファイルをアップロードしてください。」

このガイダンスメッセージを表示した後は、一般的な知識による回答は行わないでください。
` : '';
    
    const answerGenerationSystemPrompt = `
あなたは提供されたマニュアル情報を基に、ユーザーの質問に正確に回答するAIアシスタントです。

**【重要】マニュアル情報の評価指針**
会話履歴で過去に「情報不足」と判定された場合でも、現在提供されている背景情報を新鮮な視点で評価してください。参照元ファイルが変更されている可能性があるため、過去の判定に固執せず、現在の背景情報の充足度を正確に評価してください。

**【回答の詳細度指示】**
${verbosityInstruction}

分析指示:
${analysisSummaryForPrompt}

会話履歴:
${formattedChatHistory}

${noSourceGuidancePrompt}

**【STEP 1: 内部評価プロセス - 内部処理のみ、出力しない】**

**マニュアル情報充足度**: ○○% (分析指示で特定されたユーザーニーズに対して、背景情報のマニュアルチャンクがどの程度直接的な回答を提供できるかの割合。関連情報や周辺情報は含めない。過去の判定は無視し、現在の情報のみで評価。)

**判定根拠**: 
- **ユーザーニーズ**: [分析指示から抽出されたユーザーの意図・求める情報レベル]
- **マニュアル対応状況**: [背景情報でそのニーズにどの程度対応できるかを具体的に説明]

**【選択した回答方針】**
- 充足度80%以上 → マニュアル中心回答（一般知識最小限）
- 充足度50-79% → マニュアル中心 + 一般知識20%以下の補完
- 充足度49%未満 → 情報不足として伝える（マニュアルに十分な記載がないことを明示した上で、一般的な知識で補足できる範囲で情報を提供） 

**【STEP 2: 回答生成】**

上記の詳細度指示に従って、自然で読みやすい回答を生成してください。一般知識で補完した場合は、最後に以下の形式で簡潔に明記：

---
**※一般的な知識による補完情報**
・[どの部分を補完したかの要点のみ。詳細説明は記載しない]

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