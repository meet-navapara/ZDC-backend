import { z } from "zod";

// Central place for input length/format limits. Keeping every text field bounded
// protects the database and API from oversized payloads that would bloat storage
// and slow queries. Reuse these helpers in controller schemas.

export const LIMITS = {
  email: 254, // RFC 5321 maximum
  password: 128,
  name: 80, // first/last name
  phone: 30,
  businessName: 120,
  addressLine: 200,
  city: 100,
  country: 100,
  categoryName: 80,
  description: 2000,
  shortDescription: 500,
  productName: 140,
  sku: 60,
  currency: 8,
  packId: 40,
  packLabel: 60,
  url: 2048,
  reference: 200,
  branchName: 120,
};

// Money / count ceilings — generous but finite so a typo can't store absurd data.
export const MAX_PRICE = 100_000_000;
export const MAX_CREDITS = 1_000_000;
export const MAX_IMAGES_PER_PRODUCT = 10;

// Normalised, length-bounded email.
export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(LIMITS.email, `Email must be at most ${LIMITS.email} characters`);

// Password for account creation (login uses a laxer rule — see loginPassword).
export const passwordField = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(LIMITS.password, `Password must be at most ${LIMITS.password} characters`);

// Login only needs "non-empty and not absurdly long".
export const loginPasswordField = z.string().min(1).max(LIMITS.password);

// A trimmed, length-capped text field. Use for optional short strings.
export function boundedText(max, { min = 0 } = {}) {
  let s = z.string().trim().max(max, `Must be at most ${max} characters`);
  if (min > 0) s = s.min(min, `Must be at least ${min} characters`);
  return s;
}

// Optional trimmed text that also tolerates an empty string.
export function optionalText(max) {
  return boundedText(max).optional();
}

export const phoneField = z
  .string()
  .trim()
  .max(LIMITS.phone)
  .regex(/^[+\d][\d\s()-]{3,}$/, "Enter a valid phone number")
  .optional()
  .or(z.literal(""));

// A bounded, absolute URL (also allows empty string for "clear this field").
export const urlField = z
  .string()
  .trim()
  .url("Enter a valid URL")
  .max(LIMITS.url)
  .optional()
  .or(z.literal(""));

// A Mongo ObjectId (24-hex). Rejects arbitrary long strings used as ids.
export const objectIdField = z
  .string()
  .trim()
  .regex(/^[a-f\d]{24}$/i, "Invalid id");

// Latitude / longitude with real-world bounds.
export const latField = z.number().min(-90).max(90);
export const lngField = z.number().min(-180).max(180);

// Currency code, uppercased and short.
export const currencyField = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(LIMITS.currency);

// A pack/slug id: letters, numbers, dashes, underscores; bounded length.
export const slugField = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.packId)
  .regex(/^[a-z0-9_-]+$/i, "Use letters, numbers, dashes or underscores");
