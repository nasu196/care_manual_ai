import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

console.log('Create Memo Function Initialized')

serve(async (req: Request) => {
  try {
    // Supabaseクライアントを初期化
    // 環境変数からSupabaseのURLとanonキーを取得
    // 重要: これらの環境変数はSupabaseのプロジェクト設定で事前に設定しておく必要があります
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('SUPABASE_URL or SUPABASE_ANON_KEY is not set.')
      return new Response(
        JSON.stringify({ error: 'Missing Supabase environment variables' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const authHeader = req.headers.get('Authorization') // Authorizationヘッダーを取得
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: authHeader ? { Authorization: authHeader } : {}, // Authorizationヘッダーがあればセット、なければ空のオブジェクト
      },
    })

    // リクエストボディからデータを取得
    const { title, content, created_by, tags, is_important } = await req.json()

    // 簡単なバリデーション
    if (!title || !content) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: title and content' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // memosテーブルにデータを挿入
    const { data, error } = await supabase
      .from('memos')
      .insert([
        {
          title: title,
          content: content,
          created_by: created_by, // オプショナル
          tags: tags,             // オプショナル
          is_important: is_important === undefined ? false : is_important, // デフォルトはfalse
        },
      ])
      .select() // 挿入されたデータを返す

    if (error) {
      console.error('Error inserting memo:', error)
      throw error
    }

    console.log('Memo created successfully:', data)
    return new Response(JSON.stringify({ memo: data ? data[0] : null }), { // dataは配列で返ってくるので最初の要素を取得
      status: 201, // Created
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Unhandled error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})