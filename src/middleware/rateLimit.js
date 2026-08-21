import rateLimit from "express-rate-limit";

// express-rate-limit v7 validates trust-proxy / X-Forwarded-For and can throw
// on Vercel if misconfigured — that surfaces as a hard 500. Soften validation
// in serverless; we still set app.set("trust proxy", 1) in createApp.
const vercelSafe = process.env.VERCEL
  ? { validate: { xForwardedForHeader: false, default: true } }
  : {};

// General API limiter: generous, protects against runaway clients / scraping.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down and try again shortly." },
  ...vercelSafe,
});

// Strict limiter for authentication endpoints to blunt credential stuffing and
// brute-force attempts. All attempts from an IP count against this window.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many attempts from this device. Please wait a few minutes and try again.",
  },
  ...vercelSafe,
});

export const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many messages from this device. Please wait a few minutes and try again.",
  },
  ...vercelSafe,
});
