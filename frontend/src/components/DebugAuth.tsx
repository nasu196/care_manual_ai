"use client";

import { useAuth } from '@clerk/nextjs';
import { useState } from 'react';

export default function DebugAuth() {
  const { getToken } = useAuth();
  const [debugInfo, setDebugInfo] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const handleDebug = async () => {
    setLoading(true);
    try {
      const token = await getToken({ template: 'supabase' });
      if (!token) {
        setDebugInfo({ error: 'No token available' });
        return;
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        setDebugInfo({ error: 'Supabase URL not configured' });
        return;
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/debug-auth`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();
      setDebugInfo(result);
    } catch (error) {
      setDebugInfo({ error: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 border rounded-lg bg-gray-50">
      <h3 className="text-lg font-semibold mb-4">🔍 Clerk JWT Debug</h3>
      
      <button
        onClick={handleDebug}
        disabled={loading}
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
      >
        {loading ? 'デバッグ中...' : 'JWT情報を確認'}
      </button>

      {debugInfo && (
        <div className="mt-4">
          <h4 className="font-semibold mb-2">デバッグ結果:</h4>
          <pre className="bg-white p-3 rounded border text-sm overflow-auto max-h-96">
            {JSON.stringify(debugInfo, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
} 