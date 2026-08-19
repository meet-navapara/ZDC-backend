// Sentry initialization. This file MUST be imported before any other module
// (via `node --import ./src/instrument.js`) so Sentry can auto-instrument
// Express, HTTP, and MongoDB before they are loaded.
import dotenv from "dotenv";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

dotenv.config();

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    integrations: [nodeProfilingIntegration()],
    // Capture 20% of transactions for performance monitoring in production.
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
    profilesSampleRate: 0.2,
    // Never attach PII (IP, cookies) automatically — this app handles selfies
    // and contact details, so we send only explicit, non-PII context.
    sendDefaultPii: false,
  });
} else {
}
