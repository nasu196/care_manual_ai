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
import { OpenAIEmbeddings } from "npm:@langchain/openai"; // OpenAIEmbeddingsをインポート
import officeParser from "npm:officeparser";
import pdf from "npm:pdf-parse"; // ★ pdf-parse を直接インポート
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Buffer } from "node:buffer";
import "npm:dotenv/config";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "npm:@google/generative-ai"; // ★ 追加
import { corsHeaders } from '../_shared/cors.ts'; // ★ CORSヘッダーをインポート
import { GoogleAuth } from 'npm:google-auth-library'; // npmモジュールをインポート
import { encode } from "https://deno.land/std@0.208.0/encoding/base64.ts"; // Deno標準のBase64エンコーダー

// ★ テキストサニタイズ関数を追加
function sanitizeText(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  return text
    // NULL文字を除去
    // deno-lint-ignore no-control-regex
    .replace(/\u0000/g, '')
    // その他の制御文字を除去（改行・タブ・スペースは保持）
    // deno-lint-ignore no-control-regex
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    // 連続する空白を単一スペースに変換
    .replace(/\s+/g, ' ')
    // 前後の空白を除去
    .trim();
}

// ★ OCR判定関数：テキスト抽出が不十分かどうかを判定
function isTextExtractionInsufficient(text: string, numPages: number): boolean {
  console.log(`[OCR判定] 元テキスト長: ${text.length} 文字`);
  console.log(`[OCR判定] 元テキスト（最初の200文字）: ${text.substring(0, 200)}...`);
  
  const cleanText = sanitizeText(text);
  const textLength = cleanText.length;
  
  console.log(`[OCR判定] sanitize後テキスト長: ${textLength} 文字`);
  console.log(`[OCR判定] sanitize後テキスト（最初の200文字）: ${cleanText.substring(0, 200)}...`);
  
  // 判定基準
  const minTextPerPage = 50; // 1ページあたり最低50文字
  const minTotalText = 100;  // 総文字数最低100文字
  
  const textPerPage = Math.round(textLength / Math.max(numPages, 1));
  
  console.log(`[OCR判定] テキスト長: ${textLength}, ページ数: ${numPages}, ページあたり: ${textPerPage}`);
  console.log(`[OCR判定] 判定基準 - 総文字数: ${minTotalText}以上, ページあたり: ${minTextPerPage}以上`);
  
  if (textLength < minTotalText) {
    console.log(`[OCR判定] 総文字数不足 (${textLength} < ${minTotalText}) → OCR実行`);
    return true;
  }
  
  if (numPages > 0 && textPerPage < minTextPerPage) {
    console.log(`[OCR判定] 1ページあたりの文字数不足 (${textPerPage} < ${minTextPerPage}) → OCR実行`);
    return true;
  }
  
  console.log(`[OCR判定] テキスト抽出は十分です → OCRスキップ`);
  return false;
}

// ★ PDF画像変換関数（安全なBase64変換版）
function convertPdfPageToImage(pdfBuffer: ArrayBuffer, _pageNumber: number = 1): string | null {
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
/* // ★ コメントアウト開始
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
    const base64Image = convertPdfPageToImage(pdfBuffer);
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
*/ // ★ コメントアウト終了

// Supabaseクライアントの初期化 (環境変数から)
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
// const googleVisionApiKey = Deno.env.get("GOOGLE_VISION_API_KEY"); // ★ Google Vision API キーをコメントアウト
const openaiApiKey = Deno.env.get("OPENAI_API_KEY"); // OpenAI APIキーを追加

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("エラー: SUPABASE_URL または SUPABASE_ANON_KEY が環境変数に設定されていません。");
}
if (!geminiApiKey) {
  console.error("エラー: GEMINI_API_KEY が環境変数に設定されていません。");
}
/* // ★ コメントアウト開始
if (!googleVisionApiKey) {
  console.warn("警告: GOOGLE_VISION_API_KEY が環境変数に設定されていません。OCR機能は無効になります。");
}
*/ // ★ コメントアウト終了
if (!openaiApiKey) { // OpenAI APIキーのチェックを追加
  console.warn("警告: OPENAI_API_KEY が環境変数に設定されていません。OpenAIを使用する場合は設定してください。");
}

let _supabase: SupabaseClient;
if (supabaseUrl && supabaseAnonKey) {
    _supabase = createClient(supabaseUrl, supabaseAnonKey);
}

let _embeddings: OpenAIEmbeddings;
if (geminiApiKey) {
    _embeddings = new OpenAIEmbeddings();
}

let _genAI: GoogleGenerativeAI; // ★ 追加
if (geminiApiKey) { // ★ 追加
    _genAI = new GoogleGenerativeAI(geminiApiKey); // ★ 追加
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

// Document AI Processor の情報を設定
const GOOGLE_PROJECT_ID = Deno.env.get('GOOGLE_PROJECT_ID');
const GOOGLE_CLIENT_EMAIL = Deno.env.get('GOOGLE_CLIENT_EMAIL');
// Supabaseの環境変数で \n が \\n になっている場合を考慮し、実際の改行に戻す
const GOOGLE_PRIVATE_KEY = Deno.env.get('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\\n');

const DOC_AI_LOCATION = 'us'; // 例: 'us' や 'eu' など、プロセッサを作成したリージョン
const DOC_AI_PROCESSOR_ID = Deno.env.get('DOC_AI_PROCESSOR_ID'); // SupabaseのSecretsに設定したプロセッサID

if (!GOOGLE_PROJECT_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY || !DOC_AI_PROCESSOR_ID) {
  let errorMessage = "Missing Google Cloud credentials or Document AI Processor ID. Please check the following environment variables:";
  if (!GOOGLE_PROJECT_ID) errorMessage += "\n- GOOGLE_PROJECT_ID";
  if (!GOOGLE_CLIENT_EMAIL) errorMessage += "\n- GOOGLE_CLIENT_EMAIL";
  if (!GOOGLE_PRIVATE_KEY) errorMessage += "\n- GOOGLE_PRIVATE_KEY";
  if (!DOC_AI_PROCESSOR_ID) errorMessage += "\n- DOC_AI_PROCESSOR_ID";
  console.error(errorMessage);
  // 起動時にエラーにするか、リクエスト時にエラーレスポンスを返すかは設計による
  // ここでは起動時のログ出力に留めるが、実際のリクエスト処理前にもチェック推奨
}

const auth = new GoogleAuth({
  credentials: {
    client_email: GOOGLE_CLIENT_EMAIL,
    private_key: GOOGLE_PRIVATE_KEY,
  },
  scopes: 'https://www.googleapis.com/auth/cloud-platform',
});

async function extractTextWithDocumentAI(fileContentBase64: string, mimeType: string): Promise<string | null> {
  if (!GOOGLE_PROJECT_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY || !DOC_AI_PROCESSOR_ID) {
    console.error("Google Cloud credentials or Document AI Processor ID not configured.");
    throw new Error("Document AI OCR not configured.");
  }
  if (!fileContentBase64 || !mimeType) {
    throw new Error('Missing fileContentBase64 or mimeType for Document AI');
  }

  console.log('[Auth] Obtaining access token for Document AI...');
  const client = await auth.getClient();
  const accessToken = (await client.getAccessToken()).token;
  console.log('[Auth] Access token obtained for Document AI.');

  if (!accessToken) {
    throw new Error('Failed to obtain access token for Document AI');
  }

  const endpoint = `https://${DOC_AI_LOCATION}-documentai.googleapis.com/v1/projects/${GOOGLE_PROJECT_ID}/locations/${DOC_AI_LOCATION}/processors/${DOC_AI_PROCESSOR_ID}:process`;

  console.log(`[DocumentAI] Processing document. Endpoint: ${endpoint.substring(0,100)}...`); // URLが長いので一部表示

  const requestBody = {
    rawDocument: {
      content: fileContentBase64,
      mimeType: mimeType,
    },
    // 必要に応じて Human Review をスキップする設定などを追加
    // processOptions: {
    //   ocrConfig: {
    //     enableNativePdfParsing: true, // PDFの場合、より高品質な結果を得るために推奨されることがある
    //     // enableImageQualityScores: true,
    //   }
    // },
    // skipHumanReview: true,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json', // レスポンス形式を明示
    },
    body: JSON.stringify(requestBody),
  });

  console.log(`[DocumentAI] Response status: ${response.status}`);
  const responseData = await response.json();

  if (!response.ok) {
    console.error('[DocumentAI] Error response:', JSON.stringify(responseData, null, 2));
    throw new Error(responseData.error?.message || `Document AI API request failed with status ${response.status}`);
  }

  const extractedText = responseData.document?.text;
  console.log('[DocumentAI] Extracted text length:', extractedText?.length || 0);
  if (extractedText && extractedText.length > 0) {
    console.log('[DocumentAI] Extracted text snippet:', extractedText.substring(0, 200) + "...");
  }

  return extractedText || null;
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
    } catch (mkdirError: unknown) {
      const error = mkdirError as { code?: string };
      if (error.code !== 'ENOENT' && error.code !== 'EEXIST') {
         console.warn(`一時サブディレクトリの作成に失敗: ${appTmpDir}`, mkdirError);
      } else if (error.code === 'EEXIST') {
         console.log(`一時サブディレクトリは既に存在します: ${appTmpDir}`);
      }
    }

    const fileBuffer = Buffer.from(await blob.arrayBuffer());
    await fs.writeFile(actualTmpFilePath, fileBuffer);
    console.log(`一時ファイルとして保存: ${actualTmpFilePath}`);

    let docs: Array<{ pageContent: string; metadata: Record<string, unknown> }> = [];
    let numPages = 0;
    let textContent = '';

    console.log(`[${new Date().toISOString()}] [downloadAndProcessFile] Before parsing (${fileExtension}): ${actualTmpFilePath}`); // ★ 追加
    if (fileExtension === '.pdf') {
      console.log("[Process] Processing PDF with Document AI...");
      try {
        // fileBuffer は ArrayBuffer なので、Uint8Array に変換し、その後 Base64 文字列にエンコードする
        const uint8Array = new Uint8Array(fileBuffer);
        const fileContentBase64 = encode(uint8Array); // encode は既にインポートされている想定

        const rawExtractedText = await extractTextWithDocumentAI(fileContentBase64, 'application/pdf');
        
        if (rawExtractedText && rawExtractedText.trim().length > 0) {
          textContent = sanitizeText(rawExtractedText);
          console.log(`[Process] Text extracted via Document AI. Length: ${textContent.length}`);
        } else {
          console.warn("[Process] Document AI OCR resulted in empty or whitespace-only text for PDF.");
          textContent = "";
        }
      } catch (e) {
        if (e instanceof Error) {
          console.error(`[Process] Error processing PDF with Document AI: ${e.message}`, e.stack);
          docs.push({
            pageContent: `Error processing PDF with Document AI: ${e.message}`,
            metadata: { source: actualTmpFilePath, type: 'error', error_details: e.stack }
          });
        } else {
          console.error(`[Process] Unknown error processing PDF with Document AI:`, e);
          docs.push({
            pageContent: `Error processing PDF with Document AI: An unknown error occurred.`,
            metadata: { source: actualTmpFilePath, type: 'error', error_details: String(e) }
          });
        }
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
  } catch (error: unknown) {
    console.error("Gemini API を使用したサマリー生成中にエラーが発生しました:", error);
    // エラーレスポンスに詳細が含まれている場合があるため、ログに出力
    if (error && typeof error === 'object' && 'response' in error) {
        const errorWithResponse = error as { response?: { promptFeedback?: unknown } };
        if (errorWithResponse.response && errorWithResponse.response.promptFeedback) {
            console.error("Prompt Feedback:", errorWithResponse.response.promptFeedback);
        }
    }
    return null; // エラー時はnullを返す
  }
}

async function processAndStoreDocuments(
    processedFile: { docs: Array<{ pageContent: string; metadata: Record<string, unknown> }>, tmpFilePath: string } | null, 
    sourceFileName: string, 
    originalFileName: string | null,
    userId: string,
    supabaseClient: SupabaseClient,
    embeddingsClient: OpenAIEmbeddings, // GoogleGenerativeAIEmbeddings から OpenAIEmbeddings に変更
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
    let selectQueryError: unknown = null;

    console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Value of sourceFileName before DB query: '${sourceFileName}' (length: ${sourceFileName.length})`); // ★ 追加: sourceFileNameの値をログ出力
    const expectedStoragePath = `${BUCKET_NAME}/${sourceFileName}`; // `manuals/userId/encodedFileName`
    console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Expected storage_path for query: '${expectedStoragePath}'`);

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
    console.log(`[${new Date().toISOString()}] [processAndStoreDocuments] Step 3: Initializing filterBuilder = selectBuilder.eq('storage_path', expectedStoragePath).eq('user_id', userId)...`);
    const filterBuilder = selectBuilder.eq('storage_path', expectedStoragePath).eq('user_id', userId);
    if (!filterBuilder) {
        console.error(`[${new Date().toISOString()}] [processAndStoreDocuments] CRITICAL: selectBuilder.eq('storage_path', ...) returned null/undefined.`);
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

    if (selectQueryError && (selectQueryError as { code?: string }).code !== 'PGRST116') { // PGRST116は「該当なし」のエラーコードなので無視
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
      const updateData: Record<string, unknown> = {
        original_file_name: originalFileName || sourceFileName.split('/').pop() || sourceFileName, // userId/encodedName から encodedName を抽出
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
      
      // sourceFileName (userId/encodedFileName) から encodedFileName のみを取り出す
      const encodedNameOnly = sourceFileName.includes('/') ? sourceFileName.substring(sourceFileName.lastIndexOf('/') + 1) : sourceFileName;

      const insertData: Record<string, unknown> = {
        file_name: encodedNameOnly, // encodedFileName のみ
        original_file_name: originalFileName || encodedNameOnly, 
        storage_path: `${BUCKET_NAME}/${sourceFileName}`, // manuals/userId/encodedFileName
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
  console.log("[Handler] Request received");

  // CORS preflight request
  if (req.method === 'OPTIONS') {
    console.log("[Handler] OPTIONS request, returning CORS headers");
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // APIキーのチェック
    if (!geminiApiKey) {
      console.error("[Handler] GEMINI_API_KEY is not set");
      return new Response(JSON.stringify({ error: "サーバー設定エラー: Gemini APIキーが設定されていません。" }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!openaiApiKey) { // OpenAI APIキーのチェックを追加
      console.error("[Handler] OPENAI_API_KEY is not set");
      return new Response(JSON.stringify({ error: "サーバー設定エラー: OpenAI APIキーが設定されていません。" }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "" // ここではサービスロールキーを使用
    );
    console.log("[Handler] Supabase client (service role) initialized");

    // OpenAIEmbeddingsのインスタンスを作成
    const embeddings = new OpenAIEmbeddings(); // APIキーは環境変数から自動読み込み
    console.log("[Handler] OpenAIEmbeddings client initialized");

    // GoogleGenerativeAIのインスタンスを作成 (これはサマリー生成用なので残す)
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    console.log("[Handler] GoogleGenerativeAI client for summary initialized");

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

    // Clerk JWTからユーザーIDを取得
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

      userId = payload.user_metadata?.user_id || payload.sub || payload.user_id;

      if (!userId) {
        console.error('[Auth] User ID not found in Clerk JWT payload.');
        return new Response(JSON.stringify({ error: 'User ID not found in token' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.log(`[Auth] Authenticated user ID from Clerk JWT: ${userId}`);

    } catch (error) {
      console.error('[Auth] Error processing Authorization token:', error);
      return new Response(JSON.stringify({ error: 'Failed to process Authorization token.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST') {
      const contentType = req.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        return new Response(
          JSON.stringify({ error: "Content-Type must be application/json" }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let fileNameForRollback: string | null = null; // エラー時のファイル名特定用
      let tmpFilePathToDelete: string | null = null; // 一時ファイル削除用

      try {
        const body = await req.json();
        const fileName = body.fileName as string | null;
        const originalFileName = body.originalFileName as string | null;

        if (!fileName) {
          return new Response(
            JSON.stringify({ error: "fileName is required" }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        fileNameForRollback = fileName;
        const effectiveOriginalFileName = originalFileName || fileName;

        console.log(`[File] fileName: ${fileName}`);
        if (effectiveOriginalFileName) {
          console.log(`[File] Original file name: ${effectiveOriginalFileName}`);
        }

        const processedFile = await downloadAndProcessFile(fileName, supabaseClient);
        if (processedFile && processedFile.tmpFilePath) { 
          tmpFilePathToDelete = processedFile.tmpFilePath;
        }
        if (!processedFile) {
          console.error(`File processing failed or unsupported file type for: ${fileName}`);
          return new Response(JSON.stringify({ error: "File processing failed or unsupported file type." }), {
            status: 500, 
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        console.log(`\n--- ファイル処理パイプライン (ダウンロードと抽出) 成功: ${fileName} ---`);
        const storeResult = await processAndStoreDocuments(
          processedFile,
          fileName,
          effectiveOriginalFileName,
          userId,
          supabaseClient,
          embeddings,
          genAI
        );
        if (storeResult && storeResult.manualId) {
          console.log(`\n--- 全体処理完了 (チャンク化とDB保存含む) 成功: ${fileName} ---`);
          return new Response(JSON.stringify({ 
            message: `Successfully processed ${fileName}`,
            manual_id: storeResult.manualId,
            summary: storeResult.summary,
            chunks_count: storeResult.chunksCount
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } else {
          console.error('Failed to process and store document, storeResult was:', storeResult);
          throw new Error(`Failed to process ${fileName} during storage/embedding steps. Result from processAndStoreDocuments was not as expected.`);
        }
      } catch (error: unknown) {
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
              if (deleteError.message && deleteError.message.includes("Not Found") || (deleteError as { statusCode?: number }).statusCode === 404) {
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
  } catch (error) {
    console.error(`[Handler] Error processing request:`, error);
    return new Response(JSON.stringify({ error: "An unexpected error occurred during request processing." }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
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

// Base64文字列かどうかを簡易的にチェックするヘルパー関数 (必要なら)
function isBase64(str: string): boolean {
  if (typeof str !== 'string') return false;
  // Base64の基本的な文字セットとパディングのチェック（完全ではないが簡易的なもの）
  const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  // さらに、文字列長が4の倍数であることも条件の一つ
  return base64Regex.test(str) && str.length % 4 === 0;
}
