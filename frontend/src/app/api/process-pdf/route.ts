import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { OpenAIEmbeddings } from '@langchain/openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAuth } from 'google-auth-library';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
// PDFライブラリは使用時に動的にインポート
import * as path from 'path';
import * as fs from 'fs/promises';
import { Buffer } from 'buffer';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ChunkObject {
  manual_id: string;
  chunk_text: string;
  chunk_order: number;
  embedding?: number[];
}

// テキストサニタイズ関数
function sanitizeText(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  const cleaned = text
    // NULL文字と制御文字を除去
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    // OCRで頻繁に出現する意味のない記号・文字を除去
    .replace(/[▪▫■□●○◆◇▲△▼▽★☆※]/g, '')
    .replace(/[｜￨∣]/g, '')
    .replace(/[－―‐‑‒–—]/g, '-')
    .replace(/[''""]/g, '"')
    // 繰り返し記号を制限
    .replace(/(.)\1{4,}/g, '$1$1$1')
    // 意味のない短い断片を除去
    .replace(/\n\s*[^\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]\s*\n/g, '\n')
    // 不要な特殊文字・記号を除去
    .replace(/[\\|~`\^{}\[\]<>]/g, '')
    .replace(/[＜＞｛｝［］]/g, '')
    // 連続する句読点を制限
    .replace(/[。、]{3,}/g, '。')
    .replace(/[!！]{2,}/g, '!')
    .replace(/[?？]{2,}/g, '?')
    // 空白・改行の正規化
    .replace(/[\t\u00A0\u2000-\u200B\u2028-\u2029\u3000]/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ ]*\n[ ]*/g, '\n')
    .trim();
    
  // 意味のない短い単語の除去
  const lines = cleaned.split('\n');
  const meaningfulLines = lines.filter(line => {
    const trimmedLine = line.trim();
    if (!trimmedLine) return true;
    
    if (trimmedLine.length === 1 && !/[a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF。、！？]/.test(trimmedLine)) {
      return false;
    }
    
    if (trimmedLine.length <= 2 && !/[a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(trimmedLine)) {
      return false;
    }
    
    return true;
  });
  
  return meaningfulLines.join('\n').trim();
}

// 意味のあるテキスト判定関数
function calculateMeaningfulTextRatio(text: string): number {
  if (!text) return 0;
  
  const meaningfulChars = text.match(/[a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF。、！？\.\,\!\?]/g) || [];
  const totalChars = text.length;
  
  return totalChars > 0 ? meaningfulChars.length / totalChars : 0;
}

// OCR判定関数
function isTextExtractionInsufficient(text: string, numPages: number): boolean {
  const cleanText = sanitizeText(text);
  const textLength = cleanText.length;
  
  const meaningfulRatio = calculateMeaningfulTextRatio(cleanText);
  
  const minTextPerPage = 50;
  const minTotalText = 100;
  const minMeaningfulRatio = 0.6;
  
  const textPerPage = Math.round(textLength / Math.max(numPages, 1));
  
  if (textLength < minTotalText) {
    return true;
  }
  
  if (numPages > 0 && textPerPage < minTextPerPage) {
    return true;
  }
  
  if (meaningfulRatio < minMeaningfulRatio) {
    return true;
  }
  
  return false;
}

// Document AI処理関数
async function extractTextWithDocumentAI(fileContentBase64: string, mimeType: string): Promise<string | null> {
  const GOOGLE_PROJECT_ID = process.env.GOOGLE_PROJECT_ID;
  const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
  const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const DOC_AI_PROCESSOR_ID = process.env.DOC_AI_PROCESSOR_ID;
  const DOC_AI_LOCATION = 'us';

  if (!GOOGLE_PROJECT_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY || !DOC_AI_PROCESSOR_ID) {
    console.error("Google Cloud credentials or Document AI Processor ID not configured.");
    throw new Error("Document AI OCR not configured.");
  }

  if (!fileContentBase64 || !mimeType) {
    throw new Error('Missing fileContentBase64 or mimeType for Document AI');
  }

  const auth = new GoogleAuth({
    credentials: {
      client_email: GOOGLE_CLIENT_EMAIL,
      private_key: GOOGLE_PRIVATE_KEY,
    },
    scopes: 'https://www.googleapis.com/auth/cloud-platform',
  });

  const client = await auth.getClient();
  const accessToken = (await client.getAccessToken()).token;

  if (!accessToken) {
    throw new Error('Failed to obtain access token for Document AI');
  }

  const endpoint = `https://${DOC_AI_LOCATION}-documentai.googleapis.com/v1/projects/${GOOGLE_PROJECT_ID}/locations/${DOC_AI_LOCATION}/processors/${DOC_AI_PROCESSOR_ID}:process`;

  const requestBody = {
    rawDocument: {
      content: fileContentBase64,
      mimeType: mimeType,
    },
    processOptions: {
      ocrConfig: {
        enableNativePdfParsing: true,
        enableImageQualityScores: false,
        enableSymbol: false,
        computeStyleInfo: false,
        disableCharacterBoxesDetection: true,
      },
      layoutConfig: {
        chunkingConfig: {
          includeAncestorHeadings: false,
        }
      }
    },
    imagelessMode: true,
    skipHumanReview: true,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const responseData = await response.json();

  if (!response.ok) {
    console.error('Document AI error:', responseData.error?.message || `Status ${response.status}`);
    throw new Error(responseData.error?.message || `Document AI API request failed with status ${response.status}`);
  }

  return responseData.document?.text || null;
}

// サマリー生成関数
async function generateSummary(text: string, generativeAiClient: GoogleGenerativeAI): Promise<string | null> {
  try {
    const model = generativeAiClient.getGenerativeModel({ 
      model: "gemini-2.0-flash",
      generationConfig: {
        temperature: 0.3,
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 2048,
      },
    });

    const prompt = `以下のドキュメントの内容を簡潔に要約してください。重要なポイント、手順、注意事項があれば含めてください。要約は200文字程度でお願いします。

ドキュメント内容:
${text.substring(0, 8000)}`;

    const result = await model.generateContent(prompt);
    return result.response.text() || null;
  } catch (error) {
    console.error('Summary generation error:', error);
    return null;
  }
}

// ファイルダウンロードと処理
async function downloadAndProcessFile(fileName: string, supabaseClient: SupabaseClient) {
  const fileExtension = path.extname(fileName).toLowerCase();
  console.log(`Processing file: ${fileName}`);

  try {
    const { data: blob, error: downloadError } = await supabaseClient.storage
      .from('manuals')
      .download(fileName);

    if (downloadError) {
      console.error(`Download error for ${fileName}:`, downloadError);
      throw downloadError;
    }

    const fileBuffer = Buffer.from(await blob.arrayBuffer());
    let docs: Array<{ pageContent: string; metadata: Record<string, unknown> }> = [];
    let numPages = 0;
    let textContent = '';

    if (fileExtension === '.pdf') {
      console.log("Starting PDF processing with pdfreader...");
      
      try {
        // pdfreaderを動的にインポート
        const PdfReader = await import('pdfreader');
        
        // PDFテキスト抽出
        console.log("Processing PDF with pdfreader library...");
        
        const { extractedText, pageCount } = await new Promise<{ extractedText: string; pageCount: number }>((resolve, reject) => {
          let text = '';
          let pages = 0;
          
          interface PdfReaderItem {
            text?: string;
            page?: number;
            [key: string]: unknown;
          }
          
          const reader = new (PdfReader.PdfReader as unknown as new () => {
            parseBuffer: (buffer: Buffer, callback: (err: Error | null, item: PdfReaderItem | null) => void) => void;
          })();
          
          // テキスト抽出のイベントハンドラ
          reader.parseBuffer(fileBuffer, (err: Error | null, item: PdfReaderItem | null) => {
            if (err) {
              console.error("pdfreader parsing error:", err);
              reject(err);
              return;
            }
            
            if (!item) {
              // 処理完了
              console.log(`PDF parsing completed: ${text.length} characters, ${pages} pages`);
              resolve({ extractedText: text, pageCount: pages });
              return;
            }
            
            if (item.page) {
              // 新しいページ
              pages = Math.max(pages, item.page);
            }
            
            if (item.text) {
              // テキスト追加
              text += item.text + ' ';
            }
          });
        });
        
        // テキストのクリーンアップ
        const cleanedText = extractedText
          .replace(/\s+/g, ' ')
          .trim();
        
        console.log(`PDF processing result: ${cleanedText.length} characters, ${pageCount} pages`);
        
        if (cleanedText.length > 0) {
          textContent = cleanedText;
          numPages = pageCount || 1;
        } else {
          throw new Error("No text extracted from PDF");
        }

      } catch (pdfError) {
        console.error("PDF processing error:", pdfError);
        throw new Error(`PDF processing failed: ${pdfError instanceof Error ? pdfError.message : 'Unknown error'}`);
      }

      // Document AI OCR処理が必要かチェック
      if (numPages <= 30 && isTextExtractionInsufficient(textContent, numPages)) {
        console.log("Starting Document AI OCR processing...");

        try {
          const fileContentBase64 = fileBuffer.toString('base64');
          const ocrText = await extractTextWithDocumentAI(fileContentBase64, 'application/pdf');
          
          if (ocrText && ocrText.length > 0) {
            const sanitizedOcrText = sanitizeText(ocrText);
            const ocrMeaningfulRatio = calculateMeaningfulTextRatio(sanitizedOcrText);
            console.log(`Document AI OCR completed: ${ocrText.length} characters`);
            
            if (ocrMeaningfulRatio > 0.8) {
              console.log("High OCR quality, using OCR text only");
              textContent = sanitizedOcrText;
            } else {
              console.log("Combining original text with OCR text");
              textContent = textContent.length > 0 ? 
                `${textContent}\n\n[Document AI OCR抽出テキスト]\n${sanitizedOcrText}` : 
                sanitizedOcrText;
            }
          } else {
            console.warn("Document AI OCR failed or no text detected");
          }
        } catch (ocrError) {
          console.error("Document AI OCR error:", ocrError);
          console.warn("Using pdfreader results only due to OCR error");
        }
      }

      if (textContent.length === 0) {
        throw new Error("No text could be extracted from the document");
      }

      docs = [{
        pageContent: textContent,
        metadata: { 
          source: fileName, 
          type: 'pdf',
          pages: numPages,
          totalPages: numPages,
          hasOCR: textContent.includes('[Document AI OCR抽出テキスト]'),
          processing_status: 'success'
        }
      }];

    } else if (['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'].includes(fileExtension)) {
      console.log(`Starting Office document processing for ${fileExtension}...`);
      
      // Create temporary file for officeparser
      const tmpDir = '/tmp';
      const tmpFileName = `${Date.now()}_${Math.random().toString(36).substring(2)}_${path.basename(fileName)}`;
      const tmpFilePath = path.join(tmpDir, tmpFileName);
      
      try {
        await fs.mkdir(tmpDir, { recursive: true });
        await fs.writeFile(tmpFilePath, fileBuffer);
        
        // 動的にofficeparserをインポート
        const officeParser = await import('officeparser');
        
        const data = await new Promise<string>((resolve, reject) => {
          officeParser.parseOffice(tmpFilePath, (content: string, err: Error | null) => {
            if (err) {
              console.error(`officeParser error for ${fileExtension}:`, err);
              return reject(err || new Error(`Unknown error in officeParser for ${fileExtension}`));
            }
            
            const validContent = content || '';
            console.log(`Office document processing completed: ${validContent.length} characters`);
            resolve(validContent);
          });
        });
        
        docs = [{
          pageContent: data,
          metadata: {
            source: fileName,
            type: fileExtension.substring(1),
          }
        }];
      } finally {
        // Clean up temporary file
        try {
          await fs.unlink(tmpFilePath);
        } catch (unlinkError) {
          console.warn(`Failed to delete temporary file ${tmpFilePath}:`, unlinkError);
        }
      }
    } else if (fileExtension === '.txt') {
      console.log("Processing text file...");
      
      try {
        // テキストファイルを文字列として読み込み
        const textContent = fileBuffer.toString('utf8');
        
        if (!textContent || textContent.trim().length === 0) {
          throw new Error("Text file is empty or contains no readable content");
        }
        
        console.log(`Text file processing completed: ${textContent.length} characters`);
        
        docs = [{
          pageContent: textContent,
          metadata: {
            source: fileName,
            type: 'text',
            pages: 1,
            totalPages: 1,
            processing_status: 'success'
          }
        }];
        
        numPages = 1;
        
      } catch (txtError) {
        console.error("Text file processing error:", txtError);
        throw new Error(`Text file processing failed: ${txtError instanceof Error ? txtError.message : 'Unknown error'}`);
      }
    } else {
      console.warn(`Unsupported file format: ${fileExtension}`);
      return null;
    }

    if (!docs || !Array.isArray(docs) || docs.length === 0) {
      console.error("Document processing returned invalid or empty result");
      throw new Error("Document processing returned invalid or empty result");
    }
    
    // Validate each document's pageContent
    for (let i = 0; i < docs.length; i++) {
      if (!docs[i] || typeof docs[i].pageContent !== 'string') {
        console.warn(`Document ${i} has invalid pageContent, replacing with empty string`);
        docs[i] = {
          pageContent: '',
          metadata: docs[i]?.metadata || { source: fileName, type: 'unknown' }
        };
      }
    }
    
    console.log(`File processing completed: generated ${docs.length} documents`);
    return { docs };
  } catch (error) {
    console.error("Error in downloadAndProcessFile:", error);
    throw error;
  }
}

// ドキュメント処理とストレージ
async function processAndStoreDocuments(
  processedFile: { docs: Array<{ pageContent: string; metadata: Record<string, unknown> }> } | null,
  sourceFileName: string,
  originalFileName: string | null,
  userId: string,
  supabaseClient: SupabaseClient,
  embeddingsClient: OpenAIEmbeddings,
  generativeAiClient: GoogleGenerativeAI,
  recordId: string
): Promise<{ manualId: string; summary: string | null; chunksCount: number } | null> {
  console.log(`[processAndStoreDocuments] Processing file: ${sourceFileName}, user: ${userId}`);
  
  if (!processedFile || !processedFile.docs || processedFile.docs.length === 0) {
    console.warn("Document is empty or not processed");
    return null;
  }

  const parsedDocs = processedFile.docs;
  const manualId: string = recordId; // Use the provided recordId

  try {
    console.log(`Using provided recordId: ${recordId}`);

    // Generate summary
    const firstDoc = parsedDocs[0];
    let summaryText: string | null = null;
    if (firstDoc && firstDoc.pageContent) {
      try {
        summaryText = await generateSummary(firstDoc.pageContent, generativeAiClient);
        console.log("Summary generated successfully");
      } catch (summaryError) {
        console.error("Error generating summary:", summaryError);
      }
    }

    // Update the existing manual record (no longer create new records)
    console.log(`Updating manual: ${manualId}`);
    
    const updateData: Record<string, unknown> = {
      original_file_name: originalFileName || sourceFileName.split('/').pop() || sourceFileName,
      metadata: { 
        totalPages: firstDoc?.metadata?.totalPages || 1,
        sourceType: firstDoc?.metadata?.type || path.extname(sourceFileName).substring(1) || 'unknown',
        lastProcessed: new Date().toISOString() 
      },
    };
    
    if (summaryText !== null) {
      updateData.summary = summaryText;
    }

    const { error: updateError } = await supabaseClient
      .from('manuals')
      .update(updateData)
      .eq('id', manualId);
      
    if (updateError) {
      console.error("Error updating manual:", updateError);
      throw updateError;
    }

    // Process chunks
    console.log("Processing chunks...");
    const chunks: ChunkObject[] = [];
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1500,
      chunkOverlap: 200,
    });

    for (let i = 0; i < parsedDocs.length; i++) {
      const pageContent = parsedDocs[i].pageContent || '';
      
      if (pageContent.length === 0) {
        console.warn(`Document ${i+1} has empty content, skipping`);
        continue;
      }

      let splitText: string[] = [];
      try {
        splitText = await splitter.splitText(pageContent);
        console.log(`Document ${i+1} split into ${splitText.length} chunks`);
      } catch (splitError) {
        console.error(`Error splitting document ${i+1}:`, splitError);
        throw new Error(`Failed to split document: ${splitError instanceof Error ? splitError.message : 'Unknown error'}`);
      }
      
      splitText.forEach((text: string, index: number) => {
        const sanitizedChunkText = sanitizeText(text);
        if (sanitizedChunkText.length > 0) {
          chunks.push({
            manual_id: manualId!,
            chunk_text: sanitizedChunkText,
            chunk_order: index + 1,
          });
        }
      });
    }

    if (chunks.length === 0) {
      console.log("No chunks generated, finishing process");
      return { manualId: manualId, summary: summaryText, chunksCount: 0 };
    }

    console.log(`Generating embeddings for ${chunks.length} chunks...`);
    const chunkTextsForEmbedding = chunks.map(c => c.chunk_text);
    
    try {
      const embeddingResult = await embeddingsClient.embedDocuments(chunkTextsForEmbedding);
      
      if (!embeddingResult || !Array.isArray(embeddingResult)) {
        throw new Error(`Embeddings API returned invalid result: ${typeof embeddingResult}`);
      }
      
      if (embeddingResult.length !== chunkTextsForEmbedding.length) {
        throw new Error(`Embeddings count mismatch: expected ${chunkTextsForEmbedding.length}, got ${embeddingResult.length}`);
      }

      // Delete existing chunks
      console.log("Deleting existing chunks...");
      const { error: deleteError } = await supabaseClient
        .from('manual_chunks')
        .delete()
        .eq('manual_id', manualId);
        
      if (deleteError) {
        console.error("Error deleting existing chunks:", deleteError);
      }

      // Insert new chunks with embeddings
      console.log("Inserting chunks with embeddings...");
      const chunksWithEmbeddings = chunks.map((chunk, index) => ({
        ...chunk,
        embedding: embeddingResult[index]
      }));

      const { error: insertChunksError } = await supabaseClient
        .from('manual_chunks')
        .insert(chunksWithEmbeddings);
        
      if (insertChunksError) {
        console.error("Error inserting chunks:", insertChunksError);
        throw insertChunksError;
      }

      console.log(`Successfully processed ${chunks.length} chunks`);
      return { 
        manualId: manualId, 
        summary: summaryText, 
        chunksCount: chunks.length 
      };

    } catch (embeddingError) {
      console.error("Error in embedding process:", embeddingError);
      throw new Error(`Failed to generate embeddings: ${embeddingError instanceof Error ? embeddingError.message : 'Unknown error'}`);
    }

  } catch (error) {
    console.error("Error in processAndStoreDocuments:", error);
    throw error;
  }
}

// OPTIONS request handler
export async function OPTIONS() {
  return new NextResponse("ok", { headers: corsHeaders });
}

// POST request handler
export async function POST(request: NextRequest) {
  console.log("[POST /api/process-pdf] Request received");

  try {
    // Environment variables check
    const requiredEnvVars = [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'OPENAI_API_KEY',
      'GEMINI_API_KEY'
    ];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        console.error(`Missing environment variable: ${envVar}`);
        return NextResponse.json(
          { error: `Server configuration error: ${envVar} is not set` },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // Initialize clients
    const supabaseClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY!,
    });

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

    // Get user ID from Authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid Authorization header' },
        { status: 401, headers: corsHeaders }
      );
    }

    let userId: string | null = null;
    try {
      const token = authHeader.replace('Bearer ', '');
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
      }
      const payload = JSON.parse(atob(parts[1]));
      userId = payload.user_metadata?.user_id || payload.sub || payload.user_id;
      
      if (!userId) {
        throw new Error('User ID not found in token');
      }
      console.log(`Authenticated user ID: ${userId}`);
    } catch (error) {
      console.error('Error processing Authorization token:', error);
      return NextResponse.json(
        { error: 'Failed to process Authorization token' },
        { status: 401, headers: corsHeaders }
      );
    }

    // Parse request body
    const body = await request.json();
    const fileName = body.fileName as string | null;
    const originalFileName = body.originalFileName as string | null;
    const recordId = body.recordId as string | null;

    if (!fileName) {
      return NextResponse.json(
        { error: "fileName is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!recordId) {
      return NextResponse.json(
        { error: "recordId is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    const effectiveOriginalFileName = originalFileName || fileName;
    console.log(`Processing file: ${fileName}, original: ${effectiveOriginalFileName}`);

    // Process file
    const processedFile = await downloadAndProcessFile(fileName, supabaseClient);
    if (!processedFile) {
      console.error(`File processing failed for: ${fileName}`);
      return NextResponse.json(
        { error: "File processing failed or unsupported file type" },
        { status: 500, headers: corsHeaders }
      );
    }

    // Store documents
    const storeResult = await processAndStoreDocuments(
      processedFile,
      fileName,
      effectiveOriginalFileName,
      userId,
      supabaseClient,
      embeddings,
      genAI,
      recordId
    );

    if (storeResult && storeResult.manualId) {
      console.log(`Processing completed successfully: ${fileName}`);
      return NextResponse.json({
        message: "Successfully processed",
        manual_id: storeResult.manualId,
        summary: storeResult.summary,
        chunks_count: storeResult.chunksCount
      }, {
        status: 200,
        headers: corsHeaders,
      });
    } else {
      console.error('Failed to process and store document');
      throw new Error("File processing failed: storage or embedding error occurred");
    }

  } catch (error) {
    console.error('Error in /api/process-pdf:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    
    return NextResponse.json(
      { error: `Processing failed: ${errorMessage}` },
      { status: 500, headers: corsHeaders }
    );
  }
} 