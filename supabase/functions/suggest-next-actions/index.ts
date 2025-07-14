import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve, ConnInfo } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "npm:@google/generative-ai";
import "npm:dotenv/config"; // Deno Deployでは不要だがローカルテスト用に残すことも検討

console.log('Suggest next actions function up and running!')

// 環境変数の取得
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

// Gemini クライアントの初期化
let genAI: GoogleGenerativeAI | null = null;
if (geminiApiKey) {
  try {
    genAI = new GoogleGenerativeAI(geminiApiKey);
  } catch (e) {
    console.error("Gemini APIクライアント初期化中にエラー発生:", e);
  }
} else {
  console.error("初期化エラー: GEMINI_API_KEY が未設定です。");
}

interface Suggestion {
    title: string;
    description: string;
    source_files?: string[];
}

serve(async (req: Request, _connInfo: ConnInfo): Promise<Response> => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    if (!supabaseUrl || !supabaseAnonKey) {
        console.error('SUPABASE_URL or SUPABASE_ANON_KEY is not set.')
        return new Response(JSON.stringify({ error: 'Missing Supabase environment variables' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }

    if (!genAI) {
        console.error("サーバー致命的エラー: Gemini クライアントが初期化されていません。");
        return new Response(JSON.stringify({ error: "サーバー内部エラー。構成に問題があります。" }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }

    let userId: string | null = null;
    let authHeader: string | null = null;
    let payload: any = null;
    
    try {
        authHeader = req.headers.get('Authorization');
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
        payload = JSON.parse(atob(parts[1]));
        console.log('[suggest-next-actions][Auth] Decoded Clerk JWT Payload:', payload);

        // Clerk統合では user_metadata.user_id を優先
        userId = payload.user_metadata?.user_id || payload.sub;

        if (!userId) {
            console.error('[suggest-next-actions][Auth] User ID not found in Clerk JWT payload.');
            return new Response(JSON.stringify({ error: 'User ID not found in token' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
        console.log(`[suggest-next-actions][Auth] Authenticated user ID from Clerk JWT: ${userId}`);

    } catch (error) {
        console.error('[suggest-next-actions][Auth] Error processing Authorization token:', error);
        return new Response(JSON.stringify({ error: 'Failed to process Authorization token.' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    try {
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
        });

        const body = await req.json();
        const selectedRecordIds = body?.selectedRecordIds as string[] | undefined;
        console.log("Received selectedRecordIds:", selectedRecordIds);

        if (!selectedRecordIds || selectedRecordIds.length === 0) {
            console.log("No specific records selected. Returning empty suggestions.");
            return new Response("```json\n[]\n```", {
                headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
                status: 200,
            });
        }

        console.log("Fetching summaries for selected record IDs from 'manuals' table for user:", userId);
        console.log("Selected record IDs:", selectedRecordIds);
        
        // デバッグ: JWT payload情報を確認
        console.log("JWT payload sub:", payload.sub);
        console.log("JWT payload user_metadata:", payload.user_metadata);
        console.log("Selected userId:", userId);
        
        // まず、選択されたrecordIdがどのようなデータを持っているか確認
        const { data: recordDebugData, error: recordDebugError } = await supabase
            .from('manuals')
            .select('id, user_id, file_name, original_file_name, summary, created_at')
            .in('id', selectedRecordIds);
        
        console.log("Record debug data:", { recordDebugData, recordDebugError });
        
        // RLSポリシーがユーザー分離を処理するため、user_idでのフィルタリングは不要
        const { data: summariesData, error: fetchError } = await supabase
            .from('manuals')
            .select('file_name, original_file_name, summary, user_id')
            .not('summary', 'is', null)
            .filter('summary', 'not.eq', '')
            .in('id', selectedRecordIds);

        console.log("Query result:", { summariesData, fetchError });

        if (fetchError) {
            console.error("Error fetching summaries for user " + userId + ":", fetchError);
            throw new Error(`Failed to fetch summaries: ${fetchError.message}`);
        }

        if (!summariesData || summariesData.length === 0) {
            console.log("No summaries found for user " + userId + " with selected record IDs.");
            
            // デバッグ: ユーザーの全manualsレコードを確認
            const { data: allManuals, error: allError } = await supabase
                .from('manuals')
                .select('id, file_name, original_file_name, user_id, summary')
                .limit(10);
            
            console.log("Sample manuals accessible to user:", { allManuals, allError });
            
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

もし、以下の【ドキュメントサマリー群】から、これが介護業界に関連する資料だと判断できる場合は、下記の「介護業界での実用的な提案例」を**あくまで参考として**ご自身の判断で活用し、より適切な提案を生成してください。
必ずしもこれらの例に厳密に従う必要はありません。あなたの知識と判断に基づき、最も価値のある提案を優先してください。

**介護業界での実用的な提案例：**

### 研修資料・教育資料の活用例
- 「理解度確認テストの作成」
- 「実践向け簡易手順書の作成」
- 「特定テーマのキーポイント集の作成」

### 業務手順マニュアルの活用例
- 「日常業務用チェックリストの作成」
- 「緊急時アクションカードの作成」
- 「場面別予防策ポスター用コンテンツの作成」

### 規定・ルールブックの活用例
- 「職員向け重要ポイントFAQの作成」
- 「日常業務での注意点リマインダーの作成」

### 既存マニュアルの応用・展開例
- 「専門的な記述を平易にした説明資料の作成」
- 「複数資料からの情報統合・比較資料の作成」
- 「多言語対応のための翻訳資料作成」
- 「サービス内容に関するQ&A集の作成」

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