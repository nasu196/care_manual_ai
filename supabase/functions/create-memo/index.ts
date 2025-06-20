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
    console.log('Received request headers for create-memo:', JSON.stringify(Object.fromEntries(req.headers.entries())));
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('SUPABASE_URL or SUPABASE_ANON_KEY is not set.')
      return new Response(
        JSON.stringify({ error: 'Missing Supabase environment variables' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Authorizationヘッダーを取得
    const authHeader = req.headers.get('Authorization')
    
    if (!authHeader) {
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
      console.log('[create-memo][Auth] Decoded Clerk JWT Payload:', payload);

      userId = payload.user_metadata?.user_id || payload.sub || payload.user_id;

      if (!userId) {
        console.error('[create-memo][Auth] User ID not found in Clerk JWT payload.');
        return new Response(
          JSON.stringify({ error: 'User ID not found in token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log(`[create-memo][Auth] Authenticated user ID from Clerk JWT: ${userId}`);
    } catch (e) {
      console.error('[create-memo][Auth] Error decoding JWT:', e);
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // リクエストボディを取得
    let rawBody;
    try {
      rawBody = await req.text();
      console.log('Raw request body for create-memo:', rawBody);
    } catch (textError) {
      console.error('Error reading request body as text:', textError);
      const errorMessage = textError instanceof Error ? textError.message : 'Unknown error during req.text()';
      return new Response(
        JSON.stringify({ error: 'Failed to read request body', details: errorMessage }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { title, content, sources } = JSON.parse(rawBody);

    if (!title || !content) {
      return new Response(
        JSON.stringify({ error: 'Title and content are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

    // メモを作成（RLSポリシーがauth.jwt()->'user_metadata'->>'user_id'でユーザーを識別）
    const { data, error } = await supabase
      .from('memos')
      .insert({
        title,
        content,
        ai_generation_sources: sources || [],
        user_id: userId,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating memo:', error)
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Memo created successfully:', data.id)

    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 201 }
    )
  } catch (e) {
    console.error('An unexpected error occurred:', e)
    return new Response(
      JSON.stringify({ error: 'Internal Server Error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})