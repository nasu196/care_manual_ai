// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://e40ddc44c97e8338586ccbb98cfe2d25@o4509681418764288.ingest.us.sentry.io/4509681436655616",

  // Send tracing data to Sentry dashboard (not console)  
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0.1,

  // Disable console logging completely
  _experiments: {
    enableLogs: false,
  },

  // Disable debug logging
  debug: false,
});
