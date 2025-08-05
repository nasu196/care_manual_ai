'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { X } from 'lucide-react';

// Window型はlayout.tsxで定義済み

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
      if (typeof document === 'undefined') return null;
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
      if (typeof window === 'undefined') return null;
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
    if (typeof document === 'undefined') return;
    
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
    if (typeof window === 'undefined') return;
    
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

  // 分析ツールの制御（改善版）
  const toggleAnalytics = useCallback((accepted: boolean) => {
    if (typeof window === 'undefined') return;
    
    // グローバル状態を更新
    window.cookieConsentAccepted = accepted;
    
    // カスタムイベントを発火
    window.dispatchEvent(new CustomEvent('cookieConsentChanged', {
      detail: { accepted: accepted }
    }));

    if (!accepted) {
      // 分析拒否時はCookie削除
      deleteAnalyticsCookies();
    }
  }, [deleteAnalyticsCookies]);

  // サブドメインに同期（改善版）
  const syncToSubdomains = useCallback((consentValue: string) => {
    if (typeof window === 'undefined') return;
    
    // 現在のホスト名を取得
    const currentHostname = window.location.hostname;
    const baseDomain = currentHostname.includes('.') 
      ? currentHostname.split('.').slice(-2).join('.')
      : currentHostname;
    
    // 同期すべきドメインを定義（自分自身は除外）
    const domainsToSync = [];
    
    if (currentHostname === `app.${baseDomain}`) {
      // app.care-manual-ai.comからcare-manual-ai.comに同期
      domainsToSync.push(baseDomain);
    } else if (currentHostname === baseDomain) {
      // care-manual-ai.comからapp.care-manual-ai.comに同期
      domainsToSync.push(`app.${baseDomain}`);
    }
    
    // 同期実行
    domainsToSync.forEach(targetDomain => {
      const syncUrl = `https://${targetDomain}/cookie-sync?consent=${consentValue}&from=${currentHostname}`;
      
      // 隠しiframeで同期
      const iframe = document.createElement('iframe');
      iframe.src = syncUrl;
      iframe.style.display = 'none';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = 'none';
      
      // エラーハンドリング
      iframe.onload = () => {
        // Sync completed
      };
      
      iframe.onerror = () => {
        console.error(`Cookie sync failed for: ${targetDomain}`);
      };
      
      document.body.appendChild(iframe);
      
      // 5秒後に安全に削除
      setTimeout(() => {
        try {
          if (iframe.parentNode) {
            document.body.removeChild(iframe);
          }
        } catch (error) {
          console.error('Error removing sync iframe:', error);
        }
      }, 5000);
    });
  }, []);

  // 同意状態の保存（リファレンス準拠版）
  const saveCookieConsent = useCallback((accepted: boolean) => {
    if (typeof window === 'undefined') {
      return;
    }
    
    try {
      const consentValue = accepted ? 'accepted' : 'declined';
      
      // 開発環境でのみログ出力（安全な方法）
      if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
        console.log('Cookie consent saved:', consentValue);
      }
      
      // 1. LocalStorageに保存
      localStorage.setItem('cookieConsent', consentValue);
      
      // 2. 同意履歴を保存
      const history = JSON.parse(localStorage.getItem('consentHistory') || '[]');
      history.push({
        action: consentValue,
        timestamp: new Date().toISOString(),
        origin: window.location.origin
      });
      localStorage.setItem('consentHistory', JSON.stringify(history));
      
      // 3. 親ドメインCookieに保存
      const hostname = window.location.hostname;
      const domain = hostname.includes('.') 
        ? '.' + hostname.split('.').slice(-2).join('.')
        : hostname;
      
      document.cookie = `cookieConsent=${consentValue}; path=/; domain=${domain}; max-age=31536000; SameSite=Lax`;
      
      // 4. サブドメインに同期
      syncToSubdomains(consentValue);
      
      // 5. 分析ツールの制御
      toggleAnalytics(accepted);
      
      // 6. バナーを非表示
      setShowBanner(false);
      
    } catch (error) {
      console.error('❌ Error saving cookie consent:', error);
    }
  }, [syncToSubdomains, toggleAnalytics]);

  // クロスドメイン通信のリスナー（改善版）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
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

  // 初期化（最終版）
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const consentStatus = getCookieConsentStatus();

    // シンプルなロジックに変更：未決定の場合のみバナー表示
    if (consentStatus === 'accepted' || consentStatus === 'declined' || consentStatus === 'rejected') {
      // 既に同意/拒否済み
      toggleAnalytics(consentStatus === 'accepted');
      setShowBanner(false);
    } else {
      // 未決定の場合
      setShowBanner(true);
    }
  }, [getCookieConsentStatus, toggleAnalytics, isLocalhost, actualDomain]);

  if (!showBanner) {
    return null;
  }

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
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm"
                >
                  同意する
                </Button>
                <Button
                  onClick={() => saveCookieConsent(false)}
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