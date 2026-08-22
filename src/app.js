import path from "path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import * as Sentry from "@sentry/node";

import { env } from "./config/env.js";
import healthRoutes from "./routes/health.js";
import authRoutes from "./routes/auth.js";
import tryonRoutes from "./routes/tryon.js";
import paymentRoutes from "./routes/payments.js";
import b2bRoutes from "./routes/b2b.js";
import adminRoutes from "./routes/admin.js";
import contentRoutes from "./routes/content.js";
import contactRoutes from "./routes/contact.js";
import { razorpayWebhook } from "./controllers/razorpayController.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { notFound, errorHandler } from "./middleware/error.js";

// Only used by the local-disk fallback when Cloudinary is not configured.
const LOCAL_UPLOAD_DIR = path.resolve(process.env.FILE_STORAGE_DIR || "uploads");

export function createApp() {
  const app = express();

  // Behind Render/Vercel proxies, trust the forwarded client IP so rate
  // limiting and logging see the real address rather than the proxy's.
  app.set("trust proxy", env.trustProxy);

  app.use(helmet());
  app.use(
    cors({
      // Reflect only allowlisted origins (see env.buildCorsOrigins).
      // In dev with an empty list, reflect the request origin for convenience.
      origin(origin, callback) {
        if (!origin) return callback(null, true); // same-origin / curl / server-to-server
        if (!env.isProd) return callback(null, true);
        if (env.corsOrigins.includes(origin)) return callback(null, true);
        console.warn(`[cors] Blocked origin: ${origin}. Allowed: ${env.corsOrigins.join(", ")}`);
        return callback(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  // Local-disk fallback for images when Cloudinary is not configured (dev only).
  // In production with Cloudinary, image URLs are absolute and this is unused.
  app.use(
    "/uploads",
    (req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      next();
    },
    express.static(LOCAL_UPLOAD_DIR)
  );
  // Razorpay webhook needs the raw body for HMAC — register before express.json().
  app.post(
    "/api/payments/razorpay/webhook",
    express.raw({ type: "application/json", limit: "100kb" }),
    razorpayWebhook
  );

  // JSON bodies are small forms only (image uploads go through multer/multipart),
  // so cap the JSON payload tightly to reject abusive requests early.
  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: true, limit: "100kb" }));
  app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));

  app.get("/", (req, res) => res.json({ name: "zimji API", version: "0.1.0" }));

  // Health check is exempt from rate limiting so uptime probes never trip it.
  app.use("/api/health", healthRoutes);

  app.use("/api", apiLimiter);
  app.use("/api/auth", authRoutes);
  app.use("/api/tryon", tryonRoutes);
  app.use("/api/payments", paymentRoutes);
  app.use("/api/b2b", b2bRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/content", contentRoutes);
  app.use("/api/contact", contactRoutes);

  // Sentry must capture route errors before our JSON error responder runs.
  // Guard: never let monitoring setup crash the serverless cold start.
  try {
    if (typeof Sentry.setupExpressErrorHandler === "function") {
      Sentry.setupExpressErrorHandler(app);
    }
  } catch (err) {
    console.warn("[app] Sentry Express handler skipped:", err?.message || err);
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
