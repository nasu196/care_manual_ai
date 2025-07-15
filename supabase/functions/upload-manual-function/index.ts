import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// 日本語ファイル名対応: Base64エンコーディングを使用
function encodeFileName(name: string): string {
  try {
    const lastDotIndex = name.lastIndexOf('.')
    const fileNameOnly = lastDotIndex !== -1 ? name.substring(0, lastDotIndex) : name
    const extension = lastDotIndex !== -1 ? name.substring(lastDotIndex) : ''
    // Deno: TextEncoderでUint8Array→base64url
    const utf8Bytes = new TextEncoder().encode(fileNameOnly)
    let binaryString = ''
    for (let i = 0; i < utf8Bytes.length; i++) {
      binaryString += String.fromCharCode(utf8Bytes[i])
    }
    let base64Encoded = btoa(binaryString)
    base64Encoded = base64Encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    return `${base64Encoded}${extension}`
  } catch (error) {
    // fallback: アルファベット・数字・ハイフン以外を_に
    const safeName = name.substring(0, name.lastIndexOf('.')).replace(/[^a-zA-Z0-9-]/g, '_')
    const ext = name.substring(name.lastIndexOf('.'))
    return `${safeName}${ext}`
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return new Response(JSON.stringify({ error: 'Missing Supabase environment variables' }), { status: 500, headers: corsHeaders })
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), { status: 401, headers: corsHeaders })
    }

    // Clerk JWTからユーザーIDを取得
    let userId: string | null = null;
    try {
      const token = authHeader.replace('Bearer ', '');
      const parts = token.split('.');
      if (parts.length !== 3) {
        return new Response(JSON.stringify({ error: 'Invalid JWT format' }), { status: 401, headers: corsHeaders });
      }
      const payload = JSON.parse(atob(parts[1]));
      userId = payload.user_metadata?.user_id || payload.sub || payload.user_id;
      
      if (!userId) {
        return new Response(JSON.stringify({ error: 'User ID not found in token' }), { status: 401, headers: corsHeaders });
      }
      console.log(`[upload-manual-function] Authenticated user ID: ${userId}`);
    } catch (error) {
      console.error('[upload-manual-function] Error processing Authorization token:', error);
      return new Response(JSON.stringify({ error: 'Failed to process Authorization token' }), { status: 401, headers: corsHeaders });
    }

    // multipart/form-dataでファイルを受け取る
    const formData = await req.formData()
    const file = formData.get('file') as File
    const originalFileName = formData.get('originalFileName') as string

    if (!file || !originalFileName) {
      return new Response(JSON.stringify({ error: 'Missing file or originalFileName' }), { status: 400, headers: corsHeaders })
    }

    // ファイル形式チェック
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'
    ];

    if (!allowedTypes.includes(file.type)) {
      return new Response(JSON.stringify({ 
        error: 'Unsupported file type. Please upload PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, or TXT files.' 
      }), { status: 400, headers: corsHeaders });
    }

    // ファイル名エンコード（フロントと同じロジック）
    const encodedFileName = encodeFileName(originalFileName)

    // 1. Storage用クライアント（サービスロール）
    const storageClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false }
    });

    // 2. manuals用クライアント（Clerk JWT）
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
      auth: { persistSession: false }
    });
    
    // Storageパスを userId/encodedFileName 形式で構築
    const storagePath = `${userId}/${encodedFileName}`;

    // 1. Storageにファイルをアップロード（サービスロールでRLSバイパス）
    const { error: uploadError } = await storageClient.storage.from('manuals').upload(storagePath, file.stream(), {
      upsert: true,
      contentType: file.type,
    })

    if (uploadError) {
      console.error('[upload-manual-function] Storage upload error:', uploadError);
      return new Response(JSON.stringify({ error: uploadError.message }), { status: 500, headers: corsHeaders })
    }

    // 2. manualsテーブルにレコードを挿入（Clerk JWTでユーザー分離）
    const { data: newRecord, error: dbError } = await supabase
      .from('manuals')
      .insert({
        file_name: encodedFileName,
        original_file_name: originalFileName,
        user_id: userId,
        summary: null,
        storage_path: `manuals/${storagePath}` // バケット名を含めたフルパス
        // uploaded_at, updated_atはDBのデフォルト値に任せる
      })
      .select('id')
      .single();

    if (dbError || !newRecord || !newRecord.id) {
      console.error('[upload-manual-function] Database insert error:', dbError);
      // ストレージからファイルを削除（ロールバック）
      await storageClient.storage.from('manuals').remove([storagePath]);
      return new Response(JSON.stringify({ error: `Database insert failed: ${dbError?.message || 'Failed to create record'}` }), { status: 500, headers: corsHeaders })
    }

    console.log(`[upload-manual-function] Successfully uploaded and registered: ${storagePath}, recordId: ${newRecord.id}`);

    return new Response(JSON.stringify({ 
      message: 'Upload successful', 
      fileName: encodedFileName, 
      originalFileName: originalFileName,
      storagePath: storagePath,
      recordId: newRecord.id,
      fileSize: file.size,
      fileType: file.type
    }), {
      status: 201,
      headers: corsHeaders,
    })
  } catch (e) {
    console.error('[upload-manual-function] Unexpected error:', e);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500, headers: corsHeaders })
  }
}) 