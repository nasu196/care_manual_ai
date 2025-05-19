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

Deno.serve(async (req) => {
  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('SUPABASE_URL or SUPABASE_ANON_KEY is not set.')
      return new Response(
        JSON.stringify({ error: 'Missing Supabase environment variables' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    // URLからメモのIDを取得
    // 例: /functions/v1/get-memo-by-id/your-memo-id
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const memoId = pathParts[pathParts.length - 1] // パスの最後の部分をIDとして取得

    if (!memoId) {
      return new Response(
        JSON.stringify({ error: 'Memo ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // memosテーブルから指定されたIDのデータを取得
    const { data, error } = await supabase
      .from('memos')
      .select('*')
      .eq('id', memoId) // 'id' カラムが memoId と一致するものを検索
      .single() // 結果が1件であることを期待 (複数あればエラー、なければnull)

    if (error) {
      console.error(`Error fetching memo with ID ${memoId}:`, error)
      // findUnique or .single() でデータが見つからない場合も error オブジェクトは null ではないが、
      // data が null になるので、それで判定する
      if (error.code === 'PGRST116') { // PostgRESTのエラーコードで "Query returned no rows" を示す (要確認)
        return new Response(
          JSON.stringify({ error: `Memo with ID ${memoId} not found` }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    if (!data) { // .single() でデータが見つからなかった場合
        return new Response(
            JSON.stringify({ error: `Memo with ID ${memoId} not found` }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

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

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/get-memo-by-id' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
