import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('Received request headers for create-share-config:', JSON.stringify(Object.fromEntries(req.headers.entries())));
    
    // リクエストボディを解析
    const { selectedSourceNames } = await req.json()

    // Authorizationヘッダーを取得
    const authHeader = req.headers.get('Authorization')
    
    if (!authHeader) {
      console.error('Authorization header is missing')
      return new Response(
        JSON.stringify({ error: 'No Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // JWTからユーザーIDを取得
    let userId;
    try {
      const token = authHeader.replace('Bearer ', '');
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
      }
      const payload = JSON.parse(atob(parts[1]));
      console.log('[create-share-config][Auth] Decoded Clerk JWT Payload:', payload);

      userId = payload.user_metadata?.user_id || payload.sub || payload.user_id;

      if (!userId) {
        console.error('[create-share-config][Auth] User ID not found in Clerk JWT payload.');
        return new Response(
          JSON.stringify({ error: 'User ID not found in token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log(`[create-share-config][Auth] Authenticated user ID from Clerk JWT: ${userId}`);
    } catch (e) {
      console.error('[create-share-config][Auth] Error decoding JWT:', e);
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Processing request for user:', userId)
    console.log('Selected sources:', selectedSourceNames)

    // Supabaseクライアントを初期化（Clerk統合を活用）
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    
    console.log('Supabase URL:', supabaseUrl)
    console.log('Supabase Anon Key available:', !!supabaseAnonKey)
    
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

    // 共有IDを生成（UUID v4）
    const shareId = crypto.randomUUID()

    // 共有設定をデータベースに保存（RLSポリシーがauth.jwt()->'user_metadata'->>'user_id'でユーザーを識別）
    const { error: insertError } = await supabase
      .from('share_configs')
      .insert({
        id: shareId,
        user_id: userId,
        selected_source_names: selectedSourceNames,
        created_at: new Date().toISOString(),
        // expires_at: 永続的に有効なのでNULLのまま
      })

    if (insertError) {
      console.error('Error inserting share config:', insertError)
      return new Response(
        JSON.stringify({ error: 'Failed to create share configuration' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Share config created successfully:', shareId)
    return new Response(
      JSON.stringify({ shareId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in create-share-config function:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}) 