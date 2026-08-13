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
      // In production only the explicitly-allowlisted origins are permitted;
      // in dev we fall back to reflecting the request origin for convenience.
      origin: env.corsOrigins.length ? env.corsOrigins : env.isProd ? false : true,
      credentials: true,
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
  // JSON bodies are small forms only (image uploads go through multer/multipart),
  // so cap the JSON payload tightly to reject abusive requests early.
  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: true, limit: "100kb" }));
  app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));

  app.get("/", (req, res) => res.json({ name: "ZDC API", version: "0.1.0" }));

  // Health check is exempt from rate limiting so uptime probes never trip it.
  app.use("/api/health", healthRoutes);

  app.use("/api", apiLimiter);
  app.use("/api/auth", authRoutes);
  app.use("/api/tryon", tryonRoutes);
  app.use("/api/payments", paymentRoutes);
  app.use("/api/b2b", b2bRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/content", contentRoutes);

  // Sentry must capture route errors before our JSON error responder runs.
  // No-op if Sentry was not initialized (no SENTRY_DSN).
  Sentry.setupExpressErrorHandler(app);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
