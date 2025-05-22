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

        let suggestionsJsonString = responseText; // デフォルトはそのまま
        try {
            // レスポンスからJSON部分を抽出 (```json ... ``` の中身)
            const jsonMatch = responseText.match(/```json\\s*([\\s\\S]*?)\\s*```/);
            if (jsonMatch && jsonMatch[1]) {
                suggestionsJsonString = jsonMatch[1]; // 抽出したJSON文字列を使用
                console.log("Extracted JSON string from markers:\\n", suggestionsJsonString);
            } else {
                console.warn("JSON markers (```json) not found in Gemini response, assuming raw JSON or plain text.");
                // マーカーがない場合は、responseText がそのままJSON文字列であると期待する (あるいはエラー処理)
            }
            
            // ここで一度JSONとしてパースできるか試す（バリデーション目的）
            const preliminaryParse = JSON.parse(suggestionsJsonString);
            console.log("Preliminary parse successful before sending to client.");
            // もし description のトリミングなどをサーバーサイドで行うならここ
            if (Array.isArray(preliminaryParse)) {
                const processedSuggestions = preliminaryParse.map((s: any) => ({ 
                    title: s.title || "無題の提案", 
                    description: s.description ? (s.description.length > 150 ? s.description.substring(0, 150) + "..." : s.description) : "説明がありません。"
                }));
                suggestionsJsonString = JSON.stringify({ suggestions: processedSuggestions }); // フロントが期待する {suggestions: [...]} の形に戻す
            } else {
                 // 配列でない場合、エラーとして扱うか、あるいはそのまま返すか。今回はエラーとして扱う。
                console.error("Parsed preliminary JSON is not an array as expected by front-end wrapper.");
                throw new Error("AI response was not a JSON array after attempting to extract from markers.");
            }

        } catch (parseError: any) {
            console.error("Failed to parse or process Gemini API response on server-side:", parseError);
            console.error("Original response text from Gemini was:", responseText);
            // エラーの場合は、フロントエンドにエラー情報がわかるようなレスポンスを返す
            return new Response(JSON.stringify({ error: "AIからの応答の処理中にサーバー側でエラーが発生しました。詳細はサーバーログを確認してください。", details: parseError.message }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 500,
            });
        }

        return new Response(suggestionsJsonString, { // ★ 整形済みのJSON文字列 (suggestionsプロパティでラップされた) を返す
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error: any) { // このcatchは主にDBアクセスやクライアント初期化エラーなど
        console.error("Error in suggest-next-actions function:", error);
        return new Response(JSON.stringify({ error: error.message || "An unknown error occurred" }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
}); 