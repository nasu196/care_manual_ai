import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import * as jose from 'https://deno.land/x/jose@v4.14.4/index.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    console.log('Auth header:', authHeader)

    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const token = authHeader.replace('Bearer ', '')
    
    // JWTをデコード（検証なし）
    const parts = token.split('.')
    const header = JSON.parse(atob(parts[0]))
    const payload = JSON.parse(atob(parts[1]))
    
    console.log('JWT Header:', header)
    console.log('JWT Payload:', payload)

    // Supabase環境変数を取得
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const jwtSecret = Deno.env.get('SUPABASE_JWT_SECRET')

    console.log('JWT Secret available:', !!jwtSecret)

    // 手動でJWT検証を試みる
    if (jwtSecret) {
      try {
        const secret = new TextEncoder().encode(jwtSecret)
        const { payload: verifiedPayload } = await jose.jwtVerify(token, secret)
        console.log('Manual JWT verification SUCCESS:', verifiedPayload)
      } catch (error: any) {
        console.error('Manual JWT verification FAILED:', error.message)
      }
    }

    // Supabaseクライアントでの検証
    const supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
      global: {
        headers: { Authorization: authHeader },
      },
    })

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    return new Response(
      JSON.stringify({
        jwtHeader: header,
        jwtPayload: payload,
        supabaseAuthResult: {
          user: user,
          error: userError
        },
        debug: {
          hasJwtSecret: !!jwtSecret,
          supabaseUrl: !!supabaseUrl,
          supabaseAnonKey: !!supabaseAnonKey
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (e: any) {
    console.error('Error:', e)
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}) 