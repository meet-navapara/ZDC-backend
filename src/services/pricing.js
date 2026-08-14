import { Pricing } from "../models/Pricing.js";
import { PACKS as DEFAULT_B2C_PACKS } from "../config/pricing.js";
import { CREDIT_PACKS as DEFAULT_CREDIT_PACKS } from "../config/credits.js";
import {
  cacheAside,
  invalidatePricing,
  keys,
  TTL,
} from "./cache.js";

// Returns the singleton pricing document, seeding it from the config defaults
// the first time it's requested so the platform always has sane values.
// Uses an atomic upsert so concurrent first-time reads can't race into an
// E11000 duplicate-key error on the unique "key" index.
export async function getPricingDoc() {
  return Pricing.findOneAndUpdate(
    { key: "default" },
    {
      $setOnInsert: {
        key: "default",
        b2cPacks: DEFAULT_B2C_PACKS,
        creditPacks: DEFAULT_CREDIT_PACKS,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

/** Cached plain pricing JSON for hot read paths. */
export async function getPricingSafe() {
  return cacheAside(keys.pricing(), TTL.pricing, async () => {
    const doc = await getPricingDoc();
    return doc.toJSONSafe();
  });
}

export async function getB2cPacks() {
  const safe = await getPricingSafe();
  return safe.b2cPacks;
}

export async function getCreditPacks() {
  const safe = await getPricingSafe();
  return safe.creditPacks;
}

// Looks up a single B2C pack by id (DB-driven, config fallback via seed).
export async function getPack(id) {
  const packs = await getB2cPacks();
  return packs.find((p) => p.id === id) || null;
}

// Looks up a single B2B credit pack by id.
export async function getCreditPack(id) {
  const packs = await getCreditPacks();
  return packs.find((p) => p.id === id) || null;
}

// Replaces the pricing tables. Caller is responsible for validation.
export async function updatePricing({ b2cPacks, creditPacks, updatedBy }) {
  const doc = await getPricingDoc();
  if (Array.isArray(b2cPacks)) doc.b2cPacks = b2cPacks;
  if (Array.isArray(creditPacks)) doc.creditPacks = creditPacks;
  if (updatedBy) doc.updatedBy = updatedBy;
  await doc.save();
  await invalidatePricing();
  return doc;
}
