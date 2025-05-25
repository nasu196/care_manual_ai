// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";

// .env から環境変数をロード
await load({ export: true, envPath: ".env" });

console.log("Hello from Functions!")

// Deno.serve の外側にある可能性のある誤ったログ行を削除 (もしあれば)
// console.log("Request Headers:", Object.fromEntries(req.headers.entries())); 

Deno.serve(async (req) => {
  // 正しい位置にログ行を配置 (もし重複していなければ、この行が有効になる)
  console.log("Request Headers:", Object.fromEntries(req.headers.entries()));

  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // リクエストメソッドがPOSTであるか確認
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method Not Allowed. Please use POST.' }),
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
    
    // Authorizationヘッダーを取得してSupabaseクライアントに渡す
    const authHeader = req.headers.get('Authorization')
    console.log('[update-memo] Received Authorization Header:', authHeader);
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: authHeader ? { Authorization: authHeader } : {} },
    })

    // JWTトークンからユーザー情報を取得
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    if (userError || !user) {
      console.error('Error getting user or user not authenticated:', userError)
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Authenticated user ID:', user.id)

    // リクエストボディを解析
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    const memoId = body.id;
    const titleToUpdate = body.title;
    const contentToUpdate = body.content;
    const isImportantToUpdate = body.is_important;

    if (!memoId) {
      return new Response(
        JSON.stringify({ error: 'Memo ID is required in the request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 更新データを準備
    let updateData: { title?: string; content?: string; is_important?: boolean } = {};
    if (titleToUpdate !== undefined) updateData.title = titleToUpdate;
    if (contentToUpdate !== undefined) updateData.content = contentToUpdate;
    if (isImportantToUpdate !== undefined) updateData.is_important = isImportantToUpdate;

    // データベースのメモを更新（ユーザーIDでフィルタリング）
    const { data, error } = await supabase
      .from('memos')
      .update(updateData)
      .eq('id', memoId)
      .eq('created_by', user.id) // ユーザーIDでフィルタリング（アクセス制御）
      .select() // 更新後のデータを返す
      .single(); // 更新対象が1件であることを期待

    console.log(`Update attempt for ID ${memoId} by user ${user.id}:`, { updateDataSent: updateData, responseData: data, responseError: error });

    if (error) {
      console.error(`Error updating memo with ID ${memoId} for user ${user.id}:`, error)
      if (error.code === 'PGRST116' || (error.details && error.details.includes("0 rows"))) {
        return new Response(
          JSON.stringify({ error: `Memo with ID ${memoId} not found or access denied` }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    if (!data) {
        return new Response(
            JSON.stringify({ error: `Memo with ID ${memoId} not found or access denied` }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

    console.log(`Successfully updated memo ${memoId} for user ${user.id}`)

    return new Response(
      JSON.stringify(data),
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

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/update-memo' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"id":"memo-id","title":"Updated Title","content":"Updated Content"}'

*/
