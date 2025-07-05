'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface DebugInfo {
  env: {
    domain: string;
    subdomains: string;
    gaId: string;
    clarityId: string;
  };
  current: {
    hostname: string;
    origin: string;
    cookies: string;
    localStorage: string | null;
  };
  consentCheck: {
    parentCookie: string | null;
    localStorage: string | null;
    finalStatus: string | null;
  };
}

export default function CookieConsentDebug() {
  const [debugInfo, setDebugInfo] = useState<DebugInfo>({} as DebugInfo);
  const [isVisible, setIsVisible] = useState(false);

  // CookieConsentコンポーネントと同じ関数を複製
  const checkCookieConsentFromParent = useCallback((): string | null => {
    try {
      const cookies = document.cookie.split(';');
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'cookieConsent') {
          return value;
        }
      }
      return null;
    } catch (error) {
      console.error('Error checking parent cookie:', error);
      return null;
    }
  }, []);

  const checkCookieConsentFromLocal = useCallback((): string | null => {
    try {
      return localStorage.getItem('cookieConsent');
    } catch (error) {
      console.error('Error checking local storage:', error);
      return null;
    }
  }, []);

  const getCookieConsentStatus = useCallback((): string | null => {
    const parentConsent = checkCookieConsentFromParent();
    if (parentConsent) return parentConsent;
    
    const localConsent = checkCookieConsentFromLocal();
    if (localConsent) return localConsent;
    
    return null;
  }, [checkCookieConsentFromParent, checkCookieConsentFromLocal]);

  const collectDebugInfo = useCallback(() => {
    const info = {
      // 環境変数
      env: {
        domain: process.env.NEXT_PUBLIC_DOMAIN || 'undefined',
        subdomains: process.env.NEXT_PUBLIC_SUBDOMAINS || 'undefined',
        gaId: process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID || 'undefined',
        clarityId: process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID || 'undefined',
      },
      // 現在の状態
      current: {
        hostname: window.location.hostname,
        origin: window.location.origin,
        cookies: document.cookie,
        localStorage: localStorage.getItem('cookieConsent'),
      },
      // Cookie同意状態チェック
      consentCheck: {
        parentCookie: checkCookieConsentFromParent(),
        localStorage: checkCookieConsentFromLocal(),
        finalStatus: getCookieConsentStatus(),
      }
    };
    setDebugInfo(info);
  }, [checkCookieConsentFromParent, checkCookieConsentFromLocal, getCookieConsentStatus]);

  const clearAllConsent = () => {
    // LocalStorageクリア
    localStorage.removeItem('cookieConsent');
    
    // Cookieクリア
    document.cookie = 'cookieConsent=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    document.cookie = 'cookieConsent=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=localhost';
    document.cookie = 'cookieConsent=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.localhost';
    
    alert('Cookie同意状態をクリアしました。ページを再読み込みしてください。');
    window.location.reload();
  };

  useEffect(() => {
    collectDebugInfo();
  }, [collectDebugInfo]);

  if (!isVisible) {
    return (
      <div className="fixed top-4 right-4 z-50">
        <Button
          onClick={() => setIsVisible(true)}
          className="bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1"
        >
          🐛 Cookie Debug
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed top-4 right-4 z-50 max-w-md">
      <Card className="border-2 border-red-200 bg-white shadow-lg">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex justify-between items-center">
            Cookie同意デバッグ
            <button
              onClick={() => setIsVisible(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-3">
          <div>
            <strong>環境変数:</strong>
            <pre className="bg-gray-100 p-2 rounded text-xs overflow-x-auto">
              {JSON.stringify(debugInfo.env, null, 2)}
            </pre>
          </div>
          
          <div>
            <strong>現在の状態:</strong>
            <pre className="bg-gray-100 p-2 rounded text-xs overflow-x-auto">
              {JSON.stringify(debugInfo.current, null, 2)}
            </pre>
          </div>
          
          <div>
            <strong>同意状態チェック:</strong>
            <pre className="bg-gray-100 p-2 rounded text-xs overflow-x-auto">
              {JSON.stringify(debugInfo.consentCheck, null, 2)}
            </pre>
          </div>
          
          <div className="flex gap-2">
            <Button
              onClick={collectDebugInfo}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1"
            >
              更新
            </Button>
            <Button
              onClick={clearAllConsent}
              className="bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1"
            >
              同意状態クリア
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 