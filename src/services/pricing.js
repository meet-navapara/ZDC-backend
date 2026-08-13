import { Pricing } from "../models/Pricing.js";
import { PACKS as DEFAULT_B2C_PACKS } from "../config/pricing.js";
import { CREDIT_PACKS as DEFAULT_CREDIT_PACKS } from "../config/credits.js";

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

export async function getB2cPacks() {
  const doc = await getPricingDoc();
  return doc.b2cPacks.map((p) => p.toObject ? p.toObject() : p);
}

export async function getCreditPacks() {
  const doc = await getPricingDoc();
  return doc.creditPacks.map((p) => (p.toObject ? p.toObject() : p));
}

// Looks up a single B2C pack by id (DB-driven, config fallback via seed).
export async function getPack(id) {
  const doc = await getPricingDoc();
  const pack = doc.b2cPacks.find((p) => p.id === id);
  return pack ? (pack.toObject ? pack.toObject() : pack) : null;
}

// Looks up a single B2B credit pack by id.
export async function getCreditPack(id) {
  const doc = await getPricingDoc();
  const pack = doc.creditPacks.find((p) => p.id === id);
  return pack ? (pack.toObject ? pack.toObject() : pack) : null;
}

// Replaces the pricing tables. Caller is responsible for validation.
export async function updatePricing({ b2cPacks, creditPacks, updatedBy }) {
  const doc = await getPricingDoc();
  if (Array.isArray(b2cPacks)) doc.b2cPacks = b2cPacks;
  if (Array.isArray(creditPacks)) doc.creditPacks = creditPacks;
  if (updatedBy) doc.updatedBy = updatedBy;
  await doc.save();
  return doc;
}
