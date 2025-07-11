import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 日本語ファイル名対応: Base64エンコーディングを使用
function encodeFileName(name: string): string {
  try {
    const lastDotIndex = name.lastIndexOf('.');
    const fileNameOnly = lastDotIndex !== -1 ? name.substring(0, lastDotIndex) : name;
    const extension = lastDotIndex !== -1 ? name.substring(lastDotIndex) : '';
    
    // TextEncoderでUint8Array→base64url
    const utf8Bytes = new TextEncoder().encode(fileNameOnly);
    let binaryString = '';
    for (let i = 0; i < utf8Bytes.length; i++) {
      binaryString += String.fromCharCode(utf8Bytes[i]);
    }
    let base64Encoded = btoa(binaryString);
    base64Encoded = base64Encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${base64Encoded}${extension}`;
  } catch (error) {
    console.error('Error encoding filename:', error);
    // fallback: アルファベット・数字・ハイフン以外を_に
    const safeName = name.substring(0, name.lastIndexOf('.')).replace(/[^a-zA-Z0-9-]/g, '_');
    const ext = name.substring(name.lastIndexOf('.'));
    return `${safeName}${ext}`;
  }
}

// OPTIONS request handler
export async function OPTIONS() {
  return new NextResponse("ok", { headers: corsHeaders });
}

// POST request handler
export async function POST(request: NextRequest) {
  console.log("[POST /api/upload-manual] Request received");

  try {
    // Environment variables check
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      console.error('Missing Supabase environment variables');
      return NextResponse.json(
        { error: 'Missing Supabase environment variables' },
        { status: 500, headers: corsHeaders }
      );
    }

    // Check Authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid Authorization header' },
        { status: 401, headers: corsHeaders }
      );
    }

    // Extract user ID from Clerk JWT
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
      console.log(`[upload-manual] Authenticated user ID: ${userId}`);
    } catch (error) {
      console.error('[upload-manual] Error processing Authorization token:', error);
      return NextResponse.json(
        { error: 'Failed to process Authorization token' },
        { status: 401, headers: corsHeaders }
      );
    }

    // Parse multipart/form-data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const originalFileName = formData.get('originalFileName') as string;

    if (!file || !originalFileName) {
      return NextResponse.json(
        { error: 'Missing file or originalFileName' },
        { status: 400, headers: corsHeaders }
      );
    }

    console.log(`[upload-manual] Processing file: ${originalFileName}, size: ${file.size} bytes`);

    // Validate file size (e.g., max 50MB)
    const maxFileSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxFileSize) {
      return NextResponse.json(
        { error: 'File size exceeds 50MB limit' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];

    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Unsupported file type. Please upload PDF, DOC, DOCX, PPT, PPTX, XLS, or XLSX files.' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Encode filename for storage
    const encodedFileName = encodeFileName(originalFileName);
    console.log(`[upload-manual] Encoded filename: ${encodedFileName}`);

    // Initialize Supabase clients
    // 1. Storage client (service role for bypassing RLS)
    const storageClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false }
    });

    // 2. Database client (with Clerk JWT for user isolation)
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
      auth: { persistSession: false }
    });
    
    // Construct storage path: userId/encodedFileName
    const storagePath = `${userId}/${encodedFileName}`;
    console.log(`[upload-manual] Storage path: ${storagePath}`);

    // Convert file to ArrayBuffer for upload
    const fileBuffer = await file.arrayBuffer();

    // 1. Upload to Supabase Storage (bypassing RLS with service role)
    console.log('[upload-manual] Uploading to Supabase Storage...');
    const { error: uploadError } = await storageClient.storage
      .from('manuals')
      .upload(storagePath, fileBuffer, {
        upsert: true,
        contentType: file.type,
      });

    if (uploadError) {
      console.error('[upload-manual] Storage upload error:', uploadError);
      return NextResponse.json(
        { error: `Upload failed: ${uploadError.message}` },
        { status: 500, headers: corsHeaders }
      );
    }

    console.log('[upload-manual] File uploaded to storage successfully');

    // 2. Insert record to manuals table (with user isolation via Clerk JWT)
    console.log('[upload-manual] Creating database record...');
    const { error: dbError } = await supabase
      .from('manuals')
      .insert({
        file_name: encodedFileName,
        original_file_name: originalFileName,
        user_id: userId,
        summary: null,
        storage_path: `manuals/${storagePath}` // Full path with bucket name
        // uploaded_at, updated_at will use DB defaults
      });

    if (dbError) {
      console.error('[upload-manual] Database insert error:', dbError);
      
      // Try to clean up uploaded file if database insert fails
      try {
        await storageClient.storage
          .from('manuals')
          .remove([storagePath]);
        console.log('[upload-manual] Cleaned up uploaded file due to database error');
      } catch (cleanupError) {
        console.error('[upload-manual] Failed to cleanup uploaded file:', cleanupError);
      }

      return NextResponse.json(
        { error: `Database error: ${dbError.message}` },
        { status: 500, headers: corsHeaders }
      );
    }

    console.log('[upload-manual] Database record created successfully');

    // Return success response
    return NextResponse.json({
      message: 'File uploaded successfully',
      fileName: storagePath,
      originalFileName: originalFileName,
      encodedFileName: encodedFileName,
      fileSize: file.size,
      fileType: file.type
    }, {
      status: 200,
      headers: corsHeaders,
    });

  } catch (error) {
    console.error('[upload-manual] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    
    return NextResponse.json(
      { error: `Upload failed: ${errorMessage}` },
      { status: 500, headers: corsHeaders }
    );
  }
} 