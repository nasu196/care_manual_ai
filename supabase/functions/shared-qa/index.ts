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
    const { shareId, question, conversationHistory, verbosity } = await req.json()

    if (!shareId || !question) {
      return new Response(
        JSON.stringify({ error: 'Share ID and question are required' }),
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
      .gt('expires_at', new Date().toISOString())
      .single()

    if (shareError || !shareConfig) {
      return new Response(
        JSON.stringify({ error: 'Share configuration not found or expired' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const selectedSourceNames = shareConfig.selected_source_names as string[]
    
    if (!selectedSourceNames || selectedSourceNames.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No sources available for this share' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ユーザーのマニュアルIDを取得（選択されたソースのみ）
    const { data: manuals, error: manualsError } = await supabase
      .from('manuals')
      .select('id')
      .eq('user_id', shareConfig.user_id)
      .in('original_file_name', selectedSourceNames)

    if (manualsError || !manuals || manuals.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No manuals found for selected sources' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const manualIds = manuals.map(m => m.id)

    // ベクトル検索を実行
    const { data: searchResults, error: searchError } = await supabase.rpc('search_manual_chunks', {
      query_text: question,
      match_threshold: 0.3,
      match_count: 10,
      manual_ids: manualIds
    })

    if (searchError) {
      console.error('Vector search error:', searchError)
      return new Response(
        JSON.stringify({ error: 'Failed to search manual chunks' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Google Gemini APIを使用して回答を生成
    const geminiApiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY')
    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ error: 'Gemini API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 検索結果からコンテキストを構築
    const context = searchResults?.map((result: any) => result.chunk_text).join('\n\n') || ''
    
    // 会話履歴を構築
    const historyContext = conversationHistory && conversationHistory.length > 0
      ? conversationHistory.map((msg: any) => `${msg.role}: ${msg.content}`).join('\n')
      : ''

    // 詳細度に応じたプロンプト調整
    let verbosityInstruction = ''
    switch (verbosity) {
      case 'concise':
        verbosityInstruction = '簡潔で要点を絞った回答をしてください。'
        break
      case 'detailed':
        verbosityInstruction = '詳細で丁寧な説明を含む回答をしてください。'
        break
      default:
        verbosityInstruction = '適度な詳しさで回答してください。'
    }

    const prompt = `あなたは介護マニュアルの専門アシスタントです。以下のマニュアル内容に基づいて、ユーザーの質問に正確に答えてください。

${verbosityInstruction}

マニュアル内容:
${context}

${historyContext ? `会話履歴:\n${historyContext}\n` : ''}

質問: ${question}

回答は以下の形式で提供してください:
1. 質問への直接的な回答
2. 根拠となるマニュアルの該当箇所の引用
3. 必要に応じて追加の注意点や関連情報

マニュアルに記載されていない内容については、「マニュアルには記載されていません」と明記してください。`

    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.3,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048,
        }
      })
    })

    if (!geminiResponse.ok) {
      console.error('Gemini API error:', await geminiResponse.text())
      return new Response(
        JSON.stringify({ error: 'Failed to generate response' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const geminiData = await geminiResponse.json()
    const generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'すみません、回答を生成できませんでした。'

    // ソース情報を構築
    const sources = searchResults?.map((result: any) => ({
      id: result.manual_id,
      manual_id: result.manual_id,
      file_name: result.file_name || 'Unknown',
      similarity: result.similarity || 0,
      text_snippet: result.chunk_text?.substring(0, 200) + '...' || ''
    })) || []

    return new Response(
      JSON.stringify({
        answer: generatedText,
        sources: sources
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in shared-qa function:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}) 