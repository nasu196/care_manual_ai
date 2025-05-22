import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "npm:@google/generative-ai";
import "npm:dotenv/config"; // Deno Deployでは不要だがローカルテスト用に残すことも検討

console.log('Suggest next actions function up and running!')

// SupabaseクライアントとGemini APIクライアントの初期化 (環境変数から)
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); // SERVICE_ROLE_KEY を使用
const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

let supabase: SupabaseClient;
if (supabaseUrl && supabaseServiceKey) {
    supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
            // SERVICE_ROLE_KEY を使用する場合、autoRefreshToken と persistSession は false に設定することが推奨されます。
            // 詳細: https://supabase.com/docs/reference/javascript/initializing#with-service-role-key
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false
        }
    });
} else {
    console.error("エラー: SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が環境変数に設定されていません。");
}

let genAI: GoogleGenerativeAI;
if (geminiApiKey) {
    genAI = new GoogleGenerativeAI(geminiApiKey);
} else {
    console.error("エラー: GEMINI_API_KEY が環境変数に設定されていません。");
}

interface Suggestion {
    title: string;
    description: string;
}

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    if (!supabase) {
        return new Response(JSON.stringify({ error: "Supabase client not initialized." }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
    if (!genAI) {
        return new Response(JSON.stringify({ error: "Gemini API client not initialized." }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }

    try {
        console.log("Fetching summaries from 'manuals' table...");
        const { data: summariesData, error: fetchError } = await supabase
            .from('manuals')
            .select('file_name, summary')
            .not('summary', 'is', null)
            .filter('summary', 'not.eq', ''); // 空文字列も除外

        if (fetchError) {
            console.error("Error fetching summaries:", fetchError);
            throw new Error(`Failed to fetch summaries: ${fetchError.message}`);
        }

        if (!summariesData || summariesData.length === 0) {
            console.log("No summaries found in the database.");
            return new Response(JSON.stringify({ suggestions: [], message: "提案の元となる有効なドキュメントサマリーが見つかりません。" }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200, // エラーではなく、提案がない状態として200を返す
            });
        }

        console.log(`Found ${summariesData.length} summaries.`);

        // formattedSummaries の生成方法を修正 (リンターエラー対策)
        let summaryStrings: string[] = [];
        for (const item of summariesData) {
            summaryStrings.push(`[サマリー: ${item.file_name}]\\n${item.summary}`);
        }
        const formattedSummaries = summaryStrings.join('\\n\\n---\\n\\n');

        const prompt = `以下のドキュメントサマリー群に基づいて、ユーザーが次にどのような派生資料（例：研修資料の骨子、練習問題のテーマ、FAQの質問候補、チェックリストの項目、既存資料を別観点からまとめた資料のアイデアなど）を作成すると有効か、具体的なアイデアを5つ提案してください。\n各アイデアは、簡潔なタイトルと、それがなぜ有用かの短い説明（100字以内）を含めてください。\n\n【ドキュメントサマリー群】\n${formattedSummaries}\n\n提案は必ず以下のJSON配列形式で出力してください。説明文はmarkdown形式ではなくプレーンテキストにしてください。\n\`\`\`json\n[\n  {\n    \"title\": \"提案タイトル1\",\n    \"description\": \"提案の説明1 (なぜ有用か)\"\n  },\n  {\n    \"title\": \"提案タイトル2\",\n    \"description\": \"提案の説明2 (なぜ有用か)\"\n  },\n  // ...他アイデア\n]\n\`\`\`\n`;

        console.log("Prompt for Gemini API:\\n ", prompt);

        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash",
            // 安全設定は必要に応じて調整
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            ],
            generationConfig: {
                // JSONモードが利用可能であれば、それを指定することで、より確実にJSON形式の出力を得られる
                // responseMimeType: "application/json", // Gemini 1.5 Pro/Flashの最新版でサポートされているか確認が必要
            }
        });

        console.log("Calling Gemini API...");
        const result = await model.generateContent(prompt);
        const response = result.response;
        const responseText = response.text();

        console.log("Gemini API response text:\\n ", responseText);

        let suggestions: Suggestion[] = [];
        try {
            // JSONマーカーの正規表現を修正
            const jsonMatch = responseText.match(/```json\\n([\\s\\S]*?)\\n```/);
            if (jsonMatch && jsonMatch[1]) {
                suggestions = JSON.parse(jsonMatch[1]);
            } else {
                console.warn("JSON markers not found in response, attempting direct parse.");
                suggestions = JSON.parse(responseText);
            }
             // descriptionの長さを制限する (万が一AIが指示を守らなかった場合のため)
            suggestions = suggestions.map(s => ({ ...s, description: s.description.length > 150 ? s.description.substring(0, 150) + "..." : s.description }));
        } catch (parseError: any) {
            console.error("Failed to parse Gemini API response as JSON:", parseError);
            console.error("Original response text was:", responseText);
            // パース失敗時は固定のメッセージか、エラーを示す提案を返すことも検討
            suggestions = [{ title: "提案取得エラー", description: "AIからの提案の解析に失敗しました。" }];
        }

        return new Response(JSON.stringify({ suggestions }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error: any) {
        console.error("Error in suggest-next-actions function:", error);
        return new Response(JSON.stringify({ error: error.message || "An unknown error occurred" }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
}); 