import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
// import { verify } from "https://deno.land/x/djwt@v2.2/mod.ts"; // 必要に応じて適切なJWT検証ライブラリを導入
// import { config } from "https://deno.land/x/dotenv/mod.ts";

// config({ export: true }); // .envファイルを使用する場合

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface DeleteFileRequest {
  fileName: string; // エンコードされたファイル名 (例: xxx.pdf, yyy.docx)
}

interface ClerkJwtPayload {
  sub: string; 
  // 必要に応じて他のクレームも定義
  [key: string]: any; 
}

async function getUserIdFromAuthHeader(authHeader: string | null): Promise<string | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[delete-file-function] Missing or invalid authorization header');
    return null;
  }
  const token = authHeader.replace('Bearer ', '');

  try {
    // --- Clerk JWTの検証 ---
    // 重要: この部分はClerkの推奨するJWT検証方法に従って正確に実装してください。
    // 例えば、ClerkのJWKSエンドポイントから公開鍵を取得し、トークンの署名を検証します。
    // Denoで利用可能なJWTライブラリ (例: `https://deno.land/x/djwt`) や、
    // Clerkが提供するSDK/ヘルパーがあればそれを使用します。
    // 以下はペイロードをデコードするだけの簡易的な例であり、本番環境では不十分です。
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.error('[delete-file-function] Invalid JWT structure');
      return null;
    }
    // atobはDenoのグローバルスコープでは使えないため、代替手段が必要です。
    // TextDecoderとUint8Arrayを使う例:
    const payloadString = new TextDecoder().decode(Uint8Array.from(atob(parts[1]), c => c.charCodeAt(0)));
    const payload = JSON.parse(payloadString) as ClerkJwtPayload;
    
    // ここでClerkのiss (issuer) や aud (audience) の検証も行うべきです。
    // const CLERK_ISSUER = Deno.env.get("CLERK_ISSUER_URL"); // 例: https://clerk.your-domain.com
    // if (payload.iss !== CLERK_ISSUER) {
    //   console.error('[delete-file-function] Invalid JWT issuer:', payload.iss);
    //   return null;
    // }

    if (!payload.sub) {
      console.error('[delete-file-function] User ID (sub) not found in JWT payload');
      return null;
    }
    console.log(`[delete-file-function] Extracted user ID (sub): ${payload.sub} from JWT`);
    return payload.sub;

  } catch (error) {
    console.error('[delete-file-function] JWT processing failed:', error);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const userId = await getUserIdFromAuthHeader(authHeader);

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid or missing token, or failed to extract user ID.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // console.log(`[delete-file-function] Authenticated user ID: ${userId}`); // userIdはログ出力済み

    const requestData: DeleteFileRequest = await req.json();
    const { fileName } = requestData;

    if (!fileName) {
      return new Response(
        JSON.stringify({ error: 'fileName is required in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      console.error("[delete-file-function] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
      return new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500 });
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    console.log(`[delete-file-function] User [${userId}] attempting to delete file: ${fileName}`);

    // Step 1: manualsテーブルからレコードを削除 (user_id と file_name で絞り込み)
    const { count: deletedManualsCount, error: dbError } = await supabase
      .from('manuals')
      .delete({ count: 'exact' }) // 削除された行数を取得
      .eq('file_name', fileName)
      .eq('user_id', userId);    // ★ ユーザーIDで絞り込み

    if (dbError) {
      console.error(`[delete-file-function] Database delete error for user [${userId}], file [${fileName}]:`, dbError);
      return new Response(
        JSON.stringify({ error: `Database delete failed: ${dbError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (deletedManualsCount === 0) {
      console.warn(`[delete-file-function] No manual record found in DB for user [${userId}], file [${fileName}].`);
      // ファイルがDBに存在しない場合、ユーザーに404を返す
      return new Response(
        JSON.stringify({ message: 'File not found for this user or already deleted from database.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`[delete-file-function] Successfully deleted ${deletedManualsCount} record(s) from 'manuals' table for user [${userId}], file [${fileName}]`);

    // Step 2: Storageからファイルを削除
    // 注意: Storageのパス構造がユーザーごとに分離されていない場合（例: 'manuals/some-file.pdf'）、
    // このファイル名（fileName）が他のユーザーによっても使用されていると、意図せず他のユーザーのファイル実体を消してしまう可能性があります。
    // Storageのパスを 'manuals/{user_id}/{fileName}' のようにユーザー分離することが強く推奨されます。
    // 現状は、DBから該当ユーザーのレコードが削除された場合にのみ、指定されたfileNameでStorageからの削除を試みます。
    
    const storagePathToDelete = `${userId}/${fileName}`; 
    // もしStorageのパスが 'bucketName/userId/fileName' のようになっている場合は、以下のように構成します。
    // const storagePathToDelete = `${userId}/${fileName}`; 
    // この場合、Storageバケットの'manuals'直下にユーザーID名のフォルダがある想定です。

    console.log(`[delete-file-function] Attempting to delete from storage. Path: ${storagePathToDelete}`);
    const { error: storageError } = await supabase.storage
      .from('manuals') // バケット名
      .remove([storagePathToDelete]); 

    if (storageError) {
      // ファイルが存在しないエラーは頻繁に起こりうる（DB削除後、何らかの理由でStorageにファイルがなかった等）
      // そのため、警告としてログに残し、クライアントにはDB削除成功の旨を伝えることも検討できます。
      // ここでは、一旦エラーとして処理します。
      console.warn(`[delete-file-function] Storage delete warning/error for user [${userId}], path [${storagePathToDelete}]:`, storageError.message);
      // DBでは削除されたがStorageでエラーが出たことを示すメッセージも検討
      return new Response(
        JSON.stringify({ 
          message: 'Database record deleted, but failed to delete file from storage. It might be already deleted or an unexpected error occurred.',
          storageError: storageError.message 
        }),
        { status: 207, headers: { ...corsHeaders, 'Content-Type': 'application/json' } } // Multi-Status
      );
    }

    console.log(`[delete-file-function] Successfully initiated delete from storage for user [${userId}], path [${storagePathToDelete}]`);

    return new Response(
      JSON.stringify({ message: 'File deleted successfully from database and storage.' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[delete-file-function] Unexpected error in main handler:', error);
    let errorMessage = 'Internal server error';
    let errorType = 'UnknownError';
    if (error instanceof Error) {
        errorMessage = error.message;
        if (error.name) {
            errorType = error.name;
        }
    }
    return new Response(
      JSON.stringify({ error: errorMessage, type: errorType }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}); 