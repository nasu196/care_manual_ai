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

    if (!shareId) {
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
      return new Response(
        JSON.stringify({ error: 'Share configuration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ユーザーのメモを取得
    const { data: memos, error: memosError } = await supabase
      .from('memos')
      .select('id, title, content, is_important, created_at, updated_at')
      .eq('user_id', shareConfig.user_id)
      .order('is_important', { ascending: false })
      .order('updated_at', { ascending: false })

    if (memosError) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch memos' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ユーザーのマニュアル情報を取得（選択されたレコードのみ）
    const selectedRecordIds = shareConfig.selected_record_ids as string[]
    
    // 後方互換性: 古い形式の共有設定にも対応
    const legacySelectedSourceNames = (shareConfig as any).selected_source_names as string[]
    
    let manuals: Array<{id: string, file_name: string, original_file_name: string, is_deleted?: boolean}> = []
    
    if (selectedRecordIds && selectedRecordIds.length > 0) {
      // 新しい形式：レコードIDベース
      console.log('get-share-config: Using new format (record IDs):', selectedRecordIds)
      console.log('get-share-config: Fetching manuals for user:', shareConfig.user_id, 'with IDs:', selectedRecordIds)
      const { data: manualsData, error: manualsError } = await supabase
        .from('manuals')
        .select('id, file_name, original_file_name')
        .eq('user_id', shareConfig.user_id)
        .in('id', selectedRecordIds)

      console.log('get-share-config: Manuals query result:', { manualsData, manualsError })
      if (manualsError) {
        console.error('get-share-config: Error fetching manuals:', manualsError)
        return new Response(
          JSON.stringify({ error: '共有されたマニュアルの取得に失敗しました。' }),
          { status: 500, headers: corsHeaders }
        )
      }

      manuals = manualsData || []
    } else if (legacySelectedSourceNames && legacySelectedSourceNames.length > 0) {
      // 後方互換性：ファイル名ベース
      const { data: manualsData, error: manualsError } = await supabase
        .from('manuals')
        .select('id, file_name, original_file_name')
        .eq('user_id', shareConfig.user_id)
        .or(
          legacySelectedSourceNames.map(name => 
            `original_file_name.eq.${name},file_name.eq.${name}`
          ).join(',')
        )

      if (manualsError) {
        return new Response(
          JSON.stringify({ error: '共有されたマニュアルの取得に失敗しました。' }),
          { status: 500, headers: corsHeaders }
        )
      }

      manuals = manualsData || []
    } else {
      return new Response(
        JSON.stringify({ error: '共有設定にファイルが選択されていません。この共有URLは無効です。' }),
        { status: 400, headers: corsHeaders }
      )
    }

    const responseData = {
      shareConfig: {
        id: shareConfig.id,
        selectedRecordIds: shareConfig.selected_record_ids,
        createdAt: shareConfig.created_at,
        expiresAt: shareConfig.expires_at,
      },
      memos: memos || [],
      manuals: manuals,
    };

    return new Response(
      JSON.stringify(responseData),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in get-share-config function:', error)
    console.error('Error details:', {
      name: error?.name,
      message: error?.message,
      stack: error?.stack
    })
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error?.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}) 