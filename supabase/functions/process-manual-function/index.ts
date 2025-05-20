// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

console.log("Hello from Functions!")

import { serve, ConnInfo } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PDFLoader } from "npm:@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "npm:langchain/text_splitter";
import { GoogleGenerativeAIEmbeddings } from "npm:@langchain/google-genai";
import officeParser from "npm:officeparser";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Buffer } from "node:buffer";
import "npm:dotenv/config";

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

const BUCKET_NAME = 'manuals';
const TMP_DIR_BASE = "/tmp";

// チャンクの型定義（仮）
interface ChunkObject {
    manual_id: string; // or number, depending on your DB schema
    chunk_text: string;
    page_number: number;
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
    } catch (mkdirError: any) { // Denoでは型anyがより一般的
      // ENOENT (No such file or directory) は無視しても良い場合があるが、他は警告
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
      console.log("\nPDFLoaderでドキュメントを読み込み開始...");
      const loader = new PDFLoader(actualTmpFilePath);
      docs = await loader.load();
      console.log(`ドキュメントの読み込み完了。合計 ${docs.length} ページ。`);
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

async function processAndStoreDocuments(
    processedFile: { docs: Array<{ pageContent: string; metadata: Record<string, any> }>, tmpFilePath: string } | null, 
    sourceFileName: string, 
    supabaseClient: SupabaseClient,
    embeddingsClient: GoogleGenerativeAIEmbeddings
) {
  if (!supabaseClient) throw new Error("Supabase client not initialized");
  if (!embeddingsClient) throw new Error("Embeddings client not initialized");

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

    if (existingManual) {
      manualId = existingManual.id;
      console.log(`既存のマニュアル情報を利用します。ID: ${manualId}`);
    } else {
      const totalPages = parsedDocs[0]?.metadata?.pdf?.totalPages ||
                         (parsedDocs[0]?.metadata?.type !== 'pdf' ? 1 : parsedDocs.length);
      const { data: newManual, error: insertError } = await supabaseClient
        .from('manuals')
        .insert({
          file_name: sourceFileName,
          storage_path: `${BUCKET_NAME}/${sourceFileName}`,
          metadata: { 
            totalPages: Math.round(totalPages),
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
          page_number: doc.metadata?.loc?.pageNumber || (doc.metadata?.type === 'pdf' ? i + 1 : 1),
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
  
  // POSTリクエストとパスのチェックを修正 (クラウド環境のパスを期待)
  if (req.method !== "POST" || requestPathname !== "/process-manual-function") {
    console.log(`Invalid request: Method=${req.method}, Pathname=${requestPathname}. Expected POST to /process-manual-function. Responding 404.`);
    return new Response(JSON.stringify({ error: "Not Found" }), { 
      status: 404, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }

  let tmpFilePathToDelete: string | null = null;
  try {
    if (!supabase) {
        throw new Error("Supabase client is not initialized. Check SUPABASE_URL and SUPABASE_ANON_KEY.");
    }
    if (!embeddings) {
        throw new Error("Embeddings client is not initialized. Check GEMINI_API_KEY.");
    }

    const body = await req.json();
    const { fileName } = body;

    if (!fileName || typeof fileName !== 'string') {
      return new Response(JSON.stringify({ error: 'fileName (string) is required in the request body' }), { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
    console.log(`Function called for fileName: ${fileName}`);

    const processedFile = await downloadAndProcessFile(fileName, supabase);
    if (processedFile && processedFile.tmpFilePath) {
        tmpFilePathToDelete = processedFile.tmpFilePath;
    }
    
    if (processedFile) {
      console.log("\n--- ファイル処理パイプライン (ダウンロードと抽出) 成功 ---");
      const success = await processAndStoreDocuments(processedFile, fileName, supabase, embeddings);
      if (success) {
        console.log("\n--- 全体処理完了 (チャンク化とDB保存含む) 成功 ---");
        return new Response(JSON.stringify({ message: `Successfully processed ${fileName}` }), { 
          status: 200, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      } else {
        console.error("\n--- 全体処理失敗 (チャンク化またはDB保存でエラー) ---");
        return new Response(JSON.stringify({ error: `Failed to process ${fileName} during storage/embedding.` }), { 
          status: 500, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }
    } else {
      console.error("\n--- ファイル処理パイプライン (ダウンロードと抽出) 失敗 ---");
      return new Response(JSON.stringify({ error: `Failed to download or parse ${fileName}.` }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
  } catch (error: unknown) {
    console.error('Error in function handler:', error);
    const message = error instanceof Error ? error.message : "Internal server error.";
    return new Response(JSON.stringify({ error: message }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  } finally {
    if (tmpFilePathToDelete) {
        try {
            await fs.unlink(tmpFilePathToDelete);
            console.log(`\n一時ファイルを削除しました: ${tmpFilePathToDelete}`);
        } catch (e: unknown) {
            const error = e as { code?: string }; // 型アサーション
            if (error.code !== 'ENOENT') { // ファイルが存在しないエラーは無視
                 console.warn(`一時ファイルの削除中にエラーが発生しました: ${tmpFilePathToDelete}`, e);
            } else {
                 console.log(`一時ファイルは既に存在しませんでした: ${tmpFilePathToDelete}`);
            }
        }
    }
  }
}

serve(handler, { port: 8000 }); // ポート8000でリッスンするように明示的に指定

console.log("Process manual function (Deno native HTTP) server running on port 8000!");

/* To invoke locally:

  1. Make sure your .env file has SUPABASE_URL, SUPABASE_ANON_KEY, and GEMINI_API_KEY.
  2. Run this Deno script:
     deno run --allow-net --allow-env --allow-read=/tmp,./.env --allow-write=/tmp supabase/functions/process-manual-function/index.ts
  3. Make an HTTP request:

  curl -i --location --request POST 'http://localhost:8000/' \
    --header 'Content-Type: application/json' \
    --data '{"fileName":"your-file-in-storage.pdf"}'

  Or using PowerShell:
  Invoke-WebRequest -Uri 'http://localhost:8000/' -Method POST -ContentType 'application/json' -Body '{"fileName":"your-file-in-storage.pdf"}'
*/
