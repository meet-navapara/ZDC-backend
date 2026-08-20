import { createApp } from "./app.js";
import { connectDB } from "./config/db.js";
import { env } from "./config/env.js";
import { getRedis, closeRedis, isRedisEnabled } from "./config/redis.js";
import { shutdownAnalytics } from "./services/analytics.js";
import { repairPaymentInvoiceIndex } from "./models/Payment.js";
import { migrateSiteContent } from "./models/SiteContent.js";

async function start() {
  try {
    await connectDB();
    await repairPaymentInvoiceIndex();
    await migrateSiteContent();
  } catch (err) {
    console.error("[server] Failed to start database:", err?.message || err);
    process.exit(1);
  }

  if (isRedisEnabled()) {
    getRedis();
  }

  const app = createApp();
  const server = app.listen(env.port);

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
