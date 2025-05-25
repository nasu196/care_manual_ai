import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// 環境変数の存在チェックを関数内で行う
function getSupabaseConfig() {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Supabase configuration missing:');
    console.error('SUPABASE_URL:', supabaseUrl);
    console.error('SUPABASE_ANON_KEY:', supabaseAnonKey ? 'Present' : 'Missing');
    throw new Error('Supabase URL and Anon Key are required.');
  }
  return { supabaseUrl, supabaseAnonKey };
}

// 基本的なSupabaseクライアント（認証なし）
export const supabase: SupabaseClient | null = (() => {
  try {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig();
    return createBrowserClient(supabaseUrl, supabaseAnonKey);
  } catch (error) {
    console.error('Failed to create Supabase client:', error);
    // フォールバック用のnullを返す
    return null;
  }
})();

// Clerk認証トークンを使用してSupabaseクライアントを作成
export function createClerkSupabaseClient(token?: string) {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig();
  return createBrowserClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      global: {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    }
  );
} 