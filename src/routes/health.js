import { Router } from "express";
import mongoose from "mongoose";
import { getRedis, isRedisEnabled } from "../config/redis.js";
import { getRendererName, isPerfectCorpConfigured } from "../services/renderer.js";
import { cloudinaryEnabled } from "../services/storage.js";

const router = Router();

router.get("/", async (req, res) => {
  const dbState = mongoose.connection.readyState; // 1 = connected
  let redis = { enabled: isRedisEnabled(), status: "disabled", ping: null };

  if (isRedisEnabled()) {
    const client = getRedis();
    redis.status = client?.status || "unavailable";
    if (client) {
      try {
        redis.ping = await client.ping();
        const probeKey = "zimji:health:probe";
        await cacheSet(probeKey, { t: Date.now() }, 30);
        const got = await cacheGet(probeKey);
        redis.cacheOk = Boolean(got && got.t);
      } catch (err) {
        redis.ping = "error";
        redis.error = err instanceof Error ? err.message : String(err);
        redis.cacheOk = false;
      }
    }
  }

  res.json({
    status: "ok",
    service: "zimji-backend",
    db: dbState === 1 ? "connected" : "disconnected",
    redis,
    renderer: getRendererName(),
    perfectcorpConfigured: isPerfectCorpConfigured(),
    cloudinaryEnabled,
    time: new Date().toISOString(),
  });
});

export default router;
