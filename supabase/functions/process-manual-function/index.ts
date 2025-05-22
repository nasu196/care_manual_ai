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

    if (fileExtension === '.pdf') {
      console.log("\npdf-parseでドキュメントを読み込み開始...");
      const pdfData = await pdfParse(fileBuffer); // ★ PDFLoaderの代わりにpdfParseを使用
      // pdfParseの結果からページごとの情報を取得するのは少し工夫が必要
      // LangChainのPDFLoaderはページ単位でDocumentを生成するが、pdf-parseは主にテキスト全体とメタデータを返す
      // ここではまずテキスト全体を1つのドキュメントとして扱う
      // 必要であれば、ページ分割のロジックをpdfData.numpagesなどを使って自作することも検討
      docs = [{
        pageContent: pdfData.text,
        metadata: { 
            source: fileName, 
            type: 'pdf',
            totalPages: pdfData.numpages, // pdf-parseから総ページ数を取得
            // loc: { pageNumber: 1 } // ページ単位ではないため、このような情報は付与しにくい
        }
      }];
      console.log(`ドキュメントの読み込み完了。合計 ${pdfData.numpages} ページ (テキストは結合)。`);
    } else if (['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'].includes(fileExtension)) {
      console.log(`\nofficeparserで ${fileExtension} ファイルのテキスト抽出を開始...`);
      const data = await new Promise<string>((resolve, reject) => {
        officeParser.parseOffice(actualTmpFilePath, (content: string, err: Error | null) => {
          if (err) {
            console.error(`officeParser.parseOffice エラー: ${fileExtension}`, err);
            return reject(err);
          }
          resolve(content);
        });
      });
      docs = [{
        pageContent: data,
        metadata: {
          source: fileName,
          type: fileExtension.substring(1),
        }
      }];
      console.log(`${fileExtension} ファイルのテキスト抽出完了。`);
    } else {
      console.warn(`未対応のファイル形式です: ${fileExtension}`);
      return null;
    }
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
  const prompt = `以下のドキュメント内容を、後続のAIシステムが「次に取るべきアクションの提案」や「関連するメモの提案」を効果的に生成できるよう、入力データとして最適化された形で要約してください。この要約は人間が直接読むことを主目的としていません。\n\n以下の指針に従い、構造的かつ情報密度の高いテキストを生成してください：\n\n1.  **網羅性**: 元ドキュメントから、提案生成の根拠となり得る主要なトピック、キーポイント、議論の核心、結論、具体的な提案、重要な数値や固有名詞を全て抽出・含めてください。\n2.  **明確性**: 各情報は具体的かつ曖昧さなく記述し、AIが容易に解釈できるよう直接的な表現を用いてください。比喩や間接的な言い回しは避けてください。\n3.  **構成と構造化**: 元ドキュメントの論理構造（章、節、項など）を可能な範囲で反映し、それぞれのセクションの核心が明確に伝わるように記述してください。関連性の高い情報はグループ化し、必要であれば項目立てるなど、AIが情報の関連性を把握しやすい構造を意識してください。\n4.  **冗長性の排除**: AIの入力として価値の低い導入文、結論に至るまでの詳細な経緯説明の繰り返し、過度な装飾的表現は極力排除し、情報を凝縮してください。\n5.  **文字数**: 厳密な文字数制限はありません。上記1～4の指針を満たし、元ドキュメントの情報をAIが活用できる形で十分に含みつつ、可能な限りトークン効率の高い形でコンパクトにまとめてください。ドキュメントの複雑性と情報量に応じて、出力の長さは数百字から数千字の範囲で変動することを想定しています。\n\n---\n${text}\n---\nAI向け構造化要約:`;

  try {
    console.log("Gemini API を呼び出してサマリー生成を開始...");
    // テキスト生成リクエストを送信します。
    const result = await model.generateContent(prompt);
    const response = result.response;
    const summary = response.text();
    console.log("サマリー生成成功。");
    return summary;
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
    supabaseClient: SupabaseClient,
    embeddingsClient: GoogleGenerativeAIEmbeddings,
    generativeAiClient: GoogleGenerativeAI // ★ 引数追加
) {
  if (!supabaseClient) throw new Error("Supabase client not initialized");
  if (!embeddingsClient) throw new Error("Embeddings client not initialized");
  // generativeAiClient のチェックはサマリー生成関数内で行う

  if (!processedFile || !processedFile.docs || processedFile.docs.length === 0) {
    console.log("解析されたドキュメントがないため、処理をスキップします。");
    return false;
  }
  const parsedDocs = processedFile.docs;
  console.log(`\nドキュメントのチャンク化とDB保存を開始... ファイル名: ${sourceFileName}`);
  
  try {
    let manualId: string;
    const { data: existingManual, error: selectError } = await supabaseClient
      .from('manuals')
      .select('id')
      .eq('file_name', sourceFileName)
      .single();

    if (selectError && selectError.code !== 'PGRST116') {
      console.error(`既存マニュアルの確認中にエラー: ${sourceFileName}`, selectError);
      throw selectError;
    }

    let summaryText: string | null = null;
    if (parsedDocs.length > 0 && parsedDocs[0].pageContent) {
        summaryText = await generateSummary(parsedDocs[0].pageContent, generativeAiClient); // ★ サマリー生成
    } else {
        console.log("ドキュメントのテキストコンテンツが見つからないため、サマリー生成をスキップします。");
    }

    if (existingManual) {
      manualId = existingManual.id;
      console.log(`既存のマニュアル情報を利用します。ID: ${manualId}`);
      // 既存マニュアルの場合もサマリーを更新する
      const { error: updateError } = await supabaseClient
        .from('manuals')
        .update({ 
            summary: summaryText,
            // 必要であれば他のメタデータも更新
            metadata: { 
                totalPages: parsedDocs[0]?.metadata?.totalPages || (parsedDocs[0]?.metadata?.type !== 'pdf' ? 1 : parsedDocs.length),
                sourceType: parsedDocs[0]?.metadata?.type || path.extname(sourceFileName).substring(1) || 'unknown',
                lastProcessed: new Date().toISOString() 
            },
         })
        .eq('id', manualId);
      if (updateError) {
        console.error(`既存マニュアルのサマリー更新中にエラー: ID=${manualId}`, updateError);
        // エラーが発生しても処理を続行する（サマリーが更新されないだけ）
      } else {
        console.log(`既存マニュアルのサマリーを更新しました。ID: ${manualId}`);
      }
    } else {
      const totalPages = parsedDocs[0]?.metadata?.totalPages ||
                         (parsedDocs[0]?.metadata?.type !== 'pdf' ? 1 : parsedDocs.length);
      const { data: newManual, error: insertError } = await supabaseClient
        .from('manuals')
        .insert({
          file_name: sourceFileName,
          storage_path: `${BUCKET_NAME}/${sourceFileName}`,
          summary: summaryText,
          metadata: { 
            totalPages: totalPages,
            sourceType: parsedDocs[0]?.metadata?.type || path.extname(sourceFileName).substring(1) || 'unknown'
          },
        })
        .select('id')
        .single();
      if (insertError || !newManual) {
        console.error(`新規マニュアル情報のDB登録に失敗: ${sourceFileName}`, insertError);
        throw insertError || new Error("Failed to insert new manual and retrieve ID.");
      }
      manualId = newManual.id;
      console.log(`新規マニュアル情報をDBに登録しました。ID: ${manualId}`);
    }

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 2500,
      chunkOverlap: 400,
      separators: ["\n\n", "。\n", "！\n", "？\n", "\n", "。", "！", "？", "、", " ", "　", ""],
    });

    const chunks: ChunkObject[] = [];
    for (let i = 0; i < parsedDocs.length; i++) {
      const doc = parsedDocs[i];
      const pageContent = doc.pageContent || "";
      if (!pageContent.trim()) {
          console.log(`ドキュメント ${i+1} は空の内容のためスキップします。`);
          continue;
      }
      const splitText: string[] = await splitter.splitText(pageContent);
      splitText.forEach((text: string, index: number) => {
        chunks.push({
          manual_id: manualId,
          chunk_text: text,
          chunk_order: index + 1,
        });
      });
    }
    console.log(`合計 ${chunks.length} 個のチャンクに分割しました。`);
    if (chunks.length === 0) {
        console.log("チャンクが生成されませんでした。処理を終了します。");
        return true;
    }

    console.log("チャンクのベクトル化とDB保存を開始...");
    const chunkTextsForEmbedding = chunks.map(c => c.chunk_text);
    const chunkEmbeddings = await embeddingsClient.embedDocuments(chunkTextsForEmbedding);
    console.log(`${chunkEmbeddings.length} 個のチャンクのベクトル化完了。`);

    const chunksToInsert: ChunkObject[] = chunks.map((chunk, i) => ({
      ...chunk,
      embedding: chunkEmbeddings[i],
    }));

    const { error: deleteChunksError } = await supabaseClient
        .from('manual_chunks')
        .delete()
        .eq('manual_id', manualId);
    if (deleteChunksError) {
        console.error(`既存チャンクの削除中にエラー: manual_id=${manualId}`, deleteChunksError);
        // ここではエラーをスローせず、処理を続行する（古いチャンクが残る可能性はある）
    } else {
        console.log(`manual_id=${manualId} の既存チャンクを削除しました（もしあれば）。`);
    }
    
    const { error: insertChunksError } = await supabaseClient
      .from('manual_chunks')
      .insert(chunksToInsert);
    if (insertChunksError) {
      console.error("チャンクのDB保存中にエラー:", insertChunksError);
      throw insertChunksError;
    }
    console.log(`${chunksToInsert.length} 個のチャンクをDBに保存しました。`);
    return true;
  } catch (error) {
    console.error(`\nドキュメント処理・保存中にエラーが発生: ${sourceFileName}`, error);
    if (error instanceof Error) {
        // ここでエラー内容に応じて特別な処理やロギングが可能
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
    const { fileName } = body;
    receivedFileName = fileName; // ★ fileName を receivedFileName に保存

    if (!receivedFileName || typeof receivedFileName !== 'string') {
      console.error("fileName (string) is required in the request body.");
      return new Response(JSON.stringify({ error: 'fileName (string) is required in the request body' }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log(`処理対象ファイル: ${receivedFileName}`);

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
    const success = await processAndStoreDocuments(processedFile, receivedFileName, supabase, embeddings, genAI);

    if (success) {
      console.log(`\n--- 全体処理完了 (チャンク化とDB保存含む) 成功: ${receivedFileName} ---`);
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
    
    // ロールバック処理: Storageからファイルを削除 (エラー発生時)
    if (receivedFileName && supabase) {
      console.warn(`処理中にエラー(${error.message})が発生したため、Storageからファイル ${receivedFileName} の削除を試みます。`);
      try {
        const { error: deleteError } = await supabase.storage
          .from(BUCKET_NAME)
          .remove([receivedFileName]); 
        if (deleteError) {
          if (deleteError.message.includes("Not Found") || (deleteError as any).statusCode === 404) {
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
    return new Response(JSON.stringify({ error: message, detail: error.toString() }), { // error.toString() を追加
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
            if (e.code !== 'ENOENT') { 
                 console.warn(`Finallyブロック: 一時ファイルの削除中にエラーが発生しました (無視): ${tmpFilePathToDelete}`, e);
            } else {
                 console.log(`Finallyブロック: 一時ファイルは既に存在しませんでした (無視): ${tmpFilePathToDelete}`);
            }
        }
    }
  }
}

serve(handler); // ポート指定を削除。Deno Deployでは自動的に割り当てられる。ローカルテスト時はデフォルト(8000)

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
