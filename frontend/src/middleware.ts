import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// 保護が必要なルートを定義
const isProtectedRoute = createRouteMatcher([
  '/',
  '/dashboard(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  // 共有ページ（shareIdパラメータがある場合）は認証をスキップ
  const url = new URL(req.url);
  const shareId = url.searchParams.get('shareId');
  
  if (shareId) {
    // 共有ページの場合は認証をスキップ
    return;
  }
  
  // 保護が必要なルートの場合、認証をチェック
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}; 