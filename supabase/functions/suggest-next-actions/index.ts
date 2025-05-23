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

    if (!supabase || !genAI) {
        return new Response(JSON.stringify({ error: "サーバー初期化エラー。環境変数を確認してください。" }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }

    try {
        // リクエストボディから selectedFileNames を取得
        const body = await req.json();
        const selectedFileNames = body?.selectedFileNames as string[] | undefined;

        console.log("Received selectedFileNames:", selectedFileNames);

        // selectedFileNames が指定されていない、または空の場合は、AI処理を行わず空の提案を返す
        if (!selectedFileNames || selectedFileNames.length === 0) {
            console.log("No specific files selected, or selectedFileNames is empty. Returning empty suggestions.");
            // フロントエンドは ```json ... ``` マーカーで囲まれたテキストを期待するので、それに合わせる
            return new Response("```json\n[]\n```", {
                headers: { ...corsHeaders, 'Content-Type': 'text/plain' }, // text/plainで返す
                status: 200,
            });
        }

        console.log("Fetching summaries for selected files from 'manuals' table...");
        let query = supabase
            .from('manuals')
            .select('file_name, original_file_name, summary')
            .not('summary', 'is', null)
            .filter('summary', 'not.eq', '');
        
        // selectedFileNames があれば、original_file_name でフィルタリング（日本語ファイル名対応）
        query = query.in('original_file_name', selectedFileNames);
        
        const { data: summariesData, error: fetchError } = await query;

        if (fetchError) {
            console.error("Error fetching summaries:", fetchError);
            throw new Error(`Failed to fetch summaries: ${fetchError.message}`);
        }

        if (!summariesData || summariesData.length === 0) {
            console.log("No summaries found in the database.");
            return new Response(JSON.stringify({ suggestions: [], message: "提案の元となるサマリーがありません。" }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200, // エラーではなく、提案がない状態として200を返す
            });
        }

        console.log(`Found ${summariesData.length} summaries.`);

        // formattedSummaries の生成方法を修正 (リンターエラー対策)
        let summaryStrings: string[] = [];
        for (const item of summariesData) {
            // 変更: original_file_name を使用し、AIが認識しやすい形式でサマリーに含める
            const displayName = item.original_file_name || item.file_name;
            summaryStrings.push(`ドキュメント名: ${displayName}\n内容サマリー:\n${item.summary}`);
        }
        const formattedSummaries = summaryStrings.join('\n\n---\n\n');

        const prompt = `以下の複数のドキュメントサマリー（各サマリーには「ドキュメント名: ...」で始まるファイル名が明記されています）を注意深く読み込んでください。
これらの情報を基に、ユーザーが次にどのような派生資料を作成すると有効か、具体的なアイデアを6つ提案してください。

提案内容は、**主にテキストコンテンツの生成や編集といった、コーディングや複雑なツール開発を伴わない、生成AIが得意とする範囲内**のものに限定してください。

提案の例：
- 特定のトピックに関する練習問題集の作成
- 既存情報を基にした初心者向け解説資料の作成
- よくある質問とその回答をまとめたFAQリストの作成
- 特定の作業手順に関するチェックリストの生成
- 既存の情報を異なる視点や対象者向けに再構成した説明文の作成
- 要点をまとめたフラッシュカード用コンテンツの作成

各アイデアは、簡潔なタイトル、それがなぜ有用かの短い説明（100字以内）、そしてそのアイデアを生成する上で**特に参考になったドキュメント名を1つ以上含む配列**を必ず含めてください。

【ドキュメントサマリー群】
${formattedSummaries}

提案は必ず以下のJSON配列形式で出力してください。説明文はmarkdown形式ではなくプレーンテキストにしてください。
\`\`\`json
[
  {
    "title": "提案タイトル1",
    "description": "提案の説明1 (なぜ有用か)",
    "source_files": ["参考にしたドキュメント名1.md", "参考にしたドキュメント名2.md"]
  },
  {
    "title": "提案タイトル2",
    "description": "提案の説明2 (なぜ有用か)",
    "source_files": ["参考にしたドキュメント名3.md"]
  },
  // ...他アイデア（各提案に source_files を含めること）
]
\`\`\`
`;

        console.log("Prompt for Gemini API:\n ", prompt);

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
        const responseText = result.response.text();

        console.log("Raw response from Gemini API:\n ", responseText); // 生のレスポンスをログに出力

        // Geminiからのレスポンスをそのままテキストとして返す
        return new Response(responseText, {
            headers: { ...corsHeaders, 'Content-Type': 'text/plain' }, // Content-Type を text/plain に変更
            status: 200,
        });
    } catch (error: any) {
        console.error("Error in suggest-next-actions function:", error);
        return new Response(JSON.stringify({ error: error.message || "不明なサーバーエラーが発生しました。" }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
}); 