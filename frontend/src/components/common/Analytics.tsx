'use client';

import { useEffect, useState, useCallback } from 'react';

interface AnalyticsProps {
  gaMeasurementId?: string;
  clarityProjectId?: string;
}

export default function Analytics({ gaMeasurementId, clarityProjectId }: AnalyticsProps) {
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const [scriptsLoaded, setScriptsLoaded] = useState(false);

  // Cookie同意状態を確認
  const checkCookieConsent = (): boolean => {
    try {
      // 1. 親ドメインCookieを確認
      const cookies = document.cookie.split(';');
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'cookieConsent') {
          return value === 'accepted';
        }
      }
      
      // 2. LocalStorageをフォールバック
      const localConsent = localStorage.getItem('cookieConsent');
      return localConsent === 'accepted';
    } catch (error) {
      console.error('Error checking cookie consent:', error);
      return false;
    }
  };

  // GA4スクリプトの動的追加
  const loadGoogleAnalytics = useCallback(() => {
    if (!gaMeasurementId) return;

    // GA4スクリプトの追加
    const script = document.createElement('script');
    script.src = `https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`;
    script.async = true;
    script.id = 'ga-script';
    document.head.appendChild(script);

    // GA4初期化
    script.onload = () => {
      const w = window as unknown as {
        dataLayer?: unknown[];
        gtag?: (...args: unknown[]) => void;
      };
      w.dataLayer = w.dataLayer || [];
      function gtag(...args: unknown[]) {
        w.dataLayer?.push(args);
      }
      w.gtag = gtag;
      
      gtag('js', new Date());
      gtag('config', gaMeasurementId, {
        // GA4のデフォルト設定を使用
        send_page_view: true,
        page_title: document.title,
        page_location: window.location.href
      });

      // グローバルにGA IDを保存してanalyticsライブラリから参照できるようにする
      (window as Window & { __GA_MEASUREMENT_ID__?: string }).__GA_MEASUREMENT_ID__ = gaMeasurementId;
    };
  }, [gaMeasurementId]);

  // Clarityスクリプトの動的追加
  const loadClarity = useCallback(() => {
    if (!clarityProjectId) return;

    // Clarityスクリプトの追加
    const script = document.createElement('script');
    script.innerHTML = `
      (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
      })(window, document, "clarity", "script", "${clarityProjectId}");
    `;
    script.id = 'clarity-script';
    document.head.appendChild(script);
  }, [clarityProjectId]);

  // 分析ツールの有効化
  const enableAnalytics = useCallback(() => {
    if (!scriptsLoaded) {
      loadGoogleAnalytics();
      loadClarity();
      setScriptsLoaded(true);
    }
    setAnalyticsEnabled(true);
  }, [scriptsLoaded, loadGoogleAnalytics, loadClarity]);

  // 分析ツールの無効化
  const disableAnalytics = useCallback(() => {
    setAnalyticsEnabled(false);
    
    // スクリプトの削除
    const gaScript = document.getElementById('ga-script');
    if (gaScript) gaScript.remove();
    
    const clarityScript = document.getElementById('clarity-script');
    if (clarityScript) clarityScript.remove();
    
    // 追加のClarityスクリプトも削除
    const clarityScripts = document.querySelectorAll('script[src*="clarity.ms"]');
    clarityScripts.forEach(script => script.remove());
    
    // グローバル変数の削除
    if (typeof window !== 'undefined') {
      const w = window as unknown as {
        gtag?: (...args: unknown[]) => void;
        clarity?: (command: string, ...args: unknown[]) => void;
        dataLayer?: unknown[];
      };
      delete w.gtag;
      delete w.clarity;
      delete w.dataLayer;
    }
    
    setScriptsLoaded(false);
  }, []);

  // カスタムイベントリスナー
  useEffect(() => {
    const handleEnableAnalytics = () => {
      enableAnalytics();
    };

    const handleDisableAnalytics = () => {
      disableAnalytics();
    };

    window.addEventListener('enableAnalytics', handleEnableAnalytics);
    window.addEventListener('disableAnalytics', handleDisableAnalytics);

    return () => {
      window.removeEventListener('enableAnalytics', handleEnableAnalytics);
      window.removeEventListener('disableAnalytics', handleDisableAnalytics);
    };
  }, [enableAnalytics, disableAnalytics]);

  // 初期化時にCookie同意状態を確認
  useEffect(() => {
    const consentAccepted = checkCookieConsent();
    if (consentAccepted) {
      enableAnalytics();
    }
  }, [enableAnalytics]);

  // 静的スクリプトの代わりに動的制御を使用
  return (
    <>
      {/* Cookie同意が得られた場合のみ分析ツールを有効化 */}
      {analyticsEnabled && scriptsLoaded && (
        <div style={{ display: 'none' }} aria-hidden="true">
          {/* スクリプトは動的に追加されるため、このdivは単なる表示用 */}
          Analytics Active
        </div>
      )}
    </>
  );
} 