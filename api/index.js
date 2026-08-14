/**
 * Vercel serverless entry for the Express API.
 * All routes are rewritten here via vercel.json.
 */
import { createApp } from "../src/app.js";
import { connectDB } from "../src/config/db.js";
import { getRedis, isRedisEnabled } from "../src/config/redis.js";

const app = createApp();

let readyPromise;

async function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await connectDB();
      if (isRedisEnabled()) {
        getRedis();
      }
    })().catch((err) => {
      // Allow the next request to retry after a failed cold-start connect.
      readyPromise = null;
      throw err;
    });
  }
  await readyPromise;
}

export default async function handler(req, res) {
  try {
    await ensureReady();
  } catch (err) {
    console.error("[vercel] startup failed:", err?.message || err);
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "Service unavailable",
        detail: "Database connection failed. Check MONGODB_URI and Atlas Network Access.",
      })
    );
    return;
  }
  return app(req, res);
}
