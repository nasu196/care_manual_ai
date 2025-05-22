import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'

console.log('Suggest next actions function up and running!')

serve(async (req: Request) => {
  // This is needed if you're planning to invoke your function from a browser.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 現時点では固定の提案を返す
    const suggestions = [
      "新しいメモを作成する",
      "既存のメモを編集する",
      "マニュアルを検索する",
      "AIに質問する",
      "重要な情報を確認する",
      "設定を見直す",
      "チームメンバーに連絡する",
      "タスクの進捗を確認する",
      "休憩を取る",
      "今日の目標を再確認する"
    ];

    // ランダムに提案を選択するか、常に固定のものを返すかなどを検討
    // 今回は最大10件なので全て返す

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    console.error(error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
}) 