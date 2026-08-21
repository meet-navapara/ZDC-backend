/**
 * Vercel serverless entry for the Express API.
 * All routes are rewritten here via vercel.json.
 *
 * Important: do not process.exit() during import — that surfaces as
 * FUNCTION_INVOCATION_FAILED (pink crash page) even when the build succeeds.
 */
import { createApp } from "../src/app.js";
import { connectDB } from "../src/config/db.js";
import { envFatalErrors } from "../src/config/env.js";
import { getRedis, isRedisEnabled } from "../src/config/redis.js";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

let app = null;
let createAppError = null;
try {
  app = createApp();
} catch (err) {
  createAppError = err?.message || String(err);
  console.error("[vercel] createApp failed:", createAppError);
}

let readyPromise;

async function ensureReady() {
  if (envFatalErrors.length) {
    const err = new Error(envFatalErrors.join("; "));
    err.code = "ENV_FATAL";
    throw err;
  }
  if (!app) {
    const err = new Error(createAppError || "Failed to create Express app");
    err.code = "APP_INIT";
    throw err;
  }
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
    if (err?.code === "ENV_FATAL") {
      sendJson(res, 503, {
        error: "Service unavailable",
        detail:
          "Missing or invalid production environment variables on Vercel.",
        checks: envFatalErrors,
        hint: "Set MONGODB_URI and JWT_SECRET (≥32 chars) on the backend project → Production, then Redeploy.",
      });
      return;
    }
    sendJson(res, 503, {
      error: "Service unavailable",
      detail:
        err?.code === "APP_INIT"
          ? err.message
          : "Database connection failed. Check MONGODB_URI and Atlas Network Access.",
    });
    return;
  }
  return app(req, res);
}
