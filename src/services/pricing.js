import { Pricing } from "../models/Pricing.js";
import { PACKS as DEFAULT_B2C_PACKS } from "../config/pricing.js";
import { CREDIT_PACKS as DEFAULT_CREDIT_PACKS } from "../config/credits.js";
import {
  localizePackAmount,
  withDualPrices,
} from "../config/inrPricing.js";
import { resolveMarketGateway } from "./payments.js";
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

/**
 * B2C packs. When `dualPrices` is true (consumer choice UI), attach KES+INR.
 * Otherwise localize to the user's market currency.
 */
export async function getB2cPacks(user = null, { dualPrices = false } = {}) {
  const safe = await getPricingSafe();
  if (dualPrices) {
    return safe.b2cPacks.map((p) => withDualPrices(p));
  }
  const currency = user ? resolveMarketGateway(user).currency : "KES";
  return safe.b2cPacks.map((p) => localizePackAmount(p, currency));
}

export async function getCreditPacks(user = null) {
  const safe = await getPricingSafe();
  const currency = user ? resolveMarketGateway(user).currency : "KES";
  return safe.creditPacks.map((p) => localizePackAmount(p, currency));
}

export async function getCreditPacksDual() {
  const safe = await getPricingSafe();
  return safe.creditPacks.map((p) => withDualPrices(p));
}

export async function getPack(id, user = null) {
  const packs = await getB2cPacks(user);
  return packs.find((p) => p.id === id) || null;
}

/** Raw pack (KES base) by id — used when applying gateway-specific amount at pay. */
export async function getPackBase(id) {
  const safe = await getPricingSafe();
  return safe.b2cPacks.find((p) => p.id === id) || null;
}

export async function getCreditPackBase(id) {
  const safe = await getPricingSafe();
  return safe.creditPacks.find((p) => p.id === id) || null;
}

// Looks up a single B2B credit pack by id.
export async function getCreditPack(id, user = null) {
  const packs = await getCreditPacks(user);
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
