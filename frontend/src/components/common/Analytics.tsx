'use client';

import { useEffect, useState, useCallback } from 'react';

interface AnalyticsProps {
  gaMeasurementId?: string;
  clarityProjectId?: string;
}

export default function Analytics({ gaMeasurementId, clarityProjectId }: AnalyticsProps) {
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const [scriptsLoaded, setScriptsLoaded] = useState(false);

  // 本番環境用: エラーのみログ出力
  useEffect(() => {
    // 開発環境でのみログ出力（安全な方法）
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
      console.log('Analytics initialized:', {
        gaId: gaMeasurementId ? 'Set' : 'Missing',
        clarityId: clarityProjectId ? 'Set' : 'Missing',
        enabled: analyticsEnabled
      });
    }
  }, [gaMeasurementId, clarityProjectId, analyticsEnabled]);

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

  // GA4スクリプトの動的追加（公式標準準拠・修正版）
  const loadGoogleAnalytics = useCallback(() => {
    if (!gaMeasurementId) return;
    if (typeof window === 'undefined') return;

    // 型安全なwindow拡張
    const w = window as Window & {
      __GA_INITIALIZED__?: string;
      dataLayer?: unknown[];
      gtag?: (...args: unknown[]) => void;
    };
    
    // より詳細な重複チェック
    if (w.__GA_INITIALIZED__ === gaMeasurementId) {
      console.log('GA4 already initialized for this measurement ID');
      return;
    }

    // 1. dataLayerとgtag関数をグローバル定義（公式標準）
    w.dataLayer = w.dataLayer || [];
    if (!w.gtag) {
      w.gtag = function(...args: unknown[]) {
        w.dataLayer?.push(args);
      };
    }

    // 2. スクリプトを動的追加
    const script = document.createElement('script');
    script.src = `https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`;
    script.async = true;
    script.id = 'ga-script';
    
    // 3. スクリプト読み込み完了後に初期化（公式準拠）
    script.onload = () => {
      if (!w.gtag) return;
      
      // 基本初期化
      w.gtag('js', new Date());
      w.gtag('config', gaMeasurementId, {
        // ページビュー自動送信を有効化
        send_page_view: true,
        // セッション情報を含める
        cookie_flags: 'SameSite=None;Secure'
      });
      
      // 明示的にページビューイベント送信（動的読み込み用）
      w.gtag('event', 'page_view', {
        page_title: document.title,
        page_location: window.location.href,
        page_referrer: document.referrer
      });
      
      w.__GA_INITIALIZED__ = gaMeasurementId;
      console.log('GA4 initialized and page_view sent');
    };
    
    script.onerror = () => {
      console.error('Failed to load GA4 script');
    };
    
    document.head.appendChild(script);

    // グローバルにGA IDを保存（分析ライブラリ用）
    (window as Window & { __GA_MEASUREMENT_ID__?: string }).__GA_MEASUREMENT_ID__ = gaMeasurementId;
    
  }, [gaMeasurementId]);

  // Clarityスクリプトの動的追加
  const loadClarity = useCallback(() => {
    if (!clarityProjectId) {
      console.warn('Clarity Project ID is not set:', clarityProjectId);
      return;
    }

    // 既存のClarityスクリプトを削除
    const existingScript = document.getElementById('clarity-script');
    if (existingScript) {
      existingScript.remove();
    }

    // Clarityスクリプトの追加（修正版）
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.id = 'clarity-script';
    
    // スクリプトの内容を直接実行する形で追加
    script.text = `
      (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i+"?ref=bwt";
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
      })(window, document, "clarity", "script", "${clarityProjectId}");
    `;
    
    document.head.appendChild(script);
    
    // 開発環境でのみログ出力（安全な方法）
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
      console.log('✅ Clarity script added');
    }
    
  }, [clarityProjectId]);

  // 分析ツールの有効化
  const enableAnalytics = useCallback(() => {
    console.log('🚀 enableAnalytics called');
    console.log('- About to call loadGoogleAnalytics');
    console.log('- About to call loadClarity');
    
    // 常にスクリプトを再読み込み（重複は各関数内で処理）
    loadGoogleAnalytics();
    loadClarity();
    
    setScriptsLoaded(true);
    setAnalyticsEnabled(true);
    
    console.log('✅ enableAnalytics completed');
  }, [loadGoogleAnalytics, loadClarity]);

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
      const w = window as Window & {
        gtag?: (...args: unknown[]) => void;
        clarity?: (command: string, ...args: unknown[]) => void;
        dataLayer?: unknown[];
        __GA_INITIALIZED__?: string;
      };
      (w as { gtag?: unknown }).gtag = undefined;
      (w as { clarity?: unknown }).clarity = undefined;
      (w as { dataLayer?: unknown }).dataLayer = undefined;
      (w as { __GA_INITIALIZED__?: unknown }).__GA_INITIALIZED__ = undefined;
    }
    
    setScriptsLoaded(false);
  }, []);

  // カスタムイベントリスナー
  useEffect(() => {
    console.log('📡 Setting up custom event listeners');
    
    const handleEnableAnalytics = () => {
      console.log('📡 Received enableAnalytics event');
      enableAnalytics();
    };

    const handleDisableAnalytics = () => {
      console.log('🛑 Received disableAnalytics event');
      disableAnalytics();
    };

    window.addEventListener('enableAnalytics', handleEnableAnalytics);
    window.addEventListener('disableAnalytics', handleDisableAnalytics);
    
    console.log('✅ Custom event listeners attached');

    return () => {
      console.log('🗑️ Removing custom event listeners');
      window.removeEventListener('enableAnalytics', handleEnableAnalytics);
      window.removeEventListener('disableAnalytics', handleDisableAnalytics);
    };
  }, [enableAnalytics, disableAnalytics]);

  // 初期化時にCookie同意状態を確認
  useEffect(() => {
    console.log('🔄 Analytics initialization useEffect called');
    const consentAccepted = checkCookieConsent();
    console.log('- Cookie consent check result:', consentAccepted);
    
    if (consentAccepted) {
      console.log('✅ Cookie consent accepted, calling enableAnalytics');
      enableAnalytics();
    } else {
      console.log('❌ Cookie consent not accepted, analytics not enabled');
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