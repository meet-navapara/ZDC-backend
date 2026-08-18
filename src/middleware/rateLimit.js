import rateLimit from "express-rate-limit";

// General API limiter: generous, protects against runaway clients / scraping.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down and try again shortly." },
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
});

export const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many messages from this device. Please wait a few minutes and try again.",
  },
});
