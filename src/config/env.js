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
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
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
  frontendUrl:
    (process.env.FRONTEND_URL || "").trim() ||
    (process.env.CORS_ORIGINS || "http://localhost:3000").split(",")[0].trim(),
};
