import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from '@clerk/nextjs';
import { customJaJp } from '@/lib/clerk-custom-localization';
import Script from 'next/script';
import CookieConsent from '@/components/common/CookieConsent';
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ケアマニュアルAI",
  description: "介護施設向け特化型AIツール",
  viewport: {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
  },
};

// Analytics設定
const GA_TRACKING_ID = process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID;
const CLARITY_PROJECT_ID = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      localization={customJaJp}
      afterSignInUrl="/"
      afterSignUpUrl="/"
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
    >
      <html lang="ja">
        <head>
          {/* Cookie同意チェック用のスクリプト */}
          <Script id="cookie-consent-check" strategy="beforeInteractive">
            {`
              (function() {
                // Cookie同意状態を確認
                function checkCookieConsent() {
                  const cookieValue = document.cookie
                    .split('; ')
                    .find(row => row.startsWith('cookieConsent='));
                  
                  if (!cookieValue) {
                    const localConsent = localStorage.getItem('cookieConsent');
                    return localConsent === 'accepted';
                  }
                  
                  return cookieValue.split('=')[1] === 'accepted';
                }
                
                // 同意状態をグローバル変数に保存
                window.cookieConsentAccepted = checkCookieConsent();
                
                if (typeof window !== 'undefined' && window.cookieConsentAccepted) {
                  console.log('Cookie consent: accepted');
                } else {
                  console.log('Cookie consent: not accepted or pending');
                }
              })();
            `}
          </Script>
        </head>
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        >
          {/* Google Analytics - Cookie同意後に読み込み */}
          {GA_TRACKING_ID && (
            <>
              <Script
                src={`https://www.googletagmanager.com/gtag/js?id=${GA_TRACKING_ID}`}
                strategy="afterInteractive"
              />
              <Script id="google-analytics" strategy="afterInteractive">
                {`
                  window.dataLayer = window.dataLayer || [];
                  function gtag(){dataLayer.push(arguments);}
                  gtag('js', new Date());
                  
                  // Cookie同意状態を確認してからGA4を初期化
                  if (window.cookieConsentAccepted) {
                    gtag('config', '${GA_TRACKING_ID}', {
                      debug_mode: ${process.env.NODE_ENV === 'development' ? 'true' : 'false'}
                    });
                    
                    ${process.env.NODE_ENV === 'development' ? 
                      `console.log('Google Analytics initialized with ID:', '${GA_TRACKING_ID}');` : 
                      ''
                    }
                  } else {
                    // 同意が得られていない場合はトラッキングを無効化
                    gtag('config', '${GA_TRACKING_ID}', {
                      send_page_view: false,
                      debug_mode: ${process.env.NODE_ENV === 'development' ? 'true' : 'false'}
                    });
                    
                    ${process.env.NODE_ENV === 'development' ? 
                      `console.log('Google Analytics loaded but tracking disabled (no consent)');` : 
                      ''
                    }
                  }
                  
                  // Cookie同意状態変更のリスナー
                  window.addEventListener('cookieConsentChanged', function(e) {
                    if (e.detail.accepted) {
                      gtag('config', '${GA_TRACKING_ID}', {
                        debug_mode: ${process.env.NODE_ENV === 'development' ? 'true' : 'false'}
                      });
                      ${process.env.NODE_ENV === 'development' ? 
                        `console.log('Google Analytics enabled after consent');` : 
                        ''
                      }
                    } else {
                      gtag('config', '${GA_TRACKING_ID}', {
                        send_page_view: false
                      });
                      ${process.env.NODE_ENV === 'development' ? 
                        `console.log('Google Analytics disabled after consent withdrawal');` : 
                        ''
                      }
                    }
                  });
                `}
              </Script>
            </>
          )}

          {/* Microsoft Clarity - Cookie同意後に読み込み */}
          {CLARITY_PROJECT_ID && (
            <Script id="microsoft-clarity" strategy="afterInteractive">
              {`
                // Cookie同意状態を確認してからClarityを初期化
                if (window.cookieConsentAccepted) {
                  (function(c,l,a,r,i,t,y){
                      c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
                      t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
                      y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
                  })(window, document, "clarity", "script", "${CLARITY_PROJECT_ID}");
                  
                  ${process.env.NODE_ENV === 'development' ? 
                    `console.log('Microsoft Clarity initialized with ID:', '${CLARITY_PROJECT_ID}');` : 
                    ''
                  }
                } else {
                  ${process.env.NODE_ENV === 'development' ? 
                    `console.log('Microsoft Clarity not loaded (no consent)');` : 
                    ''
                  }
                }
                
                // Cookie同意状態変更のリスナー
                window.addEventListener('cookieConsentChanged', function(e) {
                  if (e.detail.accepted) {
                    (function(c,l,a,r,i,t,y){
                        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
                        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
                        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
                    })(window, document, "clarity", "script", "${CLARITY_PROJECT_ID}");
                    
                    ${process.env.NODE_ENV === 'development' ? 
                      `console.log('Microsoft Clarity enabled after consent');` : 
                      ''
                    }
                  } else {
                    if (window.clarity) {
                      window.clarity('stop');
                    }
                    ${process.env.NODE_ENV === 'development' ? 
                      `console.log('Microsoft Clarity disabled after consent withdrawal');` : 
                      ''
                    }
                  }
                });
              `}
            </Script>
          )}

          <CookieConsent
            domain={process.env.NEXT_PUBLIC_DOMAIN}
            subdomains={process.env.NEXT_PUBLIC_SUBDOMAINS?.split(',') || []}
          />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}

// TypeScript型定義の拡張
declare global {
  interface Window {
    gtag: (...args: unknown[]) => void;
    clarity: (action: string, ...args: unknown[]) => void;
    cookieConsentAccepted: boolean;
  }
}
