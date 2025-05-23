// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import "npm:pdf-parse";

console.log("Hello from Functions!")

import { serve, ConnInfo } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
// import { PDFLoader } from "npm:@langchain/community/document_loaders/fs/pdf"; // ★ コメントアウトまたは削除
import { RecursiveCharacterTextSplitter } from "npm:langchain/text_splitter";
import { GoogleGenerativeAIEmbeddings } from "npm:@langchain/google-genai";
import officeParser from "npm:officeparser";
import pdfParse from "npm:pdf-parse"; // ★ pdf-parse を直接インポート
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Buffer } from "node:buffer";
import "npm:dotenv/config";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "npm:@google/generative-ai"; // ★ 追加

// Supabaseクライアントの初期化 (環境変数から)
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("エラー: SUPABASE_URL または SUPABASE_ANON_KEY が環境変数に設定されていません。");
}
if (!geminiApiKey) {
  console.error("エラー: GEMINI_API_KEY が環境変数に設定されていません。");
}

let supabase: SupabaseClient;
if (supabaseUrl && supabaseAnonKey) {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
}

let embeddings: GoogleGenerativeAIEmbeddings;
if (geminiApiKey) {
    embeddings = new GoogleGenerativeAIEmbeddings({
        apiKey: geminiApiKey,
        model: "text-embedding-004",
    });
}

let genAI: GoogleGenerativeAI; // ★ 追加
if (geminiApiKey) { // ★ 追加
    genAI = new GoogleGenerativeAI(geminiApiKey); // ★ 追加
} // ★ 追加

const BUCKET_NAME = 'manuals';
const TMP_DIR_BASE = "/tmp";

// チャンクの型定義（仮）
interface ChunkObject {
    manual_id: string; // or number, depending on your DB schema
    chunk_text: string;
    chunk_order: number;
    embedding?: number[]; // embeddingはベクトル化後に設定される
}

async function downloadAndProcessFile(fileName: string, supabaseClient: SupabaseClient) {
  if (!supabaseClient) throw new Error("Supabase client not initialized");
  
  const randomSuffix = Math.random().toString(36).substring(2, 15);
  const uniqueFileName = `${Date.now()}_${randomSuffix}_${path.basename(fileName)}`;
  const fileExtension = path.extname(fileName).toLowerCase();

  console.log(`[${new Date().toISOString()}] [downloadAndProcessFile] Starting for ${fileName}, ext: ${fileExtension}`); // ★ 追加

  console.log(`Supabase Storageからファイル ${fileName} をダウンロード開始...`);
  
  const appTmpDir = path.join(TMP_DIR_BASE, 'process-manual-tmp');
  const actualTmpFilePath = path.join(appTmpDir, uniqueFileName);

  try {
    const { data: blob, error: downloadError } = await supabaseClient.storage
      .from(BUCKET_NAME)
      .download(fileName);

    if (downloadError) {
      console.error(`エラー: ファイルのダウンロードに失敗しました。 ${BUCKET_NAME}/${fileName}`, downloadError);
      throw downloadError;
    }
    console.log("ファイルのダウンロード成功。");

    try {
      await fs.mkdir(appTmpDir, { recursive: true });
    } catch (mkdirError: any) {
      if (mkdirError.code !== 'ENOENT' && mkdirError.code !== 'EEXIST') {
         console.warn(`一時サブディレクトリの作成に失敗: ${appTmpDir}`, mkdirError);
      } else if (mkdirError.code === 'EEXIST') {
         console.log(`一時サブディレクトリは既に存在します: ${appTmpDir}`);
      }
    }

    const fileBuffer = Buffer.from(await blob.arrayBuffer());
    await fs.writeFile(actualTmpFilePath, fileBuffer);
    console.log(`一時ファイルとして保存: ${actualTmpFilePath}`);

    let docs: Array<{ pageContent: string; metadata: Record<string, any> }> = [];

    console.log(`[${new Date().toISOString()}] [downloadAndProcessFile] Before parsing (${fileExtension}): ${actualTmpFilePath}`); // ★ 追加
    if (fileExtension === '.pdf') {
      console.log("\npdf-parseでドキュメントを読み込み開始...");
      try {
        const pdfData = await pdfParse(fileBuffer); // ★ PDFLoaderの代わりにpdfParseを使用
        
        // pdfDataのnull/undefinedチェック ★
        if (!pdfData) {
          throw new Error("pdf-parse returned null/undefined data");
        }
        
        // textプロパティの存在確認 ★
        const textContent = pdfData.text || '';
        const numPages = pdfData.numpages || 0;
        
        console.log(`PDF解析結果: テキスト長=${textContent.length}文字, ページ数=${numPages}`);
        
        if (textContent.length === 0) {
          console.warn("PDFからテキストが抽出されませんでした。画像のみのPDFか、テキスト抽出に失敗した可能性があります。");
        }
        
        docs = [{
          pageContent: textContent,
          metadata: { 
              source: fileName, 
              type: 'pdf',
              totalPages: numPages,
          }
        }];
        console.log(`ドキュメントの読み込み完了。合計 ${numPages} ページ (テキストは結合)。`);
      } catch (pdfError) {
        console.error(`PDF処理中にエラーが発生しました:`, pdfError);
        throw new Error(`PDF processing failed: ${pdfError instanceof Error ? pdfError.message : 'Unknown error'}`);
      }
    } else if (['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'].includes(fileExtension)) {
      console.log(`\nofficeparserで ${fileExtension} ファイルのテキスト抽出を開始...`);
      const data = await new Promise<string>((resolve, reject) => {
        try {
          officeParser.parseOffice(actualTmpFilePath, (content: string, err: Error | null) => {
            try {
              if (err) {
                console.error(`officeParser.parseOffice エラー: ${fileExtension}`, err);
                // errがnullの場合も考慮
                const errorToReject = err || new Error(`Unknown error occurred in officeParser for ${fileExtension}`);
                return reject(errorToReject);
              }
              
              // contentのnull/undefinedチェックを追加 ★
              if (content === null || content === undefined) {
                console.warn(`officeParser returned null/undefined content for ${fileExtension}, using empty string`);
                return resolve(''); // 空文字列として処理
              }
              
              // contentが文字列でない場合も考慘 ★
              if (typeof content !== 'string') {
                console.warn(`officeParser returned non-string content for ${fileExtension}:`, typeof content);
                return resolve(String(content || '')); // 文字列に変換
              }
              
              console.log(`officeParser content length: ${content.length} characters`);
              resolve(content);
            } catch (callbackError) {
              console.error(`Error in officeParser callback for ${fileExtension}:`, callbackError);
              reject(callbackError || new Error(`Callback error in officeParser for ${fileExtension}`));
            }
          });
        } catch (parseError) {
          console.error(`Error calling officeParser.parseOffice for ${fileExtension}:`, parseError);
          reject(parseError || new Error(`Failed to call officeParser for ${fileExtension}`));
        }
      });
      
      // 最終的なdataの検証 ★
      const validData = data || '';
      console.log(`${fileExtension} ファイルのテキスト抽出完了。文字数: ${validData.length}`);
      
      docs = [{
        pageContent: validData,
        metadata: {
          source: fileName,
          type: fileExtension.substring(1),
        }
      }];
    } else {
      console.warn(`未対応のファイル形式です: ${fileExtension}`);
      return null;
    }
    console.log(`[${new Date().toISOString()}] [downloadAndProcessFile] After parsing. Doc count: ${docs.length}`); // ★ 追加
    
    // docs の最終検証 ★
    if (!docs || !Array.isArray(docs) || docs.length === 0) {
      console.error(`ドキュメント処理結果が無効です: docs=${docs}`);
      throw new Error("Document processing returned invalid or empty result");
    }
    
    // 各docsのpageContentが有効であることを確認 ★
    for (let i = 0; i < docs.length; i++) {
      if (!docs[i] || typeof docs[i].pageContent !== 'string') {
        console.warn(`Document ${i} has invalid pageContent, replacing with empty string`);
        docs[i] = {
          pageContent: '',
          metadata: docs[i]?.metadata || { source: fileName, type: 'unknown' }
        };
      }
    }
    
    console.log(`ファイル処理完了: ${docs.length}個のドキュメントを生成しました`);
    return { docs, tmpFilePath: actualTmpFilePath };
  } catch (error) {
    console.error("\nファイル処理中にエラーが発生しました:", error);
    throw error;
  }
}

// ★ サマリー生成関数を追加
async function generateSummary(text: string, generativeAiClient: GoogleGenerativeAI): Promise<string | null> {
  if (!generativeAiClient) {
    console.warn("Gemini API client not initialized. Skipping summary generation.");
    return null;
  }
  if (!text || text.trim() === "") {
    console.log("Input text for summary is empty. Skipping summary generation.");
    return null;
  }

  // Gemini APIの呼び出しにおける安全設定
  // TODO: 必要に応じて、これらの設定を調整してください。
  // 現在はすべてのカテゴリで有害なコンテンツをブロックするように設定されています。
  const safetySettings = [
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
  ];

  // 使用するモデルを指定します。'gemini-pro' はテキスト生成に適しています。
  // 'gemini-1.5-flash-latest' も高速で安価な選択肢です。
  const model = generativeAiClient.getGenerativeModel({ 
    model: "gemini-2.0-flash",
    safetySettings,
  });

  // プロンプトテンプレートを定義します。
  // TODO: より高度なプロンプトエンジニアリングを検討してください。
  const prompt = `以下のドキュメント内容を、後続のAIシステムがこの内容をインプット情報として、**「どのような派生資料（例：研修資料、練習問題、FAQ、チェックリスト、別観点からのまとめ資料など）を新たに作成すると有効か、そのアイデアを提案する」**というタスクを効果的に実行できるよう、最適な形で要約・抽出してください。\n\nこの要約の目的は、後続AIが多様な視点から創造的な資料作成のアイデアを発想するための、質の高い「種」や「ヒント」を、過不足なく提供することです。\n\n以下の指針に従ってください：\n\n1.  **アイデア発想のトリガーとなる核心情報の抽出**: 元ドキュメントから、上記のような派生資料のアイデアを生み出す上で「着想元」や「重要な論点」となり得る主要なトピック、キーコンセプト、特徴的な要素、重要な目的や背景、主要な対象者などをバランス良く抽出してください。\n2.  **適切な情報粒度と示唆に富む内容**: アイデア提案のAIが多様な可能性を検討できるよう、ある程度の情報粒度を保ちつつ、示唆に富む（＝様々な解釈や展開を促す）情報を重視してください。細かすぎる網羅的な情報は不要ですが、アイデアの幅を狭めるような重要情報の欠落は避けてください。\n3.  **明確かつ簡潔な表現**: 抽出した情報は、AIがその意味や重要性を容易に解釈できるよう明確かつ簡潔な表現で記述してください。冗長な言い回しは避けつつも、アイデア発想の妨げになるような過度な省略はしないでください。\n4.  **構造化の推奨（アイデアの整理と関連付けのために）**: 情報を整理し、AIが異なる情報間の関連性を見出しやすく、またアイデアを体系的に整理・提案しやすくするために、必要に応じてキーポイントごとの記述や、適度な項目立てをすることは有効です。ただし、厳密な形式にこだわる必要はありません。\n5.  **出力の長さと密度**: アイデア提案AIが発想を広げるのに十分な「素材」としての情報量を確保しつつ、トークン効率も意識してください。ドキュメントの複雑性や情報量に応じて、数百字から1000字程度の範囲で、情報が適切に凝縮された出力を期待します。\n\n---\n${text}\n---\nAI向け派生資料アイデア提案用サマリー:`;

  try {
    console.log("Gemini API を呼び出してサマリー生成を開始...");
    // テキスト生成リクエストを送信します。
    const result = await model.generateContent(prompt);
    
    // result の null チェック ★
    if (!result) {
      throw new Error("Gemini API returned null result");
    }
    
    const response = result.response;
    
    // response の null チェック ★
    if (!response) {
      throw new Error("Gemini API response is null or undefined");
    }
    
    // response.text() の呼び出しをtry-catchで囲む ★
    let summary: string;
    try {
      summary = response.text();
    } catch (textError) {
      console.error("Error extracting text from Gemini response:", textError);
      throw new Error(`Failed to extract text from Gemini response: ${textError instanceof Error ? textError.message : 'Unknown error'}`);
    }
    
    // summary の null/undefined チェック ★
    if (summary === null || summary === undefined) {
      console.warn("Gemini API returned null/undefined summary text");
      return null;
    }
    
    // 空文字列チェック
    if (typeof summary !== 'string') {
      console.warn(`Gemini API returned non-string summary: ${typeof summary}`);
      summary = String(summary || '');
    }
    
    console.log(`サマリー生成成功: ${summary.length}文字`);
    return summary.length > 0 ? summary : null;
  } catch (error: any) {
    console.error("Gemini API を使用したサマリー生成中にエラーが発生しました:", error);
    // エラーレスポンスに詳細が含まれている場合があるため、ログに出力
    if (error && error.response && error.response.promptFeedback) {
        console.error("Prompt Feedback:", error.response.promptFeedback);
    }
    return null; // エラー時はnullを返す
  }
}

async function processAndStoreDocuments(
    processedFile: { docs: Array<{ pageContent: string; metadata: Record<string, any> }>, tmpFilePath: string } | null, 
    sourceFileName: string, 
    originalFileName: string | null,
    supabaseClient: SupabaseClient,
    embeddingsClient: GoogleGenerativeAIEmbeddings,
    generativeAiClient: GoogleGenerativeAI // ★ 引数追加
) {
  console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Start`); // ★ タイムスタンプ追加
  if (!supabaseClient) throw new Error("Supabase client not initialized");
  if (!embeddingsClient) throw new Error("Embeddings client not initialized");
  
  if (!processedFile || !processedFile.docs || processedFile.docs.length === 0) {
    console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] No parsed documents, skipping.`); // ★ タイムスタンプ追加
    return false;
  }
  const parsedDocs = processedFile.docs;
  console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Processing file: ${sourceFileName}, original: ${originalFileName || 'N/A'}, Parsed doc count: ${parsedDocs.length}`); // ★ タイムスタンプ追加
  
  try {
    let manualId: string;

    // --- 既存マニュアルのチェック処理を修正 ---
    let existingManualData: { id: string } | null = null;
    let selectQueryError: any = null;

    console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Attempting to check for existing manual (before await)...`); // ★ タイムスタンプ追加
    try {
        const result = await supabaseClient
            .from('manuals')
            .select('id')
            .eq('file_name', sourceFileName)
            .single();
        existingManualData = result.data;
        selectQueryError = result.error;
        console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Supabase select query for existing manual executed successfully.`);
    } catch (e) {
        console.error(`[${new Date().toISOString()}] [processAndStoreDocuments] CRITICAL: Exception during supabaseClient.select for existing manual:`, e);
        // e が null の場合、新しいErrorオブジェクトを作成してスローする
        const errorToThrow = e === null ? new Error("Supabase select query threw or rejected with null") : e;
        throw errorToThrow;
    }

    if (selectQueryError && selectQueryError.code !== 'PGRST116') { // PGRST116は「該当なし」のエラーコードなので無視
        console.error(`[${new Date().toISOString()}] [processAndStoreDocuments] Error from Supabase query (checking existing manual for ${sourceFileName}):`, selectQueryError);
        throw selectQueryError;
    }
    console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Existing manual check complete. Found: ${existingManualData ? existingManualData.id : 'null'}`); // ★ タイムスタンプ追加
    const existingManual = existingManualData; // 後続のロジックのために代入
    // --- 修正ここまで ---

    let summaryText: string | null = null;
    if (parsedDocs.length > 0 && parsedDocs[0] && parsedDocs[0].pageContent) {
        console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Generating summary...`); // ★ タイムスタンプ追加
        try {
            summaryText = await generateSummary(parsedDocs[0].pageContent, generativeAiClient);
            console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Summary generation result: ${summaryText ? 'Success' : 'Skipped/Null'}, Length: ${summaryText?.length || 0}`); // ★ タイムスタンプ追加
        } catch (summaryError) {
            console.error("[processAndStoreDocuments] Error during summary generation (continuing):", summaryError);
            summaryText = null; 
        }
    } else {
        console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] No content for summary, skipping.`); // ★ タイムスタンプ追加
    }

    if (existingManual && existingManual.id) {
      manualId = existingManual.id;
      console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Using existing manual ID: ${manualId}`); // ★ タイムスタンプ追加
      const updateData: any = {
        original_file_name: originalFileName || sourceFileName,
        metadata: { 
            totalPages: (parsedDocs[0] && parsedDocs[0].metadata) ? parsedDocs[0].metadata.totalPages || ((parsedDocs[0].metadata.type !== 'pdf') ? 1 : parsedDocs.length) : 1,
            sourceType: (parsedDocs[0] && parsedDocs[0].metadata) ? parsedDocs[0].metadata.type || path.extname(sourceFileName).substring(1) || 'unknown' : 'unknown',
            lastProcessed: new Date().toISOString() 
        },
      };
      if (summaryText !== null) {
        updateData.summary = summaryText;
      }
      console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Updating existing manual with data:`, updateData); // ★ タイムスタンプ追加
      const { error: updateError } = await supabaseClient
        .from('manuals')
        .update(updateData)
        .eq('id', manualId);
      if (updateError) {
        console.error(`[${new Date().toISOString()}] [processAndStoreDocuments] Error updating existing manual ID=${manualId}:`, updateError); // ★ タイムスタンプ追加
      } else {
        console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Successfully updated existing manual ID=${manualId}`); // ★ タイムスタンプ追加
      }
    } else {
      console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Creating new manual record...`); // ★ タイムスタンプ追加
      const totalPages = (parsedDocs[0] && parsedDocs[0].metadata) ? 
                         (parsedDocs[0].metadata.totalPages || ((parsedDocs[0].metadata.type !== 'pdf') ? 1 : parsedDocs.length)) : 1;
      const insertData: any = {
        file_name: sourceFileName,
        original_file_name: originalFileName || sourceFileName, 
        storage_path: `${BUCKET_NAME}/${sourceFileName}`,
        metadata: { 
          totalPages: totalPages,
          sourceType: (parsedDocs[0] && parsedDocs[0].metadata) ? parsedDocs[0].metadata.type || path.extname(sourceFileName).substring(1) || 'unknown' : 'unknown'
        },
      };
      if (summaryText !== null) {
        insertData.summary = summaryText;
      }
      console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Inserting new manual with data:`, insertData); // ★ タイムスタンプ追加
      const { data: newManual, error: insertError } = await supabaseClient
        .from('manuals')
        .insert(insertData)
        .select('id')
        .single();
      if (insertError || !newManual || !newManual.id) { 
        console.error(`[${new Date().toISOString()}] [processAndStoreDocuments] Error inserting new manual for ${sourceFileName}:`, insertError); // ★ タイムスタンプ追加
        throw insertError || new Error("Failed to insert new manual and retrieve ID.");
      }
      manualId = newManual.id;
      console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] New manual created with ID: ${manualId}`); // ★ タイムスタンプ追加
    }

    console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Manual ID set to: ${manualId}`); // ★ タイムスタンプ追加
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 2500,
      chunkOverlap: 400,
      separators: ["\n\n", "。\n", "！\n", "？\n", "\n", "。", "！", "？", "、", " ", "　", ""],
    });

    const chunks: ChunkObject[] = [];
    console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Splitting documents into chunks...`); // ★ タイムスタンプ追加
    for (let i = 0; i < parsedDocs.length; i++) {
      const doc = parsedDocs[i];
      const pageContent = doc.pageContent || "";
      console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Processing document ${i+1}/${parsedDocs.length}, content length: ${pageContent.length}`); // ★ タイムスタンプ追加
      if (!pageContent.trim()) {
          console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Document ${i+1} is empty, skipping.`); // ★ タイムスタンプ追加
          continue;
      }
      let splitText: string[] = []; // ★ 初期化
      try {
        console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Calling splitter.splitText for doc ${i+1}...`); // ★ タイムスタンプ追加
        splitText = await splitter.splitText(pageContent);
        console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Doc ${i+1} split into ${splitText.length} chunks.`); // ★ タイムスタンプ追加
      } catch (splitError) {
        console.error(`[${new Date().toISOString()}] [processAndStoreDocuments] Error splitting document ${i+1}:`, splitError); // ★ タイムスタンプ追加
        throw new Error(`Failed to split document: ${splitError instanceof Error ? splitError.message : 'Unknown error'}`);
      }
      
      splitText.forEach((text: string, index: number) => {
        chunks.push({
          manual_id: manualId,
          chunk_text: text,
          chunk_order: index + 1,
        });
      });
    }
    console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Total chunks created: ${chunks.length}`); // ★ タイムスタンプ追加
    if (chunks.length === 0) {
        console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] No chunks generated, finishing process.`); // ★ タイムスタンプ追加
        return true;
    }

    console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Embedding chunks...`); // ★ タイムスタンプ追加
    const chunkTextsForEmbedding = chunks.map(c => c.chunk_text);
    
    let chunkEmbeddings: number[][];
    try {
        if (!embeddingsClient) {
            throw new Error("Embeddings client is not initialized");
        }
        console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Calling embedDocuments for ${chunkTextsForEmbedding.length} texts...`); // ★ タイムスタンプ追加
        chunkEmbeddings = await embeddingsClient.embedDocuments(chunkTextsForEmbedding);
        if (!chunkEmbeddings || !Array.isArray(chunkEmbeddings)) { 
            console.error(`[${new Date().toISOString()}] [processAndStoreDocuments] Embeddings generation returned invalid result:`, chunkEmbeddings); // ★ タイムスタンプ追加
            throw new Error("Embeddings generation returned invalid result");
        }
        console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Embeddings generated for ${chunkEmbeddings.length} chunks.`); // ★ タイムスタンプ追加
    } catch (embeddingError) {
        console.error(`[${new Date().toISOString()}] [processAndStoreDocuments] Error during embedding generation:`, embeddingError); // ★ タイムスタンプ追加
        throw new Error(`Embedding generation failed: ${embeddingError instanceof Error ? embeddingError.message : 'Unknown error'}`);
    }

    const chunksToInsert: ChunkObject[] = chunks.map((chunk, i) => {
        if (!chunkEmbeddings[i] || !Array.isArray(chunkEmbeddings[i])) { 
            console.warn(`[${new Date().toISOString()}] [processAndStoreDocuments] Warning: Invalid embedding for chunk ${i}, using empty array. Embedding data:`, chunkEmbeddings[i]); // ★ タイムスタンプ追加
            return {
                ...chunk,
                embedding: [], 
            };
        }
        return {
            ...chunk,
            embedding: chunkEmbeddings[i],
        };
    });

    console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Deleting existing chunks...`); // ★ タイムスタンプ追加
    try {
        const { error: deleteChunksError } = await supabaseClient
            .from('manual_chunks')
            .delete()
            .eq('manual_id', manualId);
        if (deleteChunksError) {
            console.error(`[${new Date().toISOString()}] [processAndStoreDocuments] Error deleting existing chunks for manual_id=${manualId}:`, deleteChunksError); // ★ タイムスタンプ追加
        } else {
            console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Successfully deleted existing chunks for manual_id=${manualId}`); // ★ タイムスタンプ追加
        }
    } catch (deleteError) {
        console.error(`[${new Date().toISOString()}] [processAndStoreDocuments] Unexpected error deleting existing chunks for manual_id=${manualId}:`, deleteError); // ★ タイムスタンプ追加
    }
    
    console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Inserting new chunks...`); // ★ タイムスタンプ追加
    try {
        const { error: insertChunksError } = await supabaseClient
          .from('manual_chunks')
          .insert(chunksToInsert);
        if (insertChunksError) {
          console.error(`[${new Date().toISOString()}] [processAndStoreDocuments] Error inserting new chunks:`, insertChunksError); // ★ タイムスタンプ追加
          throw insertChunksError;
        }
        console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Successfully inserted ${chunksToInsert.length} new chunks.`); // ★ タイムスタンプ追加
    } catch (insertError) {
        console.error(`[${new Date().toISOString()}] [processAndStoreDocuments] Unexpected error inserting new chunks:`, insertError); // ★ タイムスタンプ追加
        throw new Error(`Chunk insertion failed: ${insertError instanceof Error ? insertError.message : 'Unknown error'}`);
    }
    
    console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Successfully completed.`); // ★ タイムスタンプ追加
    return true;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [processAndStoreDocuments] Error processing/storing documents for ${sourceFileName}:`, error); // ★ タイムスタンプ追加
    if (error instanceof Error) {
        console.error(`[${new Date().toISOString()}] [processAndStoreDocuments] Error details:`, error.stack || error.message); // ★ タイムスタンプ追加
    }
    return false;
  }
}

// Deno ネイティブ HTTP サーバーハンドラ
async function handler(req: Request, _connInfo?: ConnInfo): Promise<Response> { // _connInfo は現時点では未使用
  const requestPathname = new URL(req.url).pathname; // Pathnameを先に取得
  console.log(`Request received: Method=${req.method}, URL=${req.url}, Pathname=${requestPathname}`);

  // CORSヘッダーをすべてのレスポンスに追加
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*', // すべてのオリジンを許可 (開発用)
    'Access-Control-Allow-Methods': 'POST, OPTIONS', // 許可するメソッド
    'Access-Control-Allow-Headers': 'Content-Type, Authorization', // 許可するヘッダー
  };

  // OPTIONSリクエスト (プリフライトリクエスト) の処理
  if (req.method === 'OPTIONS') {
    console.log("Responding to OPTIONS request.");
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  
  if (req.method !== "POST") { // POSTメソッドのみ許可
    console.log(`Invalid request method: ${req.method}. Expected POST. Responding 405.`);
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  let tmpFilePathToDelete: string | null = null;
  let receivedFileName: string | null = null; // エラー時のロールバック用にファイル名を保持

  try {
    if (!supabase) {
        throw new Error("Supabase client is not initialized due to missing environment variables.");
    }
    if (!embeddings) {
        throw new Error("Embeddings client is not initialized due to missing GEMINI_API_KEY.");
    }
    if (!genAI) { 
        console.warn("GenerativeAI client is not initialized due to missing GEMINI_API_KEY. Summary generation will be skipped.");
    }

    console.log(`\nリクエストボディの解析を開始: ${new Date().toISOString()}`);
    const body = await req.json();
    const { fileName, originalFileName } = body;
    receivedFileName = fileName; // ★ fileName を receivedFileName に保存

    if (!receivedFileName || typeof receivedFileName !== 'string') {
      console.error("fileName (string) is required in the request body.");
      return new Response(JSON.stringify({ error: 'fileName (string) is required in the request body' }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log(`処理対象ファイル: ${receivedFileName} (元ファイル名: ${originalFileName || '未指定'})`);

    const processedFile = await downloadAndProcessFile(receivedFileName, supabase);
    
    if (processedFile && processedFile.tmpFilePath) { // ★ tmpFilePathToDelete を設定
        tmpFilePathToDelete = processedFile.tmpFilePath;
    }

    if (!processedFile) {
        console.error(`File processing failed or unsupported file type for: ${receivedFileName}`);
        return new Response(JSON.stringify({ error: "File processing failed or unsupported file type." }), {
            status: 500, 
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
    
    console.log(`\n--- ファイル処理パイプライン (ダウンロードと抽出) 成功: ${receivedFileName} ---`);
    const success = await processAndStoreDocuments(processedFile, receivedFileName, originalFileName, supabase, embeddings, genAI);

    if (success) {
      console.log(`\n--- 全体処理完了 (チャンク化とDB保存含む) 成功: ${receivedFileName} ---`);
      console.log(`[Handler] Preparing successful response for ${receivedFileName}. Body:`, { message: `Successfully processed ${receivedFileName}` }); // ★ 追加
      return new Response(JSON.stringify({ message: `Successfully processed ${receivedFileName}` }), { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    } else {
      console.error(`\n--- 全体処理失敗 (チャンク化またはDB保存でエラー): ${receivedFileName} ---`);
      throw new Error(`Failed to process ${receivedFileName} during storage/embedding steps. Triggering rollback if applicable.`);
    }
  } catch (error: any) { // ★ unknown から any へ変更
    console.error(`Error in function handler for file: ${receivedFileName || 'Unknown file'}:`, error);
    
    // エラーの詳細情報をログに出力 ★
    if (error instanceof Error) {
        console.error("Error name:", error.name);
        console.error("Error message:", error.message);
        console.error("Error stack:", error.stack);
    } else {
        console.error("Non-Error object thrown:", JSON.stringify(error, null, 2));
    }
    
    // ロールバック処理: Storageからファイルを削除 (エラー発生時)
    if (receivedFileName && supabase) {
      console.warn(`処理中にエラー(${error instanceof Error ? error.message : String(error)})が発生したため、Storageからファイル ${receivedFileName} の削除を試みます。`);
      try {
        const { error: deleteError } = await supabase.storage
          .from(BUCKET_NAME)
          .remove([receivedFileName]); 
        if (deleteError) {
          if (deleteError.message && deleteError.message.includes("Not Found") || (deleteError as any).statusCode === 404) {
            console.log(`Storageにファイル ${receivedFileName} が見つからなかったため、削除はスキップされました。`);
          } else {
            console.error(`Storageからのファイル ${receivedFileName} の削除に失敗しました。`, deleteError);
          }
        } else {
          console.log(`Storageからファイル ${receivedFileName} を削除しました。`);
        }
      } catch (storageDeleteError) {
        console.error(`Storageからのファイル ${receivedFileName} の削除中に予期せぬエラー。`, storageDeleteError);
      }
    }

    const message = error instanceof Error ? error.message : "Internal server error during file processing.";
    const detail = error instanceof Error ? error.stack || error.toString() : String(error); // ★ より詳細な情報を追加
    
    console.log(`[Handler] Preparing error response for ${receivedFileName || 'Unknown file'}. Error: ${message}, Detail: ${detail}`); // ★ 追加
    return new Response(JSON.stringify({ 
        error: message, 
        detail: detail,
        timestamp: new Date().toISOString(), // ★ タイムスタンプ追加
        file: receivedFileName || 'Unknown' // ★ ファイル名追加
    }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  } finally {
    if (tmpFilePathToDelete) {
        try {
            console.log(`\nFinallyブロック: 一時ファイル ${tmpFilePathToDelete} のクリーンアップを試みます...`);
            await fs.unlink(tmpFilePathToDelete);
            console.log(`一時ファイルをクリーンアップしました: ${tmpFilePathToDelete}`);
        } catch (e: any) { // ★ unknown から any へ変更
            if (e && e.code !== 'ENOENT') { // ★ eがnullでないことを確認
                 console.warn(`Finallyブロック: 一時ファイルの削除中にエラーが発生しました (無視): ${tmpFilePathToDelete}`, e);
            } else {
                 console.log(`Finallyブロック: 一時ファイルは既に存在しませんでした (無視): ${tmpFilePathToDelete}`);
            }
        }
    }
    console.log(`[Handler] Finally block completed for ${receivedFileName || 'request associated with this handler invocation'}`); // ★ 変更: より詳細なメッセージ
  }
}

// serve(handler); // ポート指定を削除。Deno Deployでは自動的に割り当てられる。ローカルテスト時はデフォルト(8000)

console.log("[Global] Setting up server with handler (Version: AddResponseLogging)..."); // ★ 追加
serve(handler);
console.log("[Global] Server setup complete. Waiting for requests (Version: AddResponseLogging)."); // ★ 追加

console.log("Process manual function (Deno native HTTP) server running!");

/* To invoke locally:

  1. Make sure your .env file has SUPABASE_URL, SUPABASE_ANON_KEY, and GEMINI_API_KEY.
  2. Run this Deno script:
     deno run --allow-net --allow-env --allow-read=/tmp,./.env --allow-write=/tmp supabase/functions/process-manual-function/index.ts
     (For Deno Deploy, these permissions are typically handled by the platform)
  3. Make an HTTP request:

  curl -i --location --request POST 'http://localhost:8000/process-manual-function' \\\
    --header 'Content-Type: application/json\' \\\
    --data \'{"fileName":"your-file-in-storage.pdf"}\'

  Or using PowerShell:
  Invoke-WebRequest -Uri 'http://localhost:8000/process-manual-function' -Method POST -ContentType 'application/json\' -Body \'{"fileName":"your-file-in-storage.pdf"}\'
*/
