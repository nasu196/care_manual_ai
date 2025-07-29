// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://e40ddc44c97e8338586ccbb98cfe2d25@o4509681418764288.ingest.us.sentry.io/4509681436655616",

  // Add optional integrations for additional features
  integrations: [
    Sentry.replayIntegration(),
    // send console.log, console.error, and console.warn calls as logs to Sentry
    Sentry.consoleLoggingIntegration({ levels: ["log", "error", "warn"] }),
  ],

  // Send tracing data to Sentry dashboard (not console)
  tracesSampleRate: 0.1,

  // Define how likely Replay events are sampled.
  replaysSessionSampleRate: 0.1,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // Disable console logging completely
  _experiments: {
    enableLogs: false,
  },

  // Disable debug logging
  debug: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;