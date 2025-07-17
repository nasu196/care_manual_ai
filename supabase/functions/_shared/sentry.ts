import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Edge Functions用の軽量Sentry設定
// 本格的なSentryライブラリが利用できない場合のフォールバック実装

// Deno環境の型定義
declare global {
  namespace Deno {
    namespace env {
      function get(key: string): string | undefined;
    }
  }
}

interface SentryConfig {
  dsn: string;
  environment: string;
  enabled: boolean;
}

const sentryConfig: SentryConfig = {
  dsn: "https://e40ddc44c97e8338586ccbb98cfe2d25@o4509681418764288.ingest.us.sentry.io/4509681436655616",
  environment: (globalThis as any).Deno?.env?.get("SUPABASE_PROJECT_REF") === "axfcggmldezzvhpowtwn" ? "development" : "production",
  enabled: true,
};

// Sentryへのエラー送信
async function sendToSentry(data: any) {
  if (!sentryConfig.enabled) return;
  
  try {
    const envelope = {
      event_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      platform: "javascript",
      environment: sentryConfig.environment,
      ...data,
    };

    const response = await fetch(`${sentryConfig.dsn.replace('https://', 'https://').replace('@', '/api/').replace('/', '/envelope/')}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(envelope),
    });

    if (!response.ok) {
      console.warn("[Sentry] Failed to send event:", response.status);
    }
  } catch (error) {
    console.warn("[Sentry] Error sending to Sentry:", error);
  }
}

// Edge Functions用のSentry初期化
export function initSentry() {
  console.log(`[Sentry] Initialized for environment: ${sentryConfig.environment}`);
}

// Edge Functions用のエラーキャプチャ関数
export function captureError(error: unknown, context?: Record<string, any>) {
  try {
    console.error("[Edge Function Error]", error, context);
    
    if (error instanceof Error) {
      sendToSentry({
        level: "error",
        message: error.message,
        exception: {
          values: [{
            type: error.name,
            value: error.message,
            stacktrace: {
              frames: error.stack ? [{ filename: "edge-function", function: "unknown" }] : []
            }
          }]
        },
        tags: {
          component: "edge-function",
          ...context,
        },
      });
    } else {
      sendToSentry({
        level: "error",
        message: `Non-error thrown: ${String(error)}`,
        tags: {
          component: "edge-function",
          ...context,
        },
      });
    }
  } catch (sentryError) {
    console.error("[Sentry] Failed to capture error:", sentryError);
  }
}

// Edge Functions用のスパン作成ヘルパー
export function startSpan<T>(
  spanOptions: { op: string; name: string; attributes?: Record<string, any> },
  fn: (span: any) => T
): T {
  const start = performance.now();
  console.log(`[Sentry Span] Starting: ${spanOptions.name} (${spanOptions.op})`);
  
  try {
    const result = fn({
      setAttribute: (key: string, value: any) => {
        console.log(`[Sentry Span] ${spanOptions.name} - ${key}: ${value}`);
      }
    });
    
    const duration = performance.now() - start;
    console.log(`[Sentry Span] Completed: ${spanOptions.name} (${duration.toFixed(2)}ms)`);
    
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    console.error(`[Sentry Span] Failed: ${spanOptions.name} (${duration.toFixed(2)}ms)`, error);
    captureError(error, { span_name: spanOptions.name, span_op: spanOptions.op });
    throw error;
  }
}

// 構造化ログ
export const logger = {
  trace: (message: string, data?: Record<string, any>) => {
    console.log(`[TRACE] ${message}`, data);
  },
  debug: (message: string, data?: Record<string, any>) => {
    console.log(`[DEBUG] ${message}`, data);
  },
  info: (message: string, data?: Record<string, any>) => {
    console.log(`[INFO] ${message}`, data);
  },
  warn: (message: string, data?: Record<string, any>) => {
    console.warn(`[WARN] ${message}`, data);
    sendToSentry({
      level: "warning",
      message,
      extra: data,
    });
  },
  error: (message: string, data?: Record<string, any>) => {
    console.error(`[ERROR] ${message}`, data);
    sendToSentry({
      level: "error", 
      message,
      extra: data,
    });
  },
  fatal: (message: string, data?: Record<string, any>) => {
    console.error(`[FATAL] ${message}`, data);
    sendToSentry({
      level: "fatal",
      message,
      extra: data,
    });
  },
  fmt: (strings: TemplateStringsArray, ...values: any[]) => {
    return strings.reduce((result, string, i) => {
      return result + string + (values[i] || '');
    }, '');
  },
}; 