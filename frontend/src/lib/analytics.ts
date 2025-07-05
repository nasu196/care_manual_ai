// Google Analytics 4 event tracking utility
declare global {
  interface Window {
    gtag: (...args: unknown[]) => void;
    clarity: (command: string, ...args: unknown[]) => void;
  }
}

export const gtag = (...args: unknown[]) => {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag(...args);
  }
};

// GA4イベントトラッキング関数
export const trackEvent = (action: string, category: string, label?: string, value?: number) => {
  gtag('event', action, {
    event_category: category,
    event_label: label,
    value: value,
  });
};

// ページビュー追跡
export const trackPageView = (url: string) => {
  gtag('config', process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID, {
    page_title: document.title,
    page_location: url,
  });
};

// カスタムイベント追跡
export const trackCustomEvent = (eventName: string, parameters?: Record<string, unknown>) => {
  gtag('event', eventName, parameters);
};

// Microsoft Clarityイベントトラッキング
export const clarityTrack = (eventName: string, properties?: Record<string, unknown>) => {
  if (typeof window !== 'undefined' && window.clarity) {
    window.clarity('set', eventName, properties);
  }
};

// 共通のイベントトラッキング関数
export const analytics = {
  // ページビュー
  pageView: (url: string) => {
    trackPageView(url);
  },
  
  // ユーザーアクション
  userAction: (action: string, category: string, label?: string) => {
    trackEvent(action, category, label);
  },
  
  // エラー追跡
  error: (error: string, fatal: boolean = false) => {
    trackEvent('exception', 'error', error);
    gtag('event', 'exception', {
      description: error,
      fatal: fatal,
    });
  },
  
  // 検索イベント
  search: (searchTerm: string) => {
    trackEvent('search', 'engagement', searchTerm);
  },
  
  // ファイルアップロード
  fileUpload: (fileType: string, fileSize: number) => {
    trackEvent('file_upload', 'engagement', fileType, fileSize);
  },
  
  // フィードバック送信
  feedback: (rating: number, category: string) => {
    trackEvent('feedback', 'engagement', category, rating);
  },
}; 