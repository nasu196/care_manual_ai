// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts"; // dotenvをインポート

// .envから環境変数をロード (delete-memo/.env を期待)
// 必要に応じてパスを調整してください (例: '../.env' で functions/.env を参照)
await load({ export: true, envPath: ".env" });

console.log("Hello from delete-memo Function!")

Deno.serve(async (req) => {
  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // リクエストメソッドがDELETEであるか確認
    if (req.method !== 'DELETE') {
      return new Response(
        JSON.stringify({ error: 'Method Not Allowed' }),
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
    
    // 認証ヘッダーの基本的なチェック (他の関数と同様)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn("Missing or invalid Authorization header.");
        return new Response(
            JSON.stringify({ error: 'Unauthorized: Missing or invalid token' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } }, // ヘッダーを渡す
    })

    // URLからメモのIDを取得
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const memoId = pathParts[pathParts.length - 1] // functions/v1/delete-memo/{id} の {id} を想定

    if (!memoId) {
      return new Response(
        JSON.stringify({ error: 'Memo ID is required in the URL path' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    console.log(`Attempting to delete memo with ID: ${memoId}`)

    // データベースからメモを削除
    // .eq('created_by', userId) のような条件を追加すれば、作成者のみが削除できるように制限できる
    // ここではまずIDのみで削除
    const { error } = await supabase // _ を削除しました
      .from('memos')
      .delete()
      .eq('id', memoId)
      // .select() // deleteの場合、デフォルトでは削除されたデータは返らない。もし必要なら .select().single() をつけるが、通常は不要。
      // .single() // 削除対象が必ず1件である、または1件も見つからない場合にエラーとしたい場合

    if (error) {
      console.error(`Error deleting memo with ID ${memoId}:`, error)
      // エラーの種類によってより詳細なハンドリングも可能
      // 例えば 'PGRST204' (No Content) は削除対象が見つからなかった場合など
      if (error.code === 'PGRST204' || (error.details && error.details.includes("0 rows"))) {
         return new Response(
            JSON.stringify({ error: `Memo with ID ${memoId} not found.` }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      return new Response(
        JSON.stringify({ error: `Failed to delete memo: ${error.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // PostgreSQLのDELETEは成功してもデフォルトでは何も返さない (countもnullになることがある)
    // Supabase JS Client v2 の delete() の挙動として、もしeqでマッチする行がなくてもエラーにならない場合がある。
    // そのため、実際に削除されたかどうかの厳密な確認は難しい場合がある。
    // 通常はエラーがなければ成功とみなし、204 No Content を返すのが一般的。

    console.log(`Memo with ID ${memoId} processed for deletion.`);

    return new Response(null, { // 成功時はボディなし、ステータス 204
      headers: { ...corsHeaders }, 
      status: 204, 
    })

  } catch (e) {
    console.error('An unexpected error occurred in delete-memo:', e)
    return new Response(
      JSON.stringify({ error: 'Internal Server Error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/delete-memo' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
