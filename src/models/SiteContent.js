import mongoose from "mongoose";

const { Schema } = mongoose;

// Defaults mirror the copy currently hardcoded on the public landing page, so
// the site looks identical until an operator edits it from the admin panel.
export const DEFAULT_CONTENT = {
  hero: {
    badge: "AI Virtual Try-On • Built for Africa",
    titleLine1: "Wear the",
    titleHighlight: "Future.",
    titleLine2: "Now.",
    subtitle:
      "Visualize any outfit or hairstyle on yourself before you spend a shilling. Photorealistic try-ons, delivered in seconds.",
    primaryCta: "Try On Instantly",
    stats: [
      { value: "~8s", label: "Render time" },
      { value: "WhatsApp", label: "Instant delivery" },
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
