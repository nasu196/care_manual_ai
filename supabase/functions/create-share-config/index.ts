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
    console.log('Method:', req.method);
    
    // Authorizationヘッダーを取得（全メソッド共通）
    const authHeader = req.headers.get('Authorization')
    
    if (!authHeader) {
      console.error('Authorization header is missing')
      return new Response(
        JSON.stringify({ error: 'No Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // JWTからユーザーIDを取得（全メソッド共通）
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

    // Supabaseクライアントを初期化（全メソッド共通）
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

    // *** GETメソッド: 一覧取得 ***
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const action = url.searchParams.get('action');
      
      // 削除機能: ?action=delete&id=shareId
      if (action === 'delete') {
        const shareId = url.searchParams.get('id');
        
        if (!shareId) {
          return new Response(
            JSON.stringify({ error: 'Share ID is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // セキュリティチェック: 指定されたshare_configがユーザーのものかを確認
        const { data: existingConfig, error: fetchError } = await supabase
          .from('share_configs')
          .select('id, user_id, is_active')
          .eq('id', shareId)
          .eq('user_id', userId)
          .single();

        if (fetchError || !existingConfig) {
          return new Response(
            JSON.stringify({ error: 'Share configuration not found or access denied' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // 論理削除を実行
        const { error: deleteError } = await supabase
          .from('share_configs')
          .update({ is_active: false })
          .eq('id', shareId)
          .eq('user_id', userId);

        if (deleteError) {
          console.error('Error deleting share config:', deleteError);
          return new Response(
            JSON.stringify({ error: 'Failed to delete share configuration' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`Successfully deleted share config ${shareId} for user ${userId}`);
        return new Response(
          JSON.stringify({ message: 'Share configuration deleted successfully' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // デフォルト: 一覧取得
      const { data: shareConfigs, error: shareError } = await supabase
        .from('share_configs')
        .select('id, selected_record_ids, created_at, expires_at, is_active')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (shareError) {
        console.error('Error fetching share configs:', shareError);
        return new Response(
          JSON.stringify({ error: 'Failed to fetch share configurations' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`Found ${shareConfigs?.length || 0} share configs for user ${userId}`);

      return new Response(
        JSON.stringify({
          shareConfigs: shareConfigs || []
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // *** POSTメソッド: 新規作成（既存のロジック） ***
    if (req.method === 'POST') {
      // リクエストボディを解析
      const requestText = await req.text()
      console.log('Raw request body:', requestText)
      
      let requestData
      try {
        requestData = JSON.parse(requestText)
        console.log('Parsed request data:', requestData)
        console.log('selectedRecordIds from request:', requestData.selectedRecordIds)
        console.log('selectedRecordIds type:', typeof requestData.selectedRecordIds)
        console.log('selectedRecordIds Array.isArray:', Array.isArray(requestData.selectedRecordIds))
      } catch (parseError) {
        console.error('JSON parse error:', parseError)
        return new Response(
          JSON.stringify({ error: 'Invalid JSON in request body' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const { selectedRecordIds } = requestData
      console.log('Selected record IDs:', selectedRecordIds)

      // 共有IDを生成（UUID v4）
      const shareId = crypto.randomUUID()

      // 共有設定をデータベースに保存
      const { error: insertError } = await supabase
        .from('share_configs')
        .insert({
          id: shareId,
          user_id: userId,
          selected_record_ids: selectedRecordIds,
          created_at: new Date().toISOString(),
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
    }

    // サポートされていないメソッド
    return new Response(
      JSON.stringify({ error: `Method ${req.method} not allowed` }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in create-share-config function:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}) 