import dotenv from "dotenv";

dotenv.config();

const nodeEnv = process.env.NODE_ENV || "development";
const isProd = nodeEnv === "production";
/** True on Vercel (serverless). Never call process.exit here — it becomes FUNCTION_INVOCATION_FAILED. */
const isVercel = Boolean(process.env.VERCEL);

const DEFAULT_JWT_SECRET = "dev-insecure-secret-change-me";
const jwtSecret = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;

/**
 * Production config problems. Empty when safe to serve traffic.
 * Callers: long-running `server.js` may exit; Vercel handler must return JSON instead.
 */
export const envFatalErrors = [];

if (isProd) {
  if (!process.env.MONGODB_URI) {
    envFatalErrors.push("MONGODB_URI is required in production");
  }
  if (!process.env.JWT_SECRET || jwtSecret === DEFAULT_JWT_SECRET) {
    envFatalErrors.push("JWT_SECRET must be set to a strong, unique value in production");
  }
  if (jwtSecret.length < 32) {
    envFatalErrors.push("JWT_SECRET should be at least 32 characters in production");
  }
  if (envFatalErrors.length) {
    console.error("[env] Refusing to start due to unsafe configuration:");
    for (const m of envFatalErrors) console.error(`  - ${m}`);
    // Local / Docker / Render long-running process: fail fast.
    // On Vercel, exiting kills the whole serverless isolate → pink crash page.
    if (!isVercel) {
      process.exit(1);
    }
  }
} else {
  for (const key of ["MONGODB_URI", "JWT_SECRET"]) {
    if (!process.env[key]) {
      console.warn(`[env] Warning: ${key} is not set. Using a dev fallback.`);
    }
  }
}

// How many proxies to trust for client IP / rate limiting. On Render/Vercel the
// app sits behind exactly one proxy, so default to 1 in production.
function parseTrustProxy() {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined) return isProd ? 1 : 0;
  if (raw === "true") return true;
  if (raw === "false") return false;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? raw : n;
}

/**
 * Build the browser origin allowlist.
 * - Merges CORS_ORIGINS + FRONTEND_URL
 * - Adds www ↔ apex twins (https://zimji.com ↔ https://www.zimji.com)
 * - Strips trailing slashes (browsers never send them on Origin)
 */
function buildCorsOrigins() {
  const raw = [
    ...(process.env.CORS_ORIGINS || "http://localhost:3000").split(","),
    process.env.FRONTEND_URL || "",
  ];
  const set = new Set();
  for (const part of raw) {
    const origin = String(part || "")
      .trim()
      .replace(/\/+$/, "");
    if (!origin) continue;
    set.add(origin);
    try {
      const u = new URL(origin);
      // Only twin www ↔ apex for real custom domains (not *.vercel.app / localhost).
      const host = u.hostname;
      if (
        host === "localhost" ||
        host.endsWith(".vercel.app") ||
        host.endsWith(".ngrok-free.dev") ||
        host.endsWith(".ngrok.io")
      ) {
        continue;
      }
      if (host.startsWith("www.")) {
        u.hostname = host.slice(4);
        set.add(u.origin);
      } else if (host.includes(".")) {
        u.hostname = `www.${host}`;
        set.add(u.origin);
      }
    } catch {
      // ignore invalid URL fragments
    }
  }
  return [...set];
}

const corsOrigins = buildCorsOrigins();
const frontendUrl =
  (process.env.FRONTEND_URL || "").trim().replace(/\/+$/, "") ||
  corsOrigins[0] ||
  "http://localhost:3000";

export const env = {
  nodeEnv,
  isProd,
  isVercel,
  port: parseInt(process.env.PORT || "8080", 10),
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/zdc",
  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },
  corsOrigins,
  trustProxy: parseTrustProxy(),
  // When false (default), new B2B accounts start as "pending" and must be
  // approved by a Super Admin before they can operate. Set B2B_AUTO_APPROVE=true
  // to activate new businesses immediately (e.g. for local development).
  b2bAutoApprove: (process.env.B2B_AUTO_APPROVE || "false").toLowerCase() === "true",
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || process.env.SMTP_USER || "",
  },
  supportEmail:
    process.env.SUPPORT_EMAIL || "jirani.deal@gmail.com",
  // Optional. When unset, the API skips Redis and reads from MongoDB only.
  redisUrl: (process.env.REDIS_URL || "").trim(),
  // When true, signup OTP skips SMTP and always uses MOCK_OTP_CODE (shown in UI).
  otpMock: (process.env.OTP_MOCK || "true").toLowerCase() === "true",
  mockOtpCode: (process.env.MOCK_OTP_CODE || "123456").trim() || "123456",
  frontendUrl,
  mpesa: buildMpesaConfig(),
  razorpay: buildRazorpayConfig(),
};

function buildRazorpayConfig() {
  const enabled =
    (process.env.RAZORPAY_ENABLED || "false").toLowerCase() === "true";
  const keyId = (process.env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || "").trim();
  const webhookSecret = (process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
  const configured = Boolean(keyId && keySecret);
  return {
    enabled,
    configured,
    keyId,
    keySecret,
    webhookSecret,
  };
}

function buildMpesaConfig() {
  const enabled =
    (process.env.MPESA_ENABLED || "false").toLowerCase() === "true";
  // Daraja secrets are often copied with a trailing "." from the portal UI.
  const consumerKey = (process.env.MPESA_CONSUMER_KEY || "")
    .trim()
    .replace(/\.+$/, "");
  const consumerSecret = (process.env.MPESA_CONSUMER_SECRET || "")
    .trim()
    .replace(/\.+$/, "");
  const shortcode = (process.env.MPESA_SHORTCODE || "").trim();
  const passkey = (process.env.MPESA_PASSKEY || "").trim();
  const callbackUrl =
    (process.env.MPESA_CALLBACK_URL || "").trim() ||
    (isVercel
      ? "https://zdc-backend.vercel.app/api/payments/mpesa/callback"
      : "");
  const configured = Boolean(
    consumerKey && consumerSecret && shortcode && passkey && callbackUrl
  );
  return {
    enabled,
    configured,
    env: (process.env.MPESA_ENV || "sandbox").toLowerCase() === "production"
      ? "production"
      : "sandbox",
    consumerKey,
    consumerSecret,
    shortcode,
    passkey,
    callbackUrl,
    // CustomerPayBillOnline for Paybill; CustomerBuyGoodsOnline for Till
    transactionType:
      (process.env.MPESA_TRANSACTION_TYPE || "CustomerPayBillOnline").trim() ||
      "CustomerPayBillOnline",
    /**
     * LOCAL/SANDBOX ONLY. After a real STK "accepted", auto-mark paid in ~4s
     * so you can verify try-on fulfill without Daraja PIN (DS timeout workaround).
     * Never enable in production.
     */
    sandboxAutoPaid:
      (process.env.MPESA_SANDBOX_AUTO_PAID || "false").toLowerCase() === "true",
  };
}

/** True if this Origin may call the API (credentials CORS). */
export function isAllowedCorsOrigin(origin) {
  if (!origin) return false;
  const normalized = String(origin).trim().replace(/\/+$/, "");
  return env.corsOrigins.includes(normalized);
}
