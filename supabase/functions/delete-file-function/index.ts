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
    const clerkResponse = await fetch('https://api.clerk.dev/v1/verify_token', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('CLERK_SECRET_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: clerkToken }),
    });

    if (!clerkResponse.ok) {
      console.error('Clerk token verification failed:', await clerkResponse.text());
      return new Response(
        JSON.stringify({ error: 'Invalid authentication token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const clerkData = await clerkResponse.json();
    const userId = clerkData.sub;

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