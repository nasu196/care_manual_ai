import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// 保護が必要なルートを定義
const isProtectedRoute = createRouteMatcher([
  '/',
  '/dashboard(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
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