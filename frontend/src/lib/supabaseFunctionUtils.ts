// import removed: createBrowserClient is no longer needed

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

interface InvokeFunctionOptions {
  method?: 'POST' | 'GET' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: Record<string, unknown> | undefined;
  itemId?: string; // DELETE や特定のGETのためにIDを渡すためのオプション
}

export async function invokeFunction(
  functionName: string,
  options: InvokeFunctionOptions = {},
  getToken: (options?: { template?: string }) => Promise<string | null>,
  userId: string | null | undefined
) {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[invokeFunction] Supabase URL or Anon Key is missing.');
    return { data: null, error: { message: 'Supabase configuration error.' } };
  }

  if (!userId) {
    console.error('[invokeFunction] User ID is missing. Cannot call function.');
    return { data: null, error: { message: 'User not authenticated properly.' } };
  }

  // Edge Function呼び出し時に使用するClerkトークン
  let token: string | null = null;

  try {
    token = await getToken({ template: 'supabase' });
  } catch (e) {
    console.error('[invokeFunction] Failed to get Clerk token:', e);
    return { data: null, error: { message: 'Failed to retrieve authentication token.' } };
  }

  if (!token) {
    console.error('[invokeFunction] Clerk token is null.');
    return { data: null, error: { message: 'Authentication token is missing.' } };
  }

  try {
    console.log(`[invokeFunction] Calling ${functionName} with method ${options.method || 'POST'}, token and userId: ${userId}`);
    console.log('[invokeFunction] Body to be sent (before stringify):', options.body);

    let endpoint = `${supabaseUrl}/functions/v1/${functionName}`;
    if (options.method === 'DELETE' && options.itemId) {
      endpoint = `${endpoint}/${options.itemId}`;
    }

    // Edge Function エンドポイントを直接呼び出す
    const response = await fetch(endpoint, {
      method: options.method || 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': supabaseAnonKey,
        ...( (options.method === 'POST' || options.method === 'PUT' || options.method === 'PATCH') && options.body 
            ? { 'Content-Type': 'application/json' } 
            : {}),
        'x-user-id': userId,
        ...(options.headers || {}),
      },
      body: (options.method === 'POST' || options.method === 'PUT' || options.method === 'PATCH') && options.body 
            ? JSON.stringify(options.body) 
            : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[invokeFunction] Error response from ${functionName}:`, errorText);
      return { data: null, error: { message: errorText, status: response.status } };
    }

    const data = await response.json();
    console.log(`[invokeFunction] Success from ${functionName}:`, data);
    return { data, error: null };
  } catch (e) {
    console.error(`[invokeFunction] Exception during ${functionName} call:`, e);
    return { data: null, error: { message: `Exception: ${(e as Error).message}` } };
  }
} 