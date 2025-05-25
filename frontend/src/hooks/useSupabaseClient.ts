import { useAuth } from '@clerk/nextjs';
// import { createBrowserClient, SupabaseClient } from '@supabase/ssr'; // SSR版をコメントアウト
import { createClient, SupabaseClient } from '@supabase/supabase-js'; // 通常版をインポート
import { useState, useEffect } from 'react';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function useSupabaseClient() {
  const { getToken, userId, isSignedIn } = useAuth();
  // Supabaseクライアントのインスタンスを保持するstate
  const [supabaseClient, setSupabaseClient] = useState<SupabaseClient | null>(null);
  // クライアントがClerkと同期済みかを示すフラグ
  const [isSupabaseReady, setIsSupabaseReady] = useState(false);

  useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('[useSupabaseClient] Supabase URL or Anon Key is missing.');
      setIsSupabaseReady(false);
      setSupabaseClient(null);
      return;
    }

    // `getToken` が利用可能になるまで待つために `getToken` も依存配列に含める
    if (isSignedIn && typeof getToken === 'function') {
      console.log('[useSupabaseClient] User is signed in and getToken is available. Creating Supabase client.');
      try {
        const client = createClient(supabaseUrl, supabaseAnonKey, {
          global: {
            fetch: async (url, options = {}) => {
              // `getToken` が null や undefined でないことを確認してから呼び出す
              if (typeof getToken !== 'function') {
                console.error('[useSupabaseClient fetch] getToken is not a function.');
                throw new Error('getToken is not available for Supabase request.');
              }
              const token = await getToken({ template: 'supabase' });
              if (!token) {
                console.warn('[useSupabaseClient fetch] Clerk token not available.');
                throw new Error('Clerk token not available for Supabase request.');
              }

              const headers = new Headers(options.headers);
              headers.set('Authorization', `Bearer ${token}`);

              return fetch(url, {
                ...options,
                headers,
              });
            },
          },
        });
        setSupabaseClient(client);
        setIsSupabaseReady(true);
        console.log('[useSupabaseClient] Supabase client created and ready.');
      } catch (error) {
        console.error('[useSupabaseClient] Error creating Supabase client:', error);
        setIsSupabaseReady(false);
        setSupabaseClient(null);
      }
    } else {
      console.log('[useSupabaseClient] User not signed in or getToken is not ready. Clearing Supabase client.');
      setSupabaseClient(null);
      setIsSupabaseReady(false);
    }
  }, [isSignedIn, getToken]); // getToken の準備状態も監視

  return { supabaseClient, userId, isSignedIn, isSupabaseReady };
} 