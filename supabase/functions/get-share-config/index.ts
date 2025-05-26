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
    // URLパラメータから共有IDを取得
    const url = new URL(req.url)
    const shareId = url.searchParams.get('id')

    console.log('get-share-config: Received request for shareId:', shareId)

    if (!shareId) {
      console.error('get-share-config: Share ID is missing')
      return new Response(
        JSON.stringify({ error: 'Share ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // サービスロールキーでSupabaseクライアントを初期化（RLSをバイパス）
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 共有設定を取得
    const { data: shareConfig, error: shareError } = await supabase
      .from('share_configs')
      .select('*')
      .eq('id', shareId)
      .eq('is_active', true)
      .single()

    if (shareError || !shareConfig) {
      console.error('get-share-config: Share config error:', shareError)
      console.error('get-share-config: Share config data:', shareConfig)
      return new Response(
        JSON.stringify({ error: 'Share configuration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('get-share-config: Found share config for user:', shareConfig.user_id)

    // ユーザーのメモを取得
    const { data: memos, error: memosError } = await supabase
      .from('memos')
      .select('id, title, content, is_important, created_at, updated_at')
      .eq('user_id', shareConfig.user_id)
      .order('is_important', { ascending: false })
      .order('updated_at', { ascending: false })

    if (memosError) {
      console.error('get-share-config: Error fetching memos:', memosError)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch memos' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('get-share-config: Found', memos?.length || 0, 'memos for user')

    // ユーザーのマニュアル情報を取得（選択されたソースのみ）
    const selectedSourceNames = shareConfig.selected_source_names as string[]
    let manuals: Array<{id: string, file_name: string, original_file_name: string}> = []
    
    if (selectedSourceNames && selectedSourceNames.length > 0) {
      const { data: manualsData, error: manualsError } = await supabase
        .from('manuals')
        .select('id, file_name, original_file_name')
        .eq('user_id', shareConfig.user_id)
        .in('original_file_name', selectedSourceNames)

      if (manualsError) {
        console.error('Error fetching manuals:', manualsError)
      } else {
        manuals = manualsData || []
      }
    }

    return new Response(
      JSON.stringify({
        shareConfig: {
          id: shareConfig.id,
          selectedSourceNames: shareConfig.selected_source_names,
          createdAt: shareConfig.created_at,
          expiresAt: shareConfig.expires_at,
        },
        memos: memos || [],
        manuals: manuals,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in get-share-config function:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}) 