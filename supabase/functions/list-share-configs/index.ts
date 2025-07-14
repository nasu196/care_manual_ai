// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

console.log("List Share Configs Function Initialized")

Deno.serve(async (req) => {
  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // GETメソッドのみを受け付ける
  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed. Use GET.' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    console.log('Request received:', req.method, req.url);
    console.log('Request headers:', JSON.stringify(Object.fromEntries(req.headers.entries())));

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

    // JWTからユーザーIDを取得（list-memosと同じ方式だが専用）
    let userId;
    try {
      const token = authHeader.replace('Bearer ', '');
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
      }
      const payload = JSON.parse(atob(parts[1]));
      console.log('[list-share-configs] Decoded Clerk JWT Payload:', payload);

      userId = payload.user_metadata?.user_id || payload.sub || payload.user_id;

      if (!userId) {
        console.error('[list-share-configs] User ID not found in Clerk JWT payload.');
        return new Response(
          JSON.stringify({ error: 'User ID not found in token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log(`[list-share-configs] Authenticated user ID from Clerk JWT: ${userId}`);
    } catch (e) {
      console.error('[list-share-configs] Error decoding JWT:', e);
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Supabaseクライアントを作成（list-memosと同じ方式）
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

    // share_configsテーブルからデータを取得（RLSポリシーとAPI側でユーザー分離）
    console.log(`Fetching share configs for user: ${userId}`);
    
    // デバッグ: テーブル構造を確認
    const { data: tableInfo, error: tableError } = await supabase
      .from('share_configs')
      .select('*')
      .limit(1);
    
    console.log('[DEBUG] Table info query result:', { tableInfo, tableError });
    
    const { data: shareConfigs, error: shareError } = await supabase
      .from('share_configs')
      .select('id, selected_record_ids, created_at, expires_at, is_active')
      .eq('user_id', userId)  // 重要: このユーザーのもののみ
      .eq('is_active', true)   // アクティブなもののみ
      .order('created_at', { ascending: false })  // 新しい順

    if (shareError) {
      console.error('Error fetching share configs:', shareError)
      return new Response(
        JSON.stringify({ error: shareError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Found ${shareConfigs?.length || 0} share configs for user ${userId}`)

    return new Response(
      JSON.stringify({
        shareConfigs: shareConfigs || []
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (e) {
    console.error('An unexpected error occurred:', e)
    return new Response(
      JSON.stringify({ error: 'Internal Server Error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request GET 'http://127.0.0.1:54321/functions/v1/list-share-configs' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json'

*/ 