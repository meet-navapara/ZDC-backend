/** Supported Perfect Corp render modes for ZDC try-on jobs. */
export const HAIR_COLOR_PRESETS = [
  "Jet Black",
  "Chocolate Brown",
  "Honey Blonde",
  "Platinum Blonde",
  "Ash Gray",
  "Rose Gold",
  "Burgundy",
  "Copper Red",
  "Lavender",
  "Teal Blue",
  "Dark Brown/Caramel Blonde",
  "Jet Black/Silver Gray",
  "Ash Brown/Lavender",
  "Rose Gold/Peach Blonde",
  "Burgundy/Magenta Pink",
  "Deep Blue/Teal Green",
  "Plum Purple/Pastel Lilac",
  "Copper Red/Golden Blonde",
  "Dark Gray/Ice Blonde",
  "Midnight Blue/Denim Blue",
];

/** Visual swatches for the B2C hair-color picker (approximate). */
export const HAIR_COLOR_SWATCHES = {
  "Jet Black": { primary: "#1a1a1a" },
  "Chocolate Brown": { primary: "#4a3728" },
  "Honey Blonde": { primary: "#d4a574" },
  "Platinum Blonde": { primary: "#e8e4dc" },
  "Ash Gray": { primary: "#9e9e9e" },
  "Rose Gold": { primary: "#e8b4a0" },
  Burgundy: { primary: "#6b2d3a" },
  "Copper Red": { primary: "#b5522a" },
  Lavender: { primary: "#b8a9c9" },
  "Teal Blue": { primary: "#2a7a8a" },
  "Dark Brown/Caramel Blonde": { primary: "#4a3728", secondary: "#d4a574" },
  "Jet Black/Silver Gray": { primary: "#1a1a1a", secondary: "#c0c0c0" },
  "Ash Brown/Lavender": { primary: "#6b5b4f", secondary: "#b8a9c9" },
  "Rose Gold/Peach Blonde": { primary: "#e8b4a0", secondary: "#f0d0a8" },
  "Burgundy/Magenta Pink": { primary: "#6b2d3a", secondary: "#d946a0" },
  "Deep Blue/Teal Green": { primary: "#1e3a5f", secondary: "#2a8a7a" },
  "Plum Purple/Pastel Lilac": { primary: "#5c3d6e", secondary: "#d8c4e8" },
  "Copper Red/Golden Blonde": { primary: "#b5522a", secondary: "#e8c872" },
  "Dark Gray/Ice Blonde": { primary: "#5a5a5a", secondary: "#f5f0e6" },
  "Midnight Blue/Denim Blue": { primary: "#1a2744", secondary: "#4a6fa5" },
};

export function getHairColorOptions() {
  return HAIR_COLOR_PRESETS.map((name) => ({
    name,
    swatch: HAIR_COLOR_SWATCHES[name] || { primary: "#888888" },
  }));
}

/** B2C beard categories (YouCam API returns only "All" — grouped for UX). */
export const BEARD_UI_CATEGORIES = [
  { id: "clean", label: "Clean shaven" },
  { id: "mustache", label: "Mustache" },
  { id: "goatee", label: "Goatee & patch" },
  { id: "short", label: "Short beard" },
  { id: "full", label: "Full beard" },
];

const BEARD_TEMPLATE_CATEGORY = {
  all_shaved: "clean",
  all_mustache: "mustache",
  all_walrus: "mustache",
  all_horse_shoe: "mustache",
  all_soul_patch: "goatee",
  all_goatee: "goatee",
  all_french_fork: "goatee",
  all_anchor: "short",
  all_circle: "short",
  all_chin_curtain: "short",
  all_garibaldi: "full",
  all_long_bandholz: "full",
  all_ducktail: "full",
  all_bandholz: "full",
  all_mutton_chops: "full",
};

export function getBeardUiCategory(template) {
  return BEARD_TEMPLATE_CATEGORY[template?.id] || "full";
}

export const PERFECTCORP_FEATURE_OPTIONS = [
  { id: "cloth", label: "Outfit try-on", needsReferenceImage: true },
  { id: "hair", label: "Hairstyle transfer", needsReferenceImage: true },
  { id: "haircolor", label: "Hair color", needsReferenceImage: false },
  { id: "beard", label: "Beard style", needsReferenceImage: false },
];

export function isValidHairColorPreset(preset) {
  return HAIR_COLOR_PRESETS.includes(String(preset || "").trim());
}

export function normalizeHairColorPreset(preset, fallback = "Honey Blonde") {
  const value = String(preset || "").trim();
  if (isValidHairColorPreset(value)) return value;
  return isValidHairColorPreset(fallback) ? fallback : HAIR_COLOR_PRESETS[0];
}

export function parseMultiValueField(raw, count, fallback) {
  if (!raw) return Array.from({ length: count }, () => fallback);
  const parts = String(raw)
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return Array.from({ length: count }, () => fallback);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(parts[i] || parts[parts.length - 1]);
  }
  return out;
}

export function joinMultiValueField(values) {
  return values.filter(Boolean).join("|");
}

export function normalizePerfectCorpFeature(value) {
  const raw = (value || "").trim().toLowerCase();
  if (raw === "hair-transfer" || raw === "hairstyle") return "hair";
  if (raw === "hair-color" || raw === "hair_color") return "haircolor";
  if (raw === "beard-style" || raw === "beard_style") return "beard";
  if (raw === "clothes" || raw === "apparel") return "cloth";
  return raw || "cloth";
}

export function featureNeedsReferenceImage(feature) {
  const mode = normalizePerfectCorpFeature(feature);
  return mode === "cloth" || mode === "hair";
}

export function isKnownPerfectCorpFeature(feature) {
  return PERFECTCORP_FEATURE_OPTIONS.some(
    (f) => f.id === normalizePerfectCorpFeature(feature)
  );
}

export function featureLabel(feature) {
  const id = normalizePerfectCorpFeature(feature);
  return PERFECTCORP_FEATURE_OPTIONS.find((f) => f.id === id)?.label || id;
}

/** Resolve B2B try-on feature from catalog category (fallback: env default). */
export function resolveB2bTryOnFeature(category, envDefault) {
  if (category?.tryOnFeature && isKnownPerfectCorpFeature(category.tryOnFeature)) {
    return normalizePerfectCorpFeature(category.tryOnFeature);
  }
  return normalizePerfectCorpFeature(envDefault || "cloth");
}

/** B2B hair color preset from category, else env default. */
export function resolveB2bHairColorPreset(category, envDefault) {
  const fromCategory = category?.hairColorPreset?.trim();
  if (fromCategory && isValidHairColorPreset(fromCategory)) return fromCategory;
  return normalizeHairColorPreset(envDefault);
}

/** B2B beard template from category, else env default (may be empty). */
export function resolveB2bBeardTemplateId(category, envDefault) {
  const fromCategory = category?.beardTemplateId?.trim();
  if (fromCategory) return fromCategory;
  return String(envDefault || "").trim();
}
