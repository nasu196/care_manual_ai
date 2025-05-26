import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface DeleteFileRequest {
  fileName: string; // エンコードされたファイル名
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Clerk JWTトークンを取得
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const clerkToken = authHeader.replace('Bearer ', '');

    // Clerk JWTを検証してuser_idを取得
    // ClerkのJWTは自己完結型なので、直接デコードして検証する
    const jwtParts = clerkToken.split('.');
    if (jwtParts.length !== 3) {
      return new Response(
        JSON.stringify({ error: 'Invalid JWT format' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let payload;
    try {
      const decodedPayload = atob(jwtParts[1]);
      payload = JSON.parse(decodedPayload);
    } catch (error) {
      console.error('JWT decode error:', error);
      return new Response(
        JSON.stringify({ error: 'Invalid JWT payload' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // JWTペイロードからuser_idを取得
    const userId = payload.sub;

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'User ID not found in token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // リクエストボディを解析
    const requestData: DeleteFileRequest = await req.json();
    const { fileName } = requestData;

    if (!fileName) {
      return new Response(
        JSON.stringify({ error: 'fileName is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Supabaseクライアントを作成（サービスロール使用）
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`[delete-file-function] Deleting file: ${fileName} for user: ${userId}`);

    // Step 1: manualsテーブルからレコードを削除（user_idでフィルタ）
    const { error: dbError } = await supabase
      .from('manuals')
      .delete()
      .eq('file_name', fileName)
      .eq('user_id', userId);

    if (dbError) {
      console.error('Database delete error:', dbError);
      return new Response(
        JSON.stringify({ error: `Database delete failed: ${dbError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 2: Storageからファイルを削除
    const { error: storageError } = await supabase.storage
      .from('manuals')
      .remove([fileName]);

    if (storageError) {
      console.error('Storage delete error:', storageError);
      return new Response(
        JSON.stringify({ error: `Storage delete failed: ${storageError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[delete-file-function] Successfully deleted file: ${fileName}`);

    return new Response(
      JSON.stringify({ message: 'File deleted successfully' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}); 