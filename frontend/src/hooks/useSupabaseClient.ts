import { useAuth } from '@clerk/nextjs';
import { createBrowserClient, SupabaseClient } from '@supabase/ssr';
import { useState, useEffect, useMemo } from 'react';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function useSupabaseClient() {
  const { getToken, userId, isSignedIn } = useAuth();
  // Supabaseクライアントのインスタンスを保持するstate
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  // クライアントがClerkと同期済みかを示すフラグ
  const [isSynced, setIsSynced] = useState(false);


  // Supabaseクライアントインスタンスの作成 (一度だけ実行)
  const memoizedSupabase = useMemo(() => {
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Supabase URL or Anon Key is missing');
      // エラーをスローする代わりに null を返すか、あるいはエラーハンドリングを強化
      return null; 
    }
    try {
      return createBrowserClient(supabaseUrl, supabaseAnonKey);
    } catch (error) {
      console.error("Failed to create Supabase client:", error);
      return null;
    }
  }, []); // 依存配列なしで初回のみ作成


  useEffect(() => {
    if (memoizedSupabase) {
      if (isSignedIn && userId) {
        // ユーザーがClerkで認証済みの場合
        const setSupabaseSession = async () => {
          try {
            const token = await getToken({ template: 'supabase' });
            if (token) {
              // SupabaseクライアントにClerkのトークンでセッションを設定
              // refresh_token はClerk側で管理されるため、ここではaccess_tokenのみ設定
              const { error } = await memoizedSupabase.auth.setSession({
                access_token: token,
                refresh_token: '', // refresh_tokenはClerkが管理するので空
              });
              if (error) {
                console.error('Supabase setSession error:', error);
                setIsSynced(false);
              } else {
                console.log('Supabase session set with Clerk token for user:', userId);
                setIsSynced(true);
              }
            } else {
              console.warn('Clerk token not available for Supabase session.');
              // トークンがない場合はセッションをクリアすることも検討
              await memoizedSupabase.auth.signOut(); // Supabase側のセッションをクリア
              setIsSynced(false);
            }
          } catch (e) {
            console.error('Error setting Supabase session with Clerk token:', e);
            setIsSynced(false);
          }
        };
        setSupabaseSession();
      } else {
        // Clerkで未認証の場合、Supabaseのセッションもクリア
        const clearSupabaseSession = async () => {
          try {
            await memoizedSupabase.auth.signOut();
            console.log('Supabase session cleared due to Clerk sign out.');
          } catch (e) {
            console.error('Error clearing Supabase session:', e);
          } finally {
            setIsSynced(false); // 同期解除
          }
        };
        clearSupabaseSession();
      }
      setSupabase(memoizedSupabase); // supabase stateを更新
    }
  }, [isSignedIn, userId, getToken, memoizedSupabase]); // Clerkの認証状態が変わったら再実行

  // isSyncedがtrueになるまで、あるいはsupabaseクライアントがnullの場合はnullを返す
  // これにより、呼び出し元はクライアントが準備できているかを確認できる
  return { supabaseClient: supabase, isSupabaseReady: supabase && isSynced };
} 