// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts"; // dotenvモジュールをインポート

// .env から環境変数をロード
// .env が存在しない場合でもエラーにならないように try-catch を使うこともできます
// もしくは、環境変数が直接設定されている場合はこの処理は不要です。
// しかし、ローカル開発では .env を使うのが一般的です。
await load({ export: true, envPath: ".env" }); // .env を指定

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

    // Authorizationヘッダーを取得してSupabaseクライアントに渡す
    const authHeader = req.headers.get('Authorization')
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: authHeader ? { Authorization: authHeader } : {},
      },
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

    // ユーザーIDでフィルタリングしてmemosテーブルからデータを取得
    const { data, error } = await supabase
      .from('memos')
      .select('*')
      .eq('created_by', user.id) // ユーザーIDでフィルタリング
      .order('created_at', { ascending: false }) // 作成日時の降順で取得 (新しいものが先頭)

    if (error) {
      console.error('Error fetching memos:', error)
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Found ${data?.length || 0} memos for user ${user.id}`)

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

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/list-memos' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
