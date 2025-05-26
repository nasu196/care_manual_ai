"use client";

import { useAuth } from '@clerk/nextjs';
import { useState } from 'react';

export default function DebugPage() {
  const { getToken } = useAuth();
  const [debugInfo, setDebugInfo] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const handleDebug = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        setDebugInfo({ error: 'No token available' });
        return;
      }

      const response = await fetch('/api/supabase-proxy/debug-auth', {
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
    <div className="container mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">🔍 Clerk JWT Debug</h1>
      
      <button
        onClick={handleDebug}
        disabled={loading}
        className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
      >
        {loading ? 'デバッグ中...' : 'JWT情報を確認'}
      </button>

      {debugInfo && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-4">デバッグ結果:</h2>
          <pre className="bg-gray-100 p-4 rounded-lg text-sm overflow-auto max-h-96 border">
            {JSON.stringify(debugInfo, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
} 