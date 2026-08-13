// B2C pack pricing. Values are placeholders and are configurable by Super Admin later.
export const PACKS = [
  { id: "single", label: "Single", images: 1, amount: 20, currency: "KES" },
  { id: "trio", label: "Trio", images: 3, amount: 50, currency: "KES" },
];

export function getPack(id) {
  return PACKS.find((p) => p.id === id) || null;
}
