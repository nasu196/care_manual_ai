import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from '@clerk/nextjs';
import { customJaJp } from '@/lib/clerk-custom-localization';
import Analytics from '@/components/common/Analytics';
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
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        >
          <Analytics
            gaMeasurementId={process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID}
            clarityProjectId={process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID}
          />
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
