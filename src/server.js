import { createApp } from "./app.js";
import { connectDB } from "./config/db.js";
import { env } from "./config/env.js";

async function start() {
  try {
    await connectDB();
  } catch {
    console.error("[server] Failed to connect to MongoDB. Exiting.");
    process.exit(1);
  }

  const app = createApp();
  app.listen(env.port, () => {
    console.log(`[server] ZDC API listening on port ${env.port} (${env.nodeEnv})`);
  });
}

start();
