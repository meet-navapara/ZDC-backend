import { createApp } from "./app.js";
import { connectDB } from "./config/db.js";
import { env } from "./config/env.js";
import { getRedis, closeRedis, isRedisEnabled } from "./config/redis.js";
import { shutdownAnalytics } from "./services/analytics.js";
import { isMailConfigured } from "./services/mail.js";
import { repairPaymentInvoiceIndex } from "./models/Payment.js";
import { isIntasendConfigured } from "./services/intasend/client.js";

async function start() {
  try {
    await connectDB();
    await repairPaymentInvoiceIndex();
    if (isIntasendConfigured() && !env.intasend.enabled) {
      console.log(
        "[payments] IntaSend keys found but checkout disabled — using demo (stub) gateway. Set INTASEND_ENABLED=true to test IntaSend."
      );
    }
  } catch (err) {
    console.error("[server] Failed to start database:", err?.message || err);
    process.exit(1);
  }

  if (isRedisEnabled()) {
    getRedis();
    console.log("[redis] REDIS_URL set — cache enabled (fail-open to Mongo if down)");
  } else {
    console.log("[redis] REDIS_URL not set — running without cache");
  }

  if (isMailConfigured() && process.env.OTP_MOCK !== "true") {
    console.log("[mail] SMTP configured — signup OTP emails will be sent");
  } else if ((process.env.OTP_MOCK || "true").toLowerCase() === "true") {
    console.log(
      `[otp] MOCK mode ON — emails skipped; use code ${process.env.MOCK_OTP_CODE || "123456"}`
    );
  } else {
    console.warn(
      "[mail] SMTP not configured — signup OTP codes are logged / returned as devOtp in development"
    );
  }

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[server] zimji API listening on port ${env.port} (${env.nodeEnv})`);
  });

  // Flush pending analytics events on shutdown.
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      server.close(async () => {
        await shutdownAnalytics();
        await closeRedis();
        process.exit(0);
      });
    });
  }
}

start();
