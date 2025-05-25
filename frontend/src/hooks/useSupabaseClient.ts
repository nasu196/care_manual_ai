import { useAuth } from '@clerk/nextjs';
import { createBrowserClient } from '@supabase/ssr';
import { useMemo } from 'react';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function useSupabaseClient() {
  const { getToken } = useAuth();

  return useMemo(() => {
    return createBrowserClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        global: {
          headers: async () => {
            const token = await getToken({ template: 'supabase' });
            return token ? { Authorization: `Bearer ${token}` } : {};
          },
        },
      }
    );
  }, [getToken]);
} 