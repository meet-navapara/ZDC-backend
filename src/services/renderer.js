// AI try-on renderer provider interface.
// Live: Perfect Corp YouCam API (cloth + hair-transfer).
// Fallback: mock renderer for local dev without API key / Cloudinary.

import { env } from "../config/env.js";
import {
  PerfectCorpRenderer,
  isPerfectCorpConfigured,
} from "./perfectcorp/renderer.js";

const MOCK_VARIATIONS = [
  "",
  "e_saturation:50",
  "e_hue:40",
  "e_contrast:35",
  "e_art:aurora",
];

function withTransform(url, transform) {
  if (!transform) return url;
  if (/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(url)) {
    return url.replace("/upload/", `/upload/${transform}/`);
  }
  return url;
}

class MockRenderer {
  constructor() {
    this.name = "mock";
  }

  async render({ sourceUrl, targetUrls, targetUrl, count }) {
    const targets =
      Array.isArray(targetUrls) && targetUrls.length
        ? targetUrls
        : targetUrl
          ? [targetUrl]
          : [];
    const n = targets.length || count || 1;
    return Array.from({ length: n }, (_, i) =>
      withTransform(sourceUrl, MOCK_VARIATIONS[i % MOCK_VARIATIONS.length])
    );
  }
}

let renderer;

export function getRenderer() {
  if (!renderer) {
    if (isPerfectCorpConfigured()) {
      renderer = new PerfectCorpRenderer();
      console.info("[renderer] Using Perfect Corp YouCam API");
    } else {
      renderer = new MockRenderer();
      console.info("[renderer] Using mock renderer (set PERFECTCORP_API_KEY to enable live AI)");
    }
  }
  return renderer;
}

export function getRendererName() {
  return getRenderer().name;
}

export { isPerfectCorpConfigured };
