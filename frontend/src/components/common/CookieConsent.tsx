'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { X } from 'lucide-react';

// Window オブジェクトの型を拡張
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    clarity?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

interface CookieConsentProps {
  domain?: string;
  subdomains?: string[];
  allowedOrigins?: string[];
}

export default function CookieConsent({
  domain = 'care-manual-ai.com',
  subdomains = ['app', 'api'],
  allowedOrigins = []
}: CookieConsentProps) {
  const [showBanner, setShowBanner] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // localhost環境の判定
  const isLocalhost = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' || 
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.endsWith('.localhost')
  );

  // 実際のドメインを決定（localhost環境ではlocalhostを使用）
  const actualDomain = isLocalhost ? 'localhost' : (domain || 'care-manual-ai.com');

  // 自動的に許可されたオリジンを生成
  const defaultAllowedOrigins = isLocalhost 
    ? ['http://localhost:3000', 'http://127.0.0.1:3000']
    : [
        `https://${actualDomain}`,
        ...subdomains.map(sub => `https://${sub}.${actualDomain}`)
      ];
  const finalAllowedOrigins = allowedOrigins.length > 0 ? allowedOrigins : defaultAllowedOrigins;

  // 親ドメインCookieから同意状態を確認
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

  // LocalStorageから同意状態を確認
  const checkCookieConsentFromLocal = useCallback((): string | null => {
    try {
      return localStorage.getItem('cookieConsent');
    } catch (error) {
      console.error('Error checking local storage:', error);
      return null;
    }
  }, []);

  // 同意状態の総合判定
  const getCookieConsentStatus = useCallback((): string | null => {
    // 1. 親ドメインCookieを優先
    const parentConsent = checkCookieConsentFromParent();
    if (parentConsent) return parentConsent;

    // 2. LocalStorageをフォールバック
    const localConsent = checkCookieConsentFromLocal();
    if (localConsent) return localConsent;

    return null;
  }, [checkCookieConsentFromParent, checkCookieConsentFromLocal]);

  // Cookie削除関数
  const deleteCookie = useCallback((name: string) => {
    const domains = isLocalhost
      ? ['', 'localhost', '.localhost']
      : [
          '',
          `.${actualDomain}`,
          window.location.hostname,
          `.${window.location.hostname}`
        ];
    const paths = ['/', '/app/', '/api/'];

    domains.forEach(domainToDelete => {
      paths.forEach(path => {
        if (domainToDelete) {
          document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}; domain=${domainToDelete}`;
        } else {
          document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}`;
        }
      });
    });
  }, [isLocalhost, actualDomain]);

  // 分析ツールのCookie削除
  const deleteAnalyticsCookies = useCallback(() => {
    // Google Analytics Cookies
    const gaCookies = ['_ga', '_gid', '_gat', '_gat_gtag_UA', '_gat_gtag_G'];
    gaCookies.forEach(deleteCookie);

    // Microsoft Clarity Cookies
    const clarityCookies = ['_clck', '_clsk', 'CLID', 'ANONCHK', 'SM'];
    clarityCookies.forEach(deleteCookie);

    // 動的に存在するGAクッキーも削除
    document.cookie.split(';').forEach(cookie => {
      const name = cookie.split('=')[0].trim();
      if (name.startsWith('_ga') || name.startsWith('_gat') || name.startsWith('_clck')) {
        deleteCookie(name);
      }
    });
  }, [deleteCookie]);

  // 分析ツールの有効化/無効化
  const toggleAnalytics = useCallback((enabled: boolean) => {
    if (enabled) {
      // 分析ツールを有効化（Analytics.tsxで処理）
      window.dispatchEvent(new CustomEvent('enableAnalytics'));
    } else {
      // 分析ツールを無効化
      window.dispatchEvent(new CustomEvent('disableAnalytics'));
      
      // Cookieを削除
      deleteAnalyticsCookies();
      
      // グローバル変数の削除
      if (typeof window !== 'undefined') {
        delete window.gtag;
        delete window.clarity;
        delete window.dataLayer;
      }
    }
  }, [deleteAnalyticsCookies]);

  // 同意状態の保存
  const saveCookieConsent = async (accepted: boolean) => {
    setIsLoading(true);
    
    try {
      const consentValue = accepted ? 'accepted' : 'declined';
      
      // 1. LocalStorageに保存
      localStorage.setItem('cookieConsent', consentValue);
      
      // 2. 親ドメインCookieに保存
      const expires = new Date();
      expires.setFullYear(expires.getFullYear() + 1); // 1年後
      
      if (isLocalhost) {
        // localhost環境ではドメイン指定なしでCookieを設定
        document.cookie = `cookieConsent=${consentValue}; expires=${expires.toUTCString()}; path=/`;
      } else {
        // 本番環境では親ドメインを指定
        document.cookie = `cookieConsent=${consentValue}; expires=${expires.toUTCString()}; path=/; domain=.${actualDomain}`;
      }
      
      // 3. 分析ツールの制御
      toggleAnalytics(accepted);
      
      // 4. クロスドメイン同期
      await syncConsentAcrossDomains(consentValue);
      
      setShowBanner(false);
      
    } catch (error) {
      console.error('Error saving cookie consent:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // クロスドメイン同期
  const syncConsentAcrossDomains = async (consent: string) => {
    const promises = subdomains.map(async (subdomain) => {
      try {
        const targetOrigin = `https://${subdomain}.${domain}`;
        
        // iframeを使った同期
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = `${targetOrigin}/cookie-sync?consent=${consent}&source=${window.location.hostname}`;
        
        document.body.appendChild(iframe);
        
        // 3秒後にiframeを削除
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 3000);
        
      } catch (error) {
        console.error(`Error syncing with ${subdomain}:`, error);
      }
    });
    
    await Promise.allSettled(promises);
  };

  // クロスドメイン通信のリスナー
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // オリジン検証
      if (!finalAllowedOrigins.includes(event.origin)) {
        console.warn('Received message from unauthorized origin:', event.origin);
        return;
      }

      if (event.data.type === 'COOKIE_CONSENT') {
        const { accepted, source } = event.data;
        
        if (source !== window.location.hostname) {
          // 他のドメインからの同意状態を受信
          localStorage.setItem('cookieConsent', accepted ? 'accepted' : 'declined');
          toggleAnalytics(accepted);
          setShowBanner(false);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [finalAllowedOrigins, toggleAnalytics]);

  // 初期化
  useEffect(() => {
    const consentStatus = getCookieConsentStatus();
    
    if (consentStatus === 'accepted') {
      toggleAnalytics(true);
      setShowBanner(false);
    } else if (consentStatus === 'declined') {
      toggleAnalytics(false);
      setShowBanner(false);
    } else {
      setShowBanner(true);
    }
  }, [getCookieConsentStatus, toggleAnalytics]);

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:right-4 md:max-w-md">
      <Card className="border-2 border-blue-200 bg-white shadow-lg">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 mb-2">
                Cookie使用について
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                当サイトでは、サービス向上のためにGoogle AnalyticsとMicrosoft Clarityを使用しています。
                これらのツールは分析用Cookieを使用します。
                詳しくは
                <a 
                  href="https://www.t-north.jp/privacy-policy" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 underline mx-1"
                >
                  プライバシーポリシー
                </a>
                をご確認ください。
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button
                  onClick={() => saveCookieConsent(true)}
                  disabled={isLoading}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm"
                >
                  {isLoading ? '処理中...' : '同意する'}
                </Button>
                <Button
                  onClick={() => saveCookieConsent(false)}
                  disabled={isLoading}
                  variant="outline"
                  className="px-4 py-2 text-sm"
                >
                  拒否する
                </Button>
              </div>
            </div>
            <button
              onClick={() => setShowBanner(false)}
              className="text-gray-400 hover:text-gray-600 flex-shrink-0"
              aria-label="バナーを閉じる"
            >
              <X size={16} />
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 