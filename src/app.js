import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

import { env } from "./config/env.js";
import healthRoutes from "./routes/health.js";
import authRoutes from "./routes/auth.js";
import { notFound, errorHandler } from "./middleware/error.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins.length ? env.corsOrigins : true,
      credentials: true,
    })
  );
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use("/api", apiLimiter);

  app.get("/", (req, res) => res.json({ name: "ZDC API", version: "0.1.0" }));
  app.use("/api/health", healthRoutes);
  app.use("/api/auth", authRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
