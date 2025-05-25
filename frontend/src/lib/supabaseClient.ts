import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase URL and Anon Key are required.');
}

// 基本的なSupabaseクライアント（認証なし）
export const supabase = createBrowserClient(
  supabaseUrl,
  supabaseAnonKey
);

// Clerk認証トークンを使用してSupabaseクライアントを作成
export function createClerkSupabaseClient(token?: string) {
  return createBrowserClient(
    supabaseUrl!,
    supabaseAnonKey!,
    {
      global: {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    }
  );
} 