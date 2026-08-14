import { getRedis } from "../config/redis.js";

const PREFIX = "zimji:";

export const TTL = {
  pricing: 15 * 60, // 15 min
  content: 15 * 60,
  catalog: 90, // 90 sec
  categories: 90,
  stats: 45, // dashboard polls ~20s; keep a bit longer
};

export const keys = {
  pricing: () => `${PREFIX}pricing:default`,
  content: () => `${PREFIX}content:default`,
  products: (businessId, filterKey = "all") =>
    `${PREFIX}b2b:${businessId}:products:${filterKey}`,
  categories: (businessId) => `${PREFIX}b2b:${businessId}:categories`,
  b2bStats: (businessId, days) => `${PREFIX}b2b:${businessId}:stats:d${days}`,
  platformStats: (days) => `${PREFIX}admin:platform-stats:d${days}`,
};

function redisOrNull() {
  try {
    const r = getRedis();
    if (!r) return null;
    // Allow commands once the TCP socket is up; "ready" is ideal but
    // transient status flips shouldn't disable caching.
    if (r.status === "end" || r.status === "close" || r.status === "wait") {
      return null;
    }
    return r;
  } catch {
    return null;
  }
}

function jsonReplacer(_key, value) {
  // Normalize Mongo ObjectId / Buffer-ish values for stable JSON cache entries.
  if (value && typeof value === "object") {
    if (typeof value.toHexString === "function") return value.toHexString();
    if (value._bsontype === "ObjectID" || value._bsontype === "ObjectId") {
      return String(value);
    }
  }
  return value;
}

/** @returns {Promise<any|null>} */
export async function cacheGet(key) {
  const r = redisOrNull();
  if (!r) return null;
  try {
    const raw = await r.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn("[cache] get failed:", key, err instanceof Error ? err.message : err);
    return null;
  }
}

/** @returns {Promise<boolean>} */
export async function cacheSet(key, value, ttlSeconds) {
  const r = redisOrNull();
  if (!r) return false;
  try {
    const payload = JSON.stringify(value, jsonReplacer);
    if (ttlSeconds && ttlSeconds > 0) {
      await r.set(key, payload, "EX", ttlSeconds);
    } else {
      await r.set(key, payload);
    }
    return true;
  } catch (err) {
    console.warn("[cache] set failed:", key, err instanceof Error ? err.message : err);
    return false;
  }
}

/** Delete one or more exact keys. */
export async function cacheDel(...keyList) {
  const r = redisOrNull();
  if (!r) return 0;
  const flat = keyList.flat().filter(Boolean);
  if (!flat.length) return 0;
  try {
    return await r.del(...flat);
  } catch (err) {
    console.warn("[cache] del failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}

/**
 * Delete keys matching a pattern (e.g. zimji:b2b:ID:products:*).
 * Uses SCAN so we don't block Redis with KEYS.
 */
export async function cacheDelPattern(pattern) {
  const r = redisOrNull();
  if (!r) return 0;
  let deleted = 0;
  try {
    let cursor = "0";
    do {
      const [next, found] = await r.scan(cursor, "MATCH", pattern, "COUNT", 64);
      cursor = next;
      if (found.length) {
        deleted += await r.del(...found);
      }
    } while (cursor !== "0");
  } catch (err) {
    console.warn(
      "[cache] delPattern failed:",
      pattern,
      err instanceof Error ? err.message : err
    );
  }
  return deleted;
}

/** Drop all product/category/stats cache for one business. */
export async function invalidateBusinessCatalog(businessId) {
  if (!businessId) return;
  await Promise.all([
    cacheDelPattern(`${PREFIX}b2b:${businessId}:products:*`),
    cacheDel(keys.categories(businessId)),
    cacheDelPattern(`${PREFIX}b2b:${businessId}:stats:*`),
  ]);
}

export async function invalidateBusinessStats(businessId) {
  if (!businessId) return;
  await cacheDelPattern(`${PREFIX}b2b:${businessId}:stats:*`);
}

export async function invalidatePricing() {
  await cacheDel(keys.pricing());
}

export async function invalidateContent() {
  await cacheDel(keys.content());
}

export async function invalidatePlatformStats() {
  await cacheDelPattern(`${PREFIX}admin:platform-stats:*`);
}

/**
 * Cache-aside helper: return cached value or compute, store, and return.
 * @template T
 * @param {string} key
 * @param {number} ttlSeconds
 * @param {() => Promise<T>} loader
 * @returns {Promise<T>}
 */
export async function cacheAside(key, ttlSeconds, loader) {
  const hit = await cacheGet(key);
  if (hit !== null && hit !== undefined) return hit;
  const value = await loader();
  if (value !== null && value !== undefined) {
    const ok = await cacheSet(key, value, ttlSeconds);
    if (!ok) {
      console.warn("[cache] aside store skipped for", key);
    }
  }
  return value;
}
