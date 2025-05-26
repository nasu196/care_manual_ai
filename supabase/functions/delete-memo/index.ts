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

console.log("Delete Memo Function Initialized")

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
    
    const authHeader = req.headers.get('Authorization')
    
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Supabaseクライアントを作成（Clerk統合を活用）
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

    // URLからメモのIDを取得（従来の方法）
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const memoIdFromPath = pathParts[pathParts.length - 1]

    // ボディからメモのIDを取得（新しい方法：supabase.functions.invoke対応）
    let memoIdFromBody = null;
    try {
      const body = await req.json();
      memoIdFromBody = body?.id;
    } catch (e) {
      // ボディがない、またはJSONパースに失敗した場合は無視
      console.log('No valid JSON body found, checking URL path for ID');
    }

    // IDの取得順序：ボディ > URLパス
    const memoId = memoIdFromBody || (memoIdFromPath !== 'delete-memo' ? memoIdFromPath : null);

    if (!memoId) {
      return new Response(
        JSON.stringify({ error: 'Memo ID is required in the request body or URL path' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    console.log(`Attempting to delete memo with ID: ${memoId}`)

    // データベースからメモを削除（RLSポリシーがユーザー分離を処理）
    const { data, error } = await supabase
      .from('memos')
      .delete()
      .eq('id', memoId)
      .select() // 削除されたデータを取得
      
    if (error) {
      console.error(`Error deleting memo with ID ${memoId}:`, error)
      // エラーの種類によってより詳細なハンドリング
      if (error.code === 'PGRST204' || (error.details && error.details.includes("0 rows"))) {
         return new Response(
            JSON.stringify({ error: `Memo with ID ${memoId} not found or access denied` }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      return new Response(
        JSON.stringify({ error: `Failed to delete memo: ${error.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 削除成功の検証 - data配列が空でないことを確認
    if (!data || data.length === 0) {
      console.warn(`No memo found with ID ${memoId} for deletion`)
      return new Response(
        JSON.stringify({ error: `Memo with ID ${memoId} not found or access denied` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Successfully deleted memo with ID ${memoId}:`, data[0]);

    return new Response(
      JSON.stringify({ message: 'Memo deleted successfully', deleted_memo: data[0] }), 
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        status: 200, 
      }
    )

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

  curl -i --location --request DELETE 'http://127.0.0.1:54321/functions/v1/delete-memo/{memo_id}' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

*/
