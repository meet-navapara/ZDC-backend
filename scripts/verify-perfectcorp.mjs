#!/usr/bin/env node
/**
 * Smoke-test Perfect Corp / YouCam API key and credit balance.
 * Usage: node scripts/verify-perfectcorp.mjs
 */
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: path.join(root, ".env") });

const { env } = await import("../src/config/env.js");
const { fetchCreditBalance, isPublicImageUrl } = await import(
  "../src/services/perfectcorp/client.js"
);
const { isPerfectCorpConfigured } = await import(
  "../src/services/perfectcorp/renderer.js"
);

if (!isPerfectCorpConfigured()) {
  console.error("Set PERFECTCORP_API_KEY in backend/.env (from https://yce.makeupar.com/api-console/en/api-keys/)");
  process.exit(1);
}

console.log("Perfect Corp config:");
console.log("  baseUrl:", env.perfectcorp.baseUrl);
console.log("  feature:", env.perfectcorp.defaultFeature);
console.log("  garmentCategory:", env.perfectcorp.garmentCategory);

try {
  const credits = await fetchCreditBalance();
  console.log("\nCredit balance response:", JSON.stringify(credits, null, 2));
  console.log("\nAPI key is valid.");
} catch (err) {
  console.error("\nAPI check failed:", err.message);
  if (err.code) console.error("  code:", err.code);
  process.exit(1);
}

const sample =
  "https://plugins-media.makeupar.com/strapi/assets/clothes_03_cccd5d4803.jpeg";
console.log("\nPublic URL check sample:", isPublicImageUrl(sample) ? "ok" : "fail");
