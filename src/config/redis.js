import Redis from "ioredis";
import { env } from "./env.js";

/** @type {import("ioredis").default | null} */
let client = null;
let connectAttempted = false;

/**
 * Lazily connect to Redis. If REDIS_URL is unset or connection fails,
 * the app continues without cache (MongoDB remains source of truth).
 */
export function getRedis() {
  if (!env.redisUrl) return null;
  if (client) return client;
  if (connectAttempted && !client) return null;

  connectAttempted = true;
  try {
    client = new Redis(env.redisUrl, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      connectTimeout: 5000,
      lazyConnect: false,
      // Don't spam reconnect forever in local/dev when Redis isn't running.
      retryStrategy(times) {
        if (times > 8) return null;
        return Math.min(times * 200, 2000);
      },
    });

    client.on("connect", () => {
      console.log("[redis] connected");
    });
    client.on("ready", () => {
      console.log("[redis] ready");
    });
    client.on("error", (err) => {
      // Avoid crashing the process on transient Redis errors.
      console.warn("[redis]", err.message);
    });
    client.on("end", () => {
      console.warn("[redis] connection closed");
    });
  } catch (err) {
    console.warn(
      "[redis] failed to initialize:",
      err instanceof Error ? err.message : err
    );
    client = null;
  }
  return client;
}

export async function closeRedis() {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    try {
      client.disconnect();
    } catch {
      // ignore
    }
  }
  client = null;
}

export function isRedisEnabled() {
  return Boolean(env.redisUrl);
}
