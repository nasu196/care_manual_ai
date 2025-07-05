'use client';

import { useEffect, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function CookieSyncContent() {
  const searchParams = useSearchParams();
  
  useEffect(() => {
    const consent = searchParams.get('consent');
    const source = searchParams.get('source');
    
    if (consent && source) {
      try {
        // LocalStorageに同意状態を保存
        localStorage.setItem('cookieConsent', consent);
        
        // 親ウィンドウに通知
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            type: 'COOKIE_CONSENT',
            accepted: consent === 'accepted',
            source: source
          }, '*');
        }
        
        // 同意状態に応じて分析ツールを制御
        if (consent === 'accepted') {
          window.dispatchEvent(new CustomEvent('enableAnalytics'));
        } else {
          window.dispatchEvent(new CustomEvent('disableAnalytics'));
        }
        
        console.log(`Cookie consent synchronized: ${consent} from ${source}`);
        
      } catch (error) {
        console.error('Error synchronizing cookie consent:', error);
      }
    }
  }, [searchParams]);

  return (
    <div style={{ 
      padding: '20px', 
      fontFamily: 'Arial, sans-serif',
      backgroundColor: '#f5f5f5',
      minHeight: '100vh'
    }}>
      <h1>Cookie同期中...</h1>
      <p>Cookie同意状態を同期しています。このページは自動的に処理されます。</p>
      <div style={{ marginTop: '20px', fontSize: '12px', color: '#666' }}>
        <p>同期パラメータ:</p>
        <ul>
          <li>同意状態: {searchParams.get('consent') || '未指定'}</li>
          <li>送信元: {searchParams.get('source') || '未指定'}</li>
        </ul>
      </div>
    </div>
  );
}

export default function CookieSync() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <CookieSyncContent />
    </Suspense>
  );
} 