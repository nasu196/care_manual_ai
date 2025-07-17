import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

// Sentry設定をインポート
import { initSentry, captureError, startSpan, logger } from '../_shared/sentry.ts';

// Sentryを初期化
initSentry();

console.log('Sentry test function up and running!');

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  return startSpan(
    {
      op: "test.function",
      name: "sentry-test-handler",
      attributes: { method: req.method }
    },
    async (span) => {
      try {
        logger.info("Sentry test function called", { method: req.method });
        
        const url = new URL(req.url);
        const testType = url.searchParams.get('test') || 'info';
        
        span.setAttribute("test_type", testType);
        
        switch (testType) {
          case 'error':
            logger.error("Test error message", { testType: 'error' });
            throw new Error("This is a test error for Sentry");
            
          case 'warn':
            logger.warn("Test warning message", { testType: 'warn' });
            return new Response(JSON.stringify({ 
              message: "Warning test completed",
              test: testType 
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 200
            });
            
          case 'capture':
            const testError = new Error("Captured test error");
            captureError(testError, { function: 'sentry-test', test: 'capture' });
            return new Response(JSON.stringify({ 
              message: "Error capture test completed",
              test: testType 
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 200
            });
            
          default:
            logger.info("Default info test", { testType: 'info' });
            return new Response(JSON.stringify({ 
              message: "Sentry test function working",
              test: testType,
              environment: (globalThis as any).Deno?.env?.get("SUPABASE_PROJECT_REF") === "axfcggmldezzvhpowtwn" ? "development" : "production"
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 200
            });
        }
      } catch (error) {
        logger.error("Function execution failed", { error });
        captureError(error, { function: 'sentry-test', phase: 'execution' });
        
        return new Response(JSON.stringify({ 
          error: error instanceof Error ? error.message : "Unknown error",
          test: "error-handling"
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500
        });
      }
    }
  );
}); 