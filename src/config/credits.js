// B2B credit bundles. 1 credit = 1 rendered image.
// Values are placeholders and will be configurable by Super Admin later.
export const CREDIT_PACKS = [
  { id: "starter", label: "Starter", credits: 50, amount: 750, currency: "KES" },
  { id: "growth", label: "Growth", credits: 200, amount: 2600, currency: "KES" },
  { id: "scale", label: "Scale", credits: 1000, amount: 11000, currency: "KES" },
];

export function getCreditPack(id) {
  return CREDIT_PACKS.find((p) => p.id === id) || null;
}
