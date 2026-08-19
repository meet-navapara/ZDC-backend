import dotenv from "dotenv";

dotenv.config();

const nodeEnv = process.env.NODE_ENV || "development";
const isProd = nodeEnv === "production";

const DEFAULT_JWT_SECRET = "dev-insecure-secret-change-me";
const jwtSecret = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;

// In production we refuse to boot with insecure defaults — a leaked or default
// JWT secret means anyone can mint valid tokens. Fail fast and loudly.
if (isProd) {
  const fatal = [];
  if (!process.env.MONGODB_URI) fatal.push("MONGODB_URI is required in production");
  if (!process.env.JWT_SECRET || jwtSecret === DEFAULT_JWT_SECRET) {
    fatal.push("JWT_SECRET must be set to a strong, unique value in production");
  }
  if (jwtSecret.length < 32) {
    fatal.push("JWT_SECRET should be at least 32 characters in production");
  }
  if (fatal.length) {
    console.error("[env] Refusing to start due to unsafe configuration:");
    for (const m of fatal) console.error(`  - ${m}`);
    process.exit(1);
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

function intasendConfig() {
  const raw = (process.env.INTASEND_ENVIRONMENT || "").trim().toLowerCase();
  const testFlag = (process.env.INTASEND_TEST || "").toLowerCase() === "true";
  const publicKey =
    (process.env.INTASEND_PUBLIC_KEY || process.env.INTASEND_API_KEY || "").trim();
  const secretKey = (process.env.INTASEND_SECRET_KEY || "").trim();
  const isTestKey = /test/i.test(publicKey) || /test/i.test(secretKey);
  const environment =
    raw === "live" || raw === "production"
      ? "live"
      : raw === "sandbox" || raw === "test" || testFlag || isTestKey || !raw
        ? "sandbox"
        : "sandbox";
  const live = environment === "live" && !isTestKey;
  return {
    environment: live ? "live" : "sandbox",
    publicKey,
    secretKey,
    webhookChallenge: (process.env.INTASEND_WEBHOOK_CHALLENGE || "").trim(),
    country: (process.env.INTASEND_COUNTRY || "KE").trim().toUpperCase().slice(0, 2),
    apiBase: (
      process.env.INTASEND_API_BASE ||
      (live ? "https://payment.intasend.com" : "https://sandbox.intasend.com")
    ).replace(/\/$/, ""),
    timeoutMs: Math.min(
      60000,
      Math.max(5000, parseInt(process.env.INTASEND_TIMEOUT_MS || "20000", 10) || 20000)
    ),
  };
}

export const env = {
  nodeEnv,
  isProd,
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
  intasend: intasendConfig(),
};
