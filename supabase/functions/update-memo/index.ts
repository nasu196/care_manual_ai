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
    // リクエストメソッドがPUTであるか確認
    if (req.method !== 'PUT') {
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
    
    // create-memo と同様に Authorization ヘッダーからユーザー情報を取得することを想定
    // もし不要であれば、この部分は削除またはコメントアウトし、supabaseクライアント初期化もシンプルにする
    const authHeader = req.headers.get('Authorization')
    let createdBy = 'anonymous' // デフォルトは匿名
    if (authHeader) {
        // ここでJWTトークンをデコードしてユーザーIDなどを取得する処理を本来は入れる
        // 今回は簡略化のため、Authorizationヘッダーがあれば 'authenticated_user' とする
        // 実際の運用では、SupabaseのAuth機能と連携してユーザーを特定する
        try {
            // 例: const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
            // if (user) createdBy = user.id;
            // 簡単な例として、ヘッダーがあれば固定の文字列を設定
             if (authHeader.startsWith('Bearer ')) { // 簡単なチェック
                createdBy = 'authenticated_user_placeholder'; // 本来はトークンから取得
             }
        } catch (e) {
            console.warn("Failed to parse Authorization header or get user:", e);
            // トークンが無効でも処理を続ける場合もあるが、ここではエラーとせず匿名ユーザー扱いにする
        }
    }


    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: authHeader ? { Authorization: authHeader } : {} },
    })

    // URLからメモのIDを取得
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const memoId = pathParts[pathParts.length - 1]

    if (!memoId) {
      return new Response(
        JSON.stringify({ error: 'Memo ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // リクエストボディから更新データを取得
    let updateData: { title?: string; content?: string } = {};
    try {
      const buffer = await req.arrayBuffer(); // バイト配列として読み込む
      
      // ★★★ デバッグログ追加: 受信したバイト列を16進数で表示 ★★★
      let hexString = "";
      const tempByteArrayView = new Uint8Array(buffer); // bufferをUint8Arrayとして見る
      for (let i = 0; i < Math.min(tempByteArrayView.byteLength, 100); i++) { // 長すぎる場合があるので先頭100バイト程度に制限
        hexString += tempByteArrayView[i].toString(16).padStart(2, '0') + " ";
      }
      console.log("Received raw bytes (hex, first 100 bytes):", hexString.toUpperCase().trim());
      // ★★★ ここまで ★★★

      const decoder = new TextDecoder('utf-8', { fatal: true }); // fatal: true を追加してデコードエラーを厳密に検知
      let rawBody = "";
      try {
        rawBody = decoder.decode(buffer);   
      } catch (decodeError) {
        console.error("UTF-8 decoding failed:", decodeError);
        // デコード失敗時のためのフォールバックやエラーレスポンス
        return new Response(
          JSON.stringify({ error: 'Failed to decode request body as UTF-8' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log("Decoded rawBody:", rawBody); // デバッグのためコメント解除
      const body = JSON.parse(rawBody); // rawBodyが空や不正な場合にエラーになる可能性

      // 更新可能なフィールドを指定 (想定外のフィールドは無視)
      if (body.title !== undefined) updateData.title = body.title;
      if (body.content !== undefined) updateData.content = body.content;
      // created_by は更新しないので含めない
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (Object.keys(updateData).length === 0) {
      return new Response(
        JSON.stringify({ error: 'No update fields provided (title or content)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    // データベースのメモを更新
    // .eq('created_by', createdBy) のような条件を追加すれば、作成者のみが更新できるように制限できる
    // 今回は created_by のチェックは省略（誰でも更新可能）
    const { data, error } = await supabase
      .from('memos')
      .update(updateData)
      .eq('id', memoId)
      .select() // 更新後のデータを返す
      .single(); // 更新対象が1件であることを期待

    console.log(`Update attempt for ID ${memoId}:`, { updateDataSent: updateData, responseData: data, responseError: error });

    if (error) {
      console.error(`Error updating memo with ID ${memoId}:`, error)
      if (error.code === 'PGRST116' || (error.details && error.details.includes("0 rows"))) { // "Query returned no rows" or similar
        return new Response(
          JSON.stringify({ error: `Memo with ID ${memoId} not found or no changes made` }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    if (!data) { // .single() でデータが見つからなかった場合 (通常はerrorで補足されるはずだが念のため)
        return new Response(
            JSON.stringify({ error: `Memo with ID ${memoId} not found after update attempt` }),
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

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/update-memo' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
