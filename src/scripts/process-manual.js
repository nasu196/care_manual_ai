require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { PDFLoader } = require('@langchain/community/document_loaders/fs/pdf');
const fs = require('fs/promises');
const path = require('path');
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const { GoogleGenerativeAIEmbeddings } = require('@langchain/google-genai');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("エラー: SUPABASE_URL または SUPABASE_ANON_KEY が .env ファイルに設定されていません。");
  process.exit(1);
}
if (!geminiApiKey) {
  console.error("エラー: GEMINI_API_KEY が .env ファイルに設定されていません。");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: geminiApiKey,
  model: "text-embedding-004",
});

const BUCKET_NAME = 'manuals';
const FILE_NAME = 'r6_koubover2_sogyo1.pdf'; // ユーザーがアップロードしたファイル名
const TMP_DIR = path.join(__dirname, '../../tmp'); // プロジェクトルート/tmp

async function downloadAndParsePdf() {
  console.log(`Supabase Storageからファイル ${FILE_NAME} をダウンロード開始...`);
  const tmpFilePath = path.join(TMP_DIR, FILE_NAME);

  try {
    const { data: blob, error: downloadError } = await supabase.storage
      .from(BUCKET_NAME)
      .download(FILE_NAME);

    if (downloadError) {
      console.error(`エラー: ファイルのダウンロードに失敗しました。 ${BUCKET_NAME}/${FILE_NAME}`, downloadError);
      throw downloadError;
    }
    console.log("ファイルのダウンロード成功。");

    const buffer = Buffer.from(await blob.arrayBuffer());
    await fs.mkdir(TMP_DIR, { recursive: true });
    await fs.writeFile(tmpFilePath, buffer);
    console.log(`一時ファイルとして保存: ${tmpFilePath}`);

    console.log("\nPDFLoaderでドキュメントを読み込み開始...");
    const loader = new PDFLoader(tmpFilePath, {});

    const docs = await loader.load();
    console.log(`ドキュメントの読み込み完了。合計 ${docs.length} ページ (またはドキュメント数)。`);

    if (docs.length > 0) {
      console.log("\n最初のページのメタデータ:", docs[0].metadata);
      console.log("最初のページの内容抜粋 (最初の200文字):");
      console.log(docs[0].pageContent.substring(0, 200) + "...");
    }
    return docs;
  } catch (error) {
    console.error("\n処理中にエラーが発生しました:", error);
    return null;
  } finally {
    try {
      if (await fs.stat(tmpFilePath).catch(() => false)) { // statでファイルの存在を確認し、なければエラーをキャッチ
        await fs.unlink(tmpFilePath);
        console.log(`\n一時ファイルを削除しました: ${tmpFilePath}`);
      }
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.warn(`一時ファイルの削除中にエラーが発生しました: ${tmpFilePath}`, e);
      }
    }
  }
}

async function processAndStoreDocuments(parsedDocs, sourceFileName) {
  if (!parsedDocs || parsedDocs.length === 0) {
    console.log("解析されたドキュメントがないため、処理をスキップします。");
    return false;
  }
  console.log(`\nドキュメントのチャンク化とDB保存を開始... ファイル名: ${sourceFileName}`);
  try {
    let manualId;
    const { data: existingManual, error: selectError } = await supabase
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
      const totalPages = parsedDocs.reduce((sum, doc) => sum + (doc.metadata?.pdf?.totalPages || 0), 0) / parsedDocs.length;
      const { data: newManual, error: insertError } = await supabase
        .from('manuals')
        .insert({
          file_name: sourceFileName,
          storage_path: `${BUCKET_NAME}/${sourceFileName}`,
          metadata: { totalPages: Math.round(totalPages) || parsedDocs.length },
        })
        .select('id')
        .single();
      if (insertError) {
        console.error(`新規マニュアル情報のDB登録に失敗: ${sourceFileName}`, insertError);
        throw insertError;
      }
      manualId = newManual.id;
      console.log(`新規マニュアル情報をDBに登録しました。ID: ${manualId}`);
    }

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 2500,
      chunkOverlap: 400,
    });
    const chunks = [];
    for (let i = 0; i < parsedDocs.length; i++) {
      const doc = parsedDocs[i];
      const splitText = await splitter.splitText(doc.pageContent);
      splitText.forEach((text, index) => {
        chunks.push({
          manual_id: manualId,
          chunk_text: text,
          page_number: doc.metadata?.loc?.pageNumber || i + 1,
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
    const chunkEmbeddings = await embeddings.embedDocuments(chunkTextsForEmbedding);
    console.log(`${chunkEmbeddings.length} 個のチャンクのベクトル化完了。`);

    const chunksToInsert = chunks.map((chunk, i) => ({
      manual_id: chunk.manual_id,
      chunk_text: chunk.chunk_text,
      embedding: chunkEmbeddings[i],
      page_number: chunk.page_number,
      chunk_order: chunk.chunk_order,
    }));

    const { error: deleteChunksError } = await supabase
        .from('manual_chunks')
        .delete()
        .eq('manual_id', manualId);
    if (deleteChunksError) {
        console.error(`既存チャンクの削除中にエラー: manual_id=${manualId}`, deleteChunksError);
    } else {
        console.log(`manual_id=${manualId} の既存チャンクを削除しました（もしあれば）。`);
    }
    
    const { error: insertChunksError } = await supabase
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
    return false;
  }
}

async function main() {
  const documents = await downloadAndParsePdf();
  if (documents) {
    console.log("\n--- PDF処理パイプライン (ダウンロードと読み込み) 成功 ---");
    const success = await processAndStoreDocuments(documents, FILE_NAME);
    if (success) {
      console.log("\n--- 全体処理完了 (チャンク化とDB保存含む) 成功 ---");
    } else {
      console.error("\n--- 全体処理失敗 (チャンク化またはDB保存でエラー) ---");
    }
  } else {
    console.error("\n--- PDF処理パイプライン (ダウンロードと読み込み) 失敗 ---");
  }
}

main(); 