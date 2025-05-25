import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

console.log('Create Memo Function Initialized')

serve(async (req: Request) => {
  // OPTIONSリクエストの処理 (CORSプリフライト)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

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
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const authHeader = req.headers.get('Authorization') // Authorizationヘッダーを取得
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: authHeader ? { Authorization: authHeader } : {}, // Authorizationヘッダーがあればセット、なければ空のオブジェクト
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

    // リクエストボディからデータを取得
    const { 
      title, 
      content, 
      tags, 
      is_important,
      is_ai_generated,       // ★ 追加
      ai_generation_sources  // ★ 追加
    } = await req.json()

    // 簡単なバリデーション
    if (!title || !content) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: title and content' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // memosテーブルにデータを挿入（created_byは認証されたユーザーIDを自動設定）
    const { data, error } = await supabase
      .from('memos')
      .insert([
        {
          title: title,
          content: content,
          created_by: user.id, // 認証されたユーザーIDを自動設定
          tags: tags,             // オプショナル
          is_important: is_important === undefined ? false : is_important, // デフォルトはfalse
          is_ai_generated: is_ai_generated === undefined ? false : is_ai_generated, // ★ 追加 (デフォルトfalse)
          ai_generation_sources: ai_generation_sources, // ★ 追加 (null許容ならそのままでOK)
        },
      ])
      .select() // 挿入されたデータを返す

    if (error) {
      console.error('Error inserting memo:', error)
      // エラーレスポンスにもCORSヘッダーを含めることが推奨される
      return new Response(JSON.stringify({ error: error.message || 'Failed to insert memo' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log('Memo created successfully for user:', user.id, data)
    return new Response(JSON.stringify({ memo: data ? data[0] : null }), {
      status: 201, // Created
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) { // catchブロックのエラー型をanyに一旦変更 (Deno Deployの挙動に合わせる場合がある)
    console.error('Unhandled error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})