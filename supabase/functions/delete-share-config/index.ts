// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

console.log("Delete Share Config Function Initialized")

Deno.serve(async (req) => {
  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // リクエストメソッドがDELETEであるか確認
    if (req.method !== 'DELETE') {
      return new Response(
        JSON.stringify({ error: 'Method Not Allowed. Use DELETE.' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('SUPABASE_URL or SUPABASE_ANON_KEY is not set.')
      return new Response(
        JSON.stringify({ error: 'Missing Supabase environment variables' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    const authHeader = req.headers.get('Authorization')
    
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // JWTからユーザーIDを取得（delete-memoと同じ方式）
    let userId;
    try {
      const token = authHeader.replace('Bearer ', '');
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
      }
      const payload = JSON.parse(atob(parts[1]));
      console.log('[delete-share-config][Auth] Decoded Clerk JWT Payload:', payload);

      userId = payload.user_metadata?.user_id || payload.sub || payload.user_id;

      if (!userId) {
        console.error('[delete-share-config][Auth] User ID not found in Clerk JWT payload.');
        return new Response(
          JSON.stringify({ error: 'User ID not found in token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log(`[delete-share-config][Auth] Authenticated user ID from Clerk JWT: ${userId}`);
    } catch (e) {
      console.error('[delete-share-config][Auth] Error decoding JWT:', e);
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Supabaseクライアントを作成（delete-memoと同じ方式）
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
      auth: {
        persistSession: false,
      },
    })

    // URLからshare config IDを取得（delete-memoと同じ方法）
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const shareIdFromPath = pathParts[pathParts.length - 1]

    // ボディからshare config IDを取得（delete-memoと同じ方法）
    let shareIdFromBody = null;
    try {
      const body = await req.json();
      shareIdFromBody = body?.id;
    } catch (e) {
      console.log('No valid JSON body found, checking URL path for ID');
    }

    // IDの取得順序：ボディ > URLパス
    const shareId = shareIdFromBody || (shareIdFromPath !== 'delete-share-config' ? shareIdFromPath : null);

    if (!shareId) {
      return new Response(
        JSON.stringify({ error: 'Share config ID is required in the request body or URL path' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    console.log(`Attempting to delete share config with ID: ${shareId} for user: ${userId}`)

    // セキュリティチェック: 指定されたshare_configがユーザーのものかを確認
    const { data: existingConfig, error: fetchError } = await supabase
      .from('share_configs')
      .select('id, user_id, is_active')
      .eq('id', shareId)
      .eq('user_id', userId)  // 重要: このユーザーのもののみ
      .single()

    if (fetchError || !existingConfig) {
      console.error(`Share config not found or access denied for ID ${shareId}:`, fetchError)
      return new Response(
        JSON.stringify({ error: `Share config with ID ${shareId} not found or access denied` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 論理削除を実行（is_active = false に設定）
    const { data, error } = await supabase
      .from('share_configs')
      .update({ is_active: false })
      .eq('id', shareId)
      .eq('user_id', userId)  // 二重チェック: このユーザーのもののみ
      .select() // 更新されたデータを取得
      
    if (error) {
      console.error(`Error deleting share config with ID ${shareId}:`, error)
      return new Response(
        JSON.stringify({ error: `Failed to delete share config: ${error.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 削除成功の検証
    if (!data || data.length === 0) {
      console.warn(`No share config found with ID ${shareId} for deletion`)
      return new Response(
        JSON.stringify({ error: `Share config with ID ${shareId} not found or access denied` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Successfully deleted share config with ID ${shareId} for user ${userId}:`, data[0]);

    return new Response(
      JSON.stringify({ message: 'Share configuration deleted successfully', deleted_share_config: data[0] }), 
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        status: 200, 
      }
    )

  } catch (e) {
    console.error('An unexpected error occurred in delete-share-config:', e)
    return new Response(
        JSON.stringify({ error: 'Internal Server Error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request DELETE 'http://127.0.0.1:54321/functions/v1/delete-share-config/{share_config_id}' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

*/ 