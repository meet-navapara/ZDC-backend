import mongoose from "mongoose";

const { Schema } = mongoose;

// Defaults mirror the copy currently hardcoded on the public landing page, so
// the site looks identical until an operator edits it from the admin panel.
export const DEFAULT_CONTENT = {
  hero: {
    badge: "Hair & Apparel Virtual Try-On • Built for You",
    titleLine1: "Hair & Apparel,",
    titleHighlight: "Try-On",
    titleLine2: "in Seconds.",
    subtitle:
      "No guesswork, no regrets — just instant results. See exactly how any outfit or hairstyle looks on you before you buy or book.",
    primaryCta: "Try On Instantly",
    stats: [
      { value: "~8s", label: "Render time" },
      { value: "Hair & Apparel", label: "Categories" },
      { value: "M-Pesa", label: "Easy payments" },
    ],
  },
  testimonials: [],
  pricingNote:
    "Payments via M-Pesa. Final pricing configurable — shown for illustration.",
};

const statSchema = new Schema(
  { value: { type: String, default: "" }, label: { type: String, default: "" } },
  { _id: false }
);

const testimonialSchema = new Schema(
  {
    quote: { type: String, default: "" },
    author: { type: String, default: "" },
    role: { type: String, default: "" },
  },
  { _id: false }
);

const heroSchema = new Schema(
  {
    badge: { type: String, default: DEFAULT_CONTENT.hero.badge },
    titleLine1: { type: String, default: DEFAULT_CONTENT.hero.titleLine1 },
    titleHighlight: { type: String, default: DEFAULT_CONTENT.hero.titleHighlight },
    titleLine2: { type: String, default: DEFAULT_CONTENT.hero.titleLine2 },
    subtitle: { type: String, default: DEFAULT_CONTENT.hero.subtitle },
    primaryCta: { type: String, default: DEFAULT_CONTENT.hero.primaryCta },
    stats: { type: [statSchema], default: () => DEFAULT_CONTENT.hero.stats },
  },
  { _id: false }
);

const siteContentSchema = new Schema(
  {
    key: { type: String, default: "default", unique: true, index: true },
    hero: { type: heroSchema, default: () => ({}) },
    testimonials: { type: [testimonialSchema], default: [] },
    pricingNote: { type: String, default: DEFAULT_CONTENT.pricingNote },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

siteContentSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    hero: {
      badge: this.hero?.badge ?? "",
      titleLine1: this.hero?.titleLine1 ?? "",
      titleHighlight: this.hero?.titleHighlight ?? "",
      titleLine2: this.hero?.titleLine2 ?? "",
      subtitle: this.hero?.subtitle ?? "",
      primaryCta: this.hero?.primaryCta ?? "",
      stats: (this.hero?.stats || []).map((s) => ({
        value: s.value,
        label: s.label,
      })),
    },
    testimonials: (this.testimonials || []).map((t) => ({
      quote: t.quote,
      author: t.author,
      role: t.role,
    })),
    pricingNote: this.pricingNote ?? "",
    updatedAt: this.updatedAt,
  };
};

export const SiteContent = mongoose.model("SiteContent", siteContentSchema);

/**
 * Patches stale default-content values in the DB on every server startup.
 * Uses $set with exact old-value matching so admin edits are never overwritten.
 * Add new entries here whenever a default copy changes.
 */
export async function migrateSiteContent() {
  const stalePatches = [
    // old value → field path → new value
    {
      match: { "hero.badge": "AI Virtual Try-On • Built for Africa" },
      patch: { "hero.badge": DEFAULT_CONTENT.hero.badge },
      label: "hero.badge africa→you",
    },
    {
      match: { "hero.badge": "AI Virtual Try-On • Built for You" },
      patch: { "hero.badge": DEFAULT_CONTENT.hero.badge },
      label: "hero.badge you→hair&apparel",
    },
    {
      match: { "hero.titleLine1": "Wear the" },
      patch: {
        "hero.titleLine1": DEFAULT_CONTENT.hero.titleLine1,
        "hero.titleHighlight": DEFAULT_CONTENT.hero.titleHighlight,
        "hero.titleLine2": DEFAULT_CONTENT.hero.titleLine2,
        "hero.subtitle": DEFAULT_CONTENT.hero.subtitle,
      },
      label: "hero title/subtitle→hair&apparel punchline",
    },
    {
      match: { "hero.titleLine1": "Try it in seconds —" },
      patch: {
        "hero.titleLine1": DEFAULT_CONTENT.hero.titleLine1,
        "hero.titleHighlight": DEFAULT_CONTENT.hero.titleHighlight,
        "hero.titleLine2": DEFAULT_CONTENT.hero.titleLine2,
        "hero.subtitle": DEFAULT_CONTENT.hero.subtitle,
      },
      label: "hero title/subtitle→hair&apparel clean",
    },
  ];

  for (const { match, patch, label } of stalePatches) {
    await SiteContent.updateOne(
      { key: "default", ...match },
      { $set: patch }
    );
  }
}
