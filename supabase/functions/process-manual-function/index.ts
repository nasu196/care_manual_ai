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
import { corsHeaders } from '../_shared/cors.ts'; // ★ CORSヘッダーをインポート

// ★ テキストサニタイズ関数を追加
function sanitizeText(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  return text
    // NULL文字を除去
    .replace(/\u0000/g, '')
    // その他の制御文字を除去（改行・タブ・スペースは保持）
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    // 連続する空白を単一スペースに変換
    .replace(/\s+/g, ' ')
    // 前後の空白を除去
    .trim();
}

// ★ OCR判定関数：テキスト抽出が不十分かどうかを判定
function isTextExtractionInsufficient(text: string, numPages: number): boolean {
  const cleanText = sanitizeText(text);
  const textLength = cleanText.length;
  
  // 判定基準
  const minTextPerPage = 50; // 1ページあたり最低50文字
  const minTotalText = 100;  // 総文字数最低100文字
  
  console.log(`[OCR判定] テキスト長: ${textLength}, ページ数: ${numPages}, ページあたり: ${Math.round(textLength / Math.max(numPages, 1))}`);
  
  if (textLength < minTotalText) {
    console.log(`[OCR判定] 総文字数不足 (${textLength} < ${minTotalText})`);
    return true;
  }
  
  if (numPages > 0 && (textLength / numPages) < minTextPerPage) {
    console.log(`[OCR判定] 1ページあたりの文字数不足 (${Math.round(textLength / numPages)} < ${minTextPerPage})`);
    return true;
  }
  
  console.log(`[OCR判定] テキスト抽出は十分です`);
  return false;
}

// ★ PDF画像変換関数（安全なBase64変換版）
async function convertPdfPageToImage(pdfBuffer: ArrayBuffer, pageNumber: number = 1): Promise<string | null> {
  try {
    console.log(`[PDF変換] PDF を Base64 に変換開始 (サイズ: ${pdfBuffer.byteLength} bytes)`);
    
    // 安全なBase64変換（チャンク単位）
    const uint8Array = new Uint8Array(pdfBuffer);
    const chunkSize = 8192; // 8KBずつ処理
    let binaryString = '';
    
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.slice(i, i + chunkSize);
      binaryString += String.fromCharCode.apply(null, Array.from(chunk));
    }
    
    const base64Pdf = btoa(binaryString);
    console.log(`[PDF変換] PDF を Base64 に変換完了 (${base64Pdf.length} 文字)`);
    return base64Pdf;
  } catch (error) {
    console.error(`[PDF変換] エラー:`, error);
    return null;
  }
}

// ★ Google Vision API OCR実行関数
async function performOCROnPdf(pdfBuffer: ArrayBuffer): Promise<string | null> {
  if (!googleVisionApiKey) {
    console.warn(`[OCR] Google Vision API キーが設定されていないため、OCRをスキップします`);
    return null;
  }
  
  try {
    console.log(`[OCR] Google Vision API を使用してOCR処理を開始...`);
    
    // ファイルサイズチェック（Vision APIの制限: 20MB）
    if (pdfBuffer.byteLength > 20 * 1024 * 1024) {
      console.warn(`[OCR] PDFファイルが大きすぎます (${Math.round(pdfBuffer.byteLength / 1024 / 1024)}MB > 20MB制限)`);
      return null;
    }
    
    // PDF→Base64変換
    const base64Image = await convertPdfPageToImage(pdfBuffer);
    if (!base64Image) {
      throw new Error("PDF の画像変換に失敗しました");
    }
    
    // Google Vision API リクエスト
    const visionApiUrl = `https://vision.googleapis.com/v1/images:annotate?key=${googleVisionApiKey}`;
    
    const requestBody = {
      requests: [{
        image: {
          content: base64Image
        },
        features: [{
          type: 'TEXT_DETECTION',
          maxResults: 1
        }]
      }]
    };
    
    console.log(`[OCR] Vision API にリクエスト送信中... (データサイズ: ${Math.round(base64Image.length / 1024)}KB)`);
    const response = await fetch(visionApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[OCR] Vision API エラー (${response.status}):`, errorText);
      
      // APIエラーの詳細分析
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error && errorJson.error.message) {
          console.error(`[OCR] API エラー詳細: ${errorJson.error.message}`);
        }
      } catch (parseError) {
        console.error(`[OCR] エラーレスポンスの解析に失敗:`, parseError);
      }
      
      throw new Error(`Vision API request failed: ${response.status} - ${errorText.substring(0, 200)}`);
    }
    
    const result = await response.json();
    console.log(`[OCR] Vision API レスポンス受信`, { 
      hasResponses: !!result.responses, 
      responseCount: result.responses?.length || 0 
    });
    
    // OCR結果からテキストを抽出
    if (result.responses && result.responses[0]) {
      const firstResponse = result.responses[0];
      
      // エラーチェック
      if (firstResponse.error) {
        console.error(`[OCR] Vision API応答エラー:`, firstResponse.error);
        return null;
      }
      
      if (firstResponse.textAnnotations && firstResponse.textAnnotations.length > 0) {
        const extractedText = firstResponse.textAnnotations[0].description || '';
        console.log(`[OCR] テキスト抽出成功: ${extractedText.length} 文字`);
        console.log(`[OCR] 抽出テキスト（最初の100文字）: ${extractedText.substring(0, 100)}...`);
        return sanitizeText(extractedText);
      }
    }
    
    console.log(`[OCR] テキストが検出されませんでした`);
    return null;
    
  } catch (error) {
    console.error(`[OCR] Google Vision API エラー:`, error);
    
    // エラーの詳細情報を出力
    if (error instanceof Error) {
      console.error(`[OCR] エラー名: ${error.name}`);
      console.error(`[OCR] エラーメッセージ: ${error.message}`);
    }
    
    return null;
  }
}

// Supabaseクライアントの初期化 (環境変数から)
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
const googleVisionApiKey = Deno.env.get("GOOGLE_VISION_API_KEY"); // ★ Google Vision API キーを追加

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("エラー: SUPABASE_URL または SUPABASE_ANON_KEY が環境変数に設定されていません。");
}
if (!geminiApiKey) {
  console.error("エラー: GEMINI_API_KEY が環境変数に設定されていません。");
}
if (!googleVisionApiKey) {
  console.warn("警告: GOOGLE_VISION_API_KEY が環境変数に設定されていません。OCR機能は無効になります。");
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
        let textContent = pdfData.text || '';
        const numPages = pdfData.numpages || 0;
        
        console.log(`PDF解析結果: テキスト長=${textContent.length}文字, ページ数=${numPages}`);
        
        // ★ OCR判定とOCR処理の統合
        if (isTextExtractionInsufficient(textContent, numPages)) {
          console.log(`[OCR] PDFテキスト抽出が不十分です。OCR処理を実行します...`);
          
          const ocrText = await performOCROnPdf(fileBuffer.buffer);
          if (ocrText && ocrText.length > 0) {
            console.log(`[OCR] OCR完了: ${ocrText.length}文字追加`);
            // 既存テキストとOCRテキストを統合
            textContent = textContent.length > 0 ? 
              `${textContent}\n\n[OCR抽出テキスト]\n${ocrText}` : 
              ocrText;
            console.log(`[OCR] 統合後テキスト長: ${textContent.length}文字`);
          } else {
            console.warn(`[OCR] OCR処理に失敗したか、テキストが検出されませんでした`);
          }
        }
        
        if (textContent.length === 0) {
          console.warn("PDFからテキストが抽出されませんでした。画像のみのPDFか、テキスト抽出に失敗した可能性があります。");
        }
        
        docs = [{
          pageContent: textContent,
          metadata: { 
              source: fileName, 
              type: 'pdf',
              totalPages: numPages,
              hasOCR: textContent.includes('[OCR抽出テキスト]'), // ★ OCR使用フラグ
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
    userId: string,
    supabaseClient: SupabaseClient,
    embeddingsClient: GoogleGenerativeAIEmbeddings,
    generativeAiClient: GoogleGenerativeAI
): Promise<{ manualId: string; summary: string | null; chunksCount: number } | null> {
  console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Start`); // ★ タイムスタンプ追加
  if (!supabaseClient) throw new Error("Supabase client not initialized");
  if (!embeddingsClient) throw new Error("Embeddings client not initialized");
  
  if (!processedFile || !processedFile.docs || processedFile.docs.length === 0) {
    console.warn(`[ProcessStore] ドキュメントが空または処理されていません: ${sourceFileName}`);
    return null; // ★ 失敗時はnullを返す
  }
  const parsedDocs = processedFile.docs;
  console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Processing file: ${sourceFileName}, original: ${originalFileName || 'N/A'}, Parsed doc count: ${parsedDocs.length}`); // ★ タイムスタンプ追加
  
  try {
    let manualId: string;

    // --- 既存マニュアルのチェック処理を修正 ---
    let existingManualData: { id: string } | null = null;
    let selectQueryError: any = null;

    console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Value of sourceFileName before DB query: '${sourceFileName}' (length: ${sourceFileName.length})`); // ★ 追加: sourceFileNameの値をログ出力

    console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Step 1: Initializing queryBuilder = supabaseClient.from('manuals')...`);
    const queryBuilder = supabaseClient.from('manuals');
    if (!queryBuilder) {
        console.error(`[${new Date().toISOString()}] [processAndStoreDocuments] CRITICAL: supabaseClient.from('manuals') returned null/undefined.`);
        throw new Error("Failed to initialize query builder: supabaseClient.from('manuals') is null/undefined");
    }
    console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Step 2: Initializing selectBuilder = queryBuilder.select('id')...`);
    const selectBuilder = queryBuilder.select('id');
    if (!selectBuilder) {
        console.error(`[${new Date().toISOString()}] [processAndStoreDocuments] CRITICAL: queryBuilder.select('id') returned null/undefined.`);
        throw new Error("Failed to initialize select builder: queryBuilder.select('id') is null/undefined");
    }
    console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Step 3: Initializing filterBuilder = selectBuilder.eq('file_name', sourceFileName).eq('user_id', userId)...`);
    const filterBuilder = selectBuilder.eq('file_name', sourceFileName).eq('user_id', userId);
    if (!filterBuilder) {
        console.error(`[${new Date().toISOString()}] [processAndStoreDocuments] CRITICAL: selectBuilder.eq('file_name', ...) returned null/undefined.`);
        throw new Error("Failed to initialize filter builder: selectBuilder.eq() is null/undefined");
    }

    console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Step 4: Awaiting filterBuilder.single()...`);
    try {
        const result = await filterBuilder.single(); // ★ 分割したクエリを実行
        existingManualData = result.data;
        selectQueryError = result.error;
        console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Supabase select query for existing manual executed successfully.`);
    } catch (e) {
        console.error(`[${new Date().toISOString()}] [processAndStoreDocuments] CRITICAL: Exception during filterBuilder.single():`, e);
        const errorToThrow = e === null ? new Error("filterBuilder.single() threw or rejected with null") : e;
        throw errorToThrow;
    }
    // --- 修正ここまで。以前の try-catch は上記に統合 ---

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
        user_id: userId, // ユーザーIDを追加
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
        // ★ チャンクテキストをサニタイズ
        const sanitizedChunkText = sanitizeText(text);
        if (sanitizedChunkText.length > 0) { // 空のチャンクは除外
          chunks.push({
            manual_id: manualId,
            chunk_text: sanitizedChunkText,
            chunk_order: index + 1,
          });
        } else {
          console.warn(`[${new Date().toISOString()}] [processAndStoreDocuments] Empty chunk after sanitization, skipping chunk ${index} from doc ${i+1}`);
        }
      });
    }
    console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Total chunks created: ${chunks.length}`); // ★ タイムスタンプ追加
    if (chunks.length === 0) {
        console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] No chunks generated, finishing process.`); // ★ タイムスタンプ追加
        return null;
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
    return { manualId, summary: summaryText, chunksCount: chunksToInsert.length }; // ★ 成功時の返り値
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [processAndStoreDocuments] Error processing/storing documents for ${sourceFileName}:`, error); // ★ タイムスタンプ追加
    if (error instanceof Error) {
        console.error(`[${new Date().toISOString()}] [processAndStoreDocuments] Error details:`, error.stack || error.message); // ★ タイムスタンプ追加
    }
    return null; // ★ エラー時はnullを返す
  }
}

// Deno ネイティブ HTTP サーバーハンドラ
async function handler(req: Request, _connInfo?: ConnInfo): Promise<Response> { // _connInfo は現時点では未使用
  console.log('process-manual-function called');
  if (req.method === 'OPTIONS') {
    console.log('OPTIONS request received, sending CORS headers');
    return new Response('ok', { headers: corsHeaders });
  }
  console.log('Request Headers:', Object.fromEntries(req.headers.entries()));

  let userId: string | null = null;
  const authHeader = req.headers.get('Authorization');
  console.log('[Auth] Authorization Header (Clerk JWT expected):', authHeader);

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('[Auth] Missing or invalid Authorization header.');
    return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header. Clerk JWT Bearer token is required.' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const token = authHeader.replace('Bearer ', '');
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.error('[Auth] Invalid JWT format.');
      return new Response(JSON.stringify({ error: 'Invalid JWT format' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const payload = JSON.parse(atob(parts[1]));
    console.log('[Auth] Decoded Clerk JWT Payload:', payload);

    userId = payload.sub || payload.user_id || payload.user_metadata?.user_id;

    if (!userId) {
      console.error('[Auth] User ID (sub) not found in Clerk JWT payload.');
      return new Response(JSON.stringify({ error: 'User ID not found in token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    console.log(`[Auth] Authenticated user ID from Clerk JWT: ${userId}`);

    const xUserId = req.headers.get('x-user-id');
    if (xUserId) {
        console.log('[Auth] Received x-user-id Header (for debugging/logging only):', xUserId);
        if (userId !== xUserId) {
            console.warn(`[Auth] Mismatch between Clerk JWT user ID (${userId}) and x-user-id header (${xUserId}). Using JWT user ID.`);
        }
    }

  } catch (error) {
    console.error('[Auth] Error processing Authorization token:', error);
    return new Response(JSON.stringify({ error: 'Failed to process Authorization token.' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseClient = createClient(supabaseUrl!, supabaseAnonKey!);

  if (req.method === 'POST') {
    const contentType = req.headers.get("content-type");
    if (!contentType || !contentType.includes("multipart/form-data")) {
      return new Response(
        JSON.stringify({ error: "Content-Type must be multipart/form-data" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let fileNameForRollback: string | null = null; // エラー時のファイル名特定用
    let tmpFilePathToDelete: string | null = null; // 一時ファイル削除用

    try {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const originalFileNameFormData = formData.get("originalFileName") as string | null; // 修正: 変数名変更

      if (!file) {
        return new Response(
          JSON.stringify({ error: "File is required" }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // processAndStoreDocuments に渡すための実際のファイル名を設定
      const sourceFileName = file.name;
      fileNameForRollback = sourceFileName; // エラーロールバック用に保持
      const effectiveOriginalFileName = originalFileNameFormData || sourceFileName;


      console.log(`[File] Received file: ${sourceFileName}, size: ${file.size}, type: ${file.type}`);
      if (effectiveOriginalFileName) {
        console.log(`[File] Original file name: ${effectiveOriginalFileName}`);
      }

      if (!geminiApiKey) {
        console.error("GEMINI_API_KEY is not set for process-manual-function internal use.");
        return new Response(JSON.stringify({ error: "GEMINI_API_KEY is not configured on the server." }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const genAI = new GoogleGenerativeAI(geminiApiKey);
      const embeddingsClient = new GoogleGenerativeAIEmbeddings({ apiKey: geminiApiKey });
      
      const processedFile = await downloadAndProcessFile(sourceFileName, supabaseClient);
      
      if (processedFile && processedFile.tmpFilePath) { 
        tmpFilePathToDelete = processedFile.tmpFilePath;
      }

      if (!processedFile) {
          console.error(`File processing failed or unsupported file type for: ${sourceFileName}`);
          // ここでロールバック処理を呼び出すか検討
          return new Response(JSON.stringify({ error: "File processing failed or unsupported file type." }), {
              status: 500, 
              headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
      }
      
      console.log(`\n--- ファイル処理パイプライン (ダウンロードと抽出) 成功: ${sourceFileName} ---`);
      // processAndStoreDocuments の返り値の型を正しく扱う
      const storeResult = await processAndStoreDocuments(
        processedFile,
        sourceFileName,
        effectiveOriginalFileName,
        userId!, 
        supabaseClient,
        embeddingsClient,
        genAI
      );

      if (storeResult && storeResult.manualId) { // storeResult が null でないこと、かつ manualId を持つことを確認
        console.log(`\n--- 全体処理完了 (チャンク化とDB保存含む) 成功: ${sourceFileName} ---`);
        return new Response(JSON.stringify({ 
          message: `Successfully processed ${sourceFileName}`,
          manual_id: storeResult.manualId,
          summary: storeResult.summary,
          chunks_count: storeResult.chunksCount
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else {
        console.error('Failed to process and store document, storeResult was:', storeResult);
        throw new Error(`Failed to process ${sourceFileName} during storage/embedding steps. Result from processAndStoreDocuments was not as expected.`);
      }

    } catch (error: any) {
      console.error(`Error in POST handler for file: ${fileNameForRollback || 'Unknown file'}:`, error);
      
      if (error instanceof Error) {
          console.error(`Error Name: ${error.name}`);
          console.error(`Error Message: ${error.message}`);
          console.error(`Error Stack: ${error.stack}`);
      } else {
          console.error(`Unknown error type: ${typeof error}`, error);
      }
      
      // ファイルロールバック処理 (元のコードから持ってくる)
      if (fileNameForRollback && supabaseClient) {
        console.warn(`処理中にエラー(${error instanceof Error ? error.message : String(error)})が発生したため、Storageからファイル ${fileNameForRollback} の削除を試みます。`);
        try {
          const { error: deleteError } = await supabaseClient.storage // 修正: supabase -> supabaseClient
            .from('manuals') // BUCKET_NAME は 'manuals' と仮定。実際のバケット名に置き換える
            .remove([fileNameForRollback]); 
          if (deleteError) {
            if (deleteError.message && deleteError.message.includes("Not Found") || (deleteError as any).statusCode === 404) {
              console.log(`Storageにファイル ${fileNameForRollback} が見つからなかったため、削除はスキップされました。`);
            } else {
              console.error(`Storageからのファイル ${fileNameForRollback} の削除に失敗しました。`, deleteError);
            }
          } else {
            console.log(`Storageからファイル ${fileNameForRollback} を削除しました。`);
          }
        } catch (storageDeleteError) {
          console.error(`Storageからのファイル ${fileNameForRollback} の削除中に予期せぬエラー。`, storageDeleteError);
        }
      }

      const message = error instanceof Error ? error.message : "An unknown error occurred during file processing.";
      const detail = error instanceof Error ? error.stack || error.toString() : String(error); 
      
      return new Response(JSON.stringify({ 
          error: message, 
          detail: detail,
          timestamp: new Date().toISOString(), 
          file: fileNameForRollback || 'Unknown' 
      }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } finally {
      if (tmpFilePathToDelete) {
          try {
              await fs.unlink(tmpFilePathToDelete);
              console.log(`一時ファイル ${tmpFilePathToDelete} を削除しました。`);
          } catch (unlinkError) {
              console.error(`一時ファイル ${tmpFilePathToDelete} の削除に失敗しました:`, unlinkError);
          }
      }
      console.log(`[Handler] Finally block completed for ${fileNameForRollback || 'request associated with this handler invocation'}`);
    }
  } else {
    return new Response(
      JSON.stringify({ error: `Method ${req.method} not allowed. Use POST for file uploads.` }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

serve(handler);

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
