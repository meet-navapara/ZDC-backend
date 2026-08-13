import { createApp } from "./app.js";
import { connectDB } from "./config/db.js";
import { env } from "./config/env.js";
import { shutdownAnalytics } from "./services/analytics.js";

async function start() {
  try {
    await connectDB();
  } catch {
    console.error("[server] Failed to connect to MongoDB. Exiting.");
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[server] ZDC API listening on port ${env.port} (${env.nodeEnv})`);
  });

  // Flush pending analytics events on shutdown.
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      server.close(async () => {
        await shutdownAnalytics();
        process.exit(0);
      });
    });
  }
}

start();
