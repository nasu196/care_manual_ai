import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve, ConnInfo } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "npm:@google/generative-ai";
import "npm:dotenv/config"; // Deno Deployでは不要だがローカルテスト用に残すことも検討

console.log('Suggest next actions function up and running!')

// SupabaseクライアントとGemini APIクライアントの初期化 (環境変数から)
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

// Supabase クライアントと Gemini クライアントの初期化は serve 関数の外部で行い、エラーは起動時にコンソールに出力
let supabase: SupabaseClient | null = null;
if (supabaseUrl && supabaseAnonKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
  } catch (e) {
    console.error("Supabaseクライアント初期化中にエラー発生:", e);
    // supabase は null のままになる
  }
} else {
  console.error("初期化エラー: SUPABASE_URL または SUPABASE_ANON_KEY が未設定です。起動に失敗する可能性があります。");
}

let genAI: GoogleGenerativeAI | null = null;
if (geminiApiKey) {
  try {
    genAI = new GoogleGenerativeAI(geminiApiKey);
  } catch (e) {
    console.error("Gemini APIクライアント初期化中にエラー発生:", e);
    // genAI は null のままになる
  }
} else {
  console.error("初期化エラー: GEMINI_API_KEY が未設定です。起動に失敗する可能性があります。");
}

interface Suggestion {
    title: string;
    description: string;
    source_files?: string[]; // APIのレスポンス形式に合わせる
}

serve(async (req: Request, _connInfo: ConnInfo): Promise<Response> => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    if (!supabase || !genAI) {
        console.error("サーバー致命的エラー: Supabase または Gemini クライアントが初期化されていません。起動時のログを確認してください。");
        return new Response(JSON.stringify({ error: "サーバー内部エラー。構成に問題があります。" }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }

    let userId: string | null = null;
    try {
        const authHeader = req.headers.get('Authorization');
        console.log('[suggest-next-actions][Auth] Authorization Header:', authHeader);

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.error('[suggest-next-actions][Auth] Missing or invalid Authorization header.');
            return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header. Clerk JWT Bearer token is required.' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const token = authHeader.replace('Bearer ', '');
        const parts = token.split('.');
        if (parts.length !== 3) {
            console.error('[suggest-next-actions][Auth] Invalid JWT format.');
            return new Response(JSON.stringify({ error: 'Invalid JWT format' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
        const payload = JSON.parse(atob(parts[1]));
        console.log('[suggest-next-actions][Auth] Decoded Clerk JWT Payload:', payload);

        userId = payload.sub || payload.user_id || payload.user_metadata?.user_id;

        if (!userId) {
            console.error('[suggest-next-actions][Auth] User ID (sub) not found in Clerk JWT payload.');
            return new Response(JSON.stringify({ error: 'User ID not found in token' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
        console.log(`[suggest-next-actions][Auth] Authenticated user ID from Clerk JWT: ${userId}`);
        
        const xUserIdHeader = req.headers.get('x-user-id');
        if (xUserIdHeader) {
            console.log('[suggest-next-actions][Auth] x-user-id header:', xUserIdHeader);
            if (userId !== xUserIdHeader) {
                console.warn(`[suggest-next-actions][Auth] Mismatch JWT user ID (${userId}) vs x-user-id header (${xUserIdHeader})`);
            }
        }

    } catch (error) {
        console.error('[suggest-next-actions][Auth] Error processing Authorization token:', error);
        return new Response(JSON.stringify({ error: 'Failed to process Authorization token.' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    try {
        const body = await req.json();
        const selectedFileNames = body?.selectedFileNames as string[] | undefined;
        console.log("Received selectedFileNames:", selectedFileNames);

        if (!selectedFileNames || selectedFileNames.length === 0) {
            console.log("No specific files selected. Returning empty suggestions.");
            return new Response("```json\n[]\n```", {
                headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
                status: 200,
            });
        }

        console.log("Fetching summaries for selected files from 'manuals' table for user:", userId);
        let query = supabase
            .from('manuals')
            .select('file_name, original_file_name, summary')
            .eq('user_id', userId)
            .not('summary', 'is', null)
            .filter('summary', 'not.eq', '');
        
        query = query.in('original_file_name', selectedFileNames);
        
        const { data: summariesData, error: fetchError } = await query;

        if (fetchError) {
            console.error("Error fetching summaries for user " + userId + ":", fetchError);
            throw new Error(`Failed to fetch summaries: ${fetchError.message}`);
        }

        if (!summariesData || summariesData.length === 0) {
            console.log("No summaries found for user " + userId + " with selected files.");
            return new Response(JSON.stringify({ suggestions: [], message: "提案の元となるサマリーがありません。" }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            });
        }

        console.log(`Found ${summariesData.length} summaries for user ${userId}.`);

        const summaryStrings: string[] = [];
        for (const item of summariesData) {
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

        console.log("Prompt for Gemini API (user: " + userId + "):\n ", prompt);

        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash",
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            ],
        });

        console.log("Calling Gemini API...");
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        console.log("Raw response from Gemini API (user: " + userId + "):\n ", responseText);
        return new Response(responseText, {
            headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
            status: 200,
        });
    } catch (error: unknown) {
        console.error(`Error in suggest-next-actions function for user ${userId || 'unknown'}:`, error);
        const errorMessage = error instanceof Error ? error.message : "不明なサーバーエラーが発生しました。";
        return new Response(JSON.stringify({ error: errorMessage }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
}); 