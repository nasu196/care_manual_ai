import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

interface InvokeFunctionOptions {
  method?: 'POST' | 'GET' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
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

  const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey); // 呼び出しの都度クライアントを生成
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

  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'x-user-id': userId,
  };

  try {
    console.log(`[invokeFunction] Calling ${functionName} with token and userId: ${userId}`);
    const { data, error } = await supabase.functions.invoke(functionName, {
      ...options,
      headers,
    });

    if (error) {
      console.error(`[invokeFunction] Error from ${functionName}:`, error);
      return { data: null, error };
    }
    console.log(`[invokeFunction] Success from ${functionName}:`, data);
    return { data, error: null };
  } catch (e) {
    console.error(`[invokeFunction] Exception during ${functionName} call:`, e);
    return { data: null, error: { message: `Exception: ${(e as Error).message}` } };
  }
} 