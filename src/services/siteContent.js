import { SiteContent, DEFAULT_CONTENT } from "../models/SiteContent.js";
import {
  cacheAside,
  invalidateContent,
  keys,
  TTL,
} from "./cache.js";

// Returns the singleton site-content document, seeding it from the defaults the
// first time it's requested. Atomic upsert so concurrent first reads can't race
// into a duplicate-key error on the unique "key" index.
export async function getContentDoc() {
  return SiteContent.findOneAndUpdate(
    { key: "default" },
    { $setOnInsert: { key: "default", ...DEFAULT_CONTENT } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

/** Cached plain content JSON for public + admin reads. */
export async function getContentSafe() {
  return cacheAside(keys.content(), TTL.content, async () => {
    const doc = await getContentDoc();
    return doc.toJSONSafe();
  });
}

export async function updateContent({ hero, testimonials, pricingNote, updatedBy }) {
  const set = { updatedBy: updatedBy || null };
  if (hero) set.hero = hero;
  if (testimonials) set.testimonials = testimonials;
  if (pricingNote !== undefined) set.pricingNote = pricingNote;

  const doc = await SiteContent.findOneAndUpdate(
    { key: "default" },
    { $set: set, $setOnInsert: { key: "default" } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  await invalidateContent();
  return doc;
}
