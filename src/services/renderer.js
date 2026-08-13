// AI try-on renderer provider interface.
//
// The real implementation will call the PerfectCorp API. Until API access is
// finalized, a mock renderer returns the uploaded source image as the "result"
// so the full flow is demoable end-to-end. Swap MockRenderer for a
// PerfectCorpRenderer with the same shape when keys are available.

// Distinct Cloudinary transformations used to fake separate AI variations in
// mock mode, so a multi-image pack (e.g. Trio) returns visibly different
// results instead of the same image repeated. The first variation is the
// untouched image. Ignored automatically for non-Cloudinary URLs.
const MOCK_VARIATIONS = [
  "",
  "e_saturation:50",
  "e_hue:40",
  "e_contrast:35",
  "e_art:aurora",
];

function withTransform(url, transform) {
  if (!transform) return url;
  // Only Cloudinary delivery URLs support inline transformations.
  if (/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(url)) {
    return url.replace("/upload/", `/upload/${transform}/`);
  }
  return url;
}

class MockRenderer {
  constructor() {
    this.name = "mock";
  }

  // Returns one result image URL per target outfit. Each rendered image is the
  // customer's selfie styled with a different uploaded outfit, so a Trio pack
  // (3 outfits) yields 3 separate, visibly distinct results.
  async render({ sourceUrl, targetUrls, targetUrl, count }) {
    const targets =
      Array.isArray(targetUrls) && targetUrls.length
        ? targetUrls
        : targetUrl
        ? [targetUrl]
        : [];
    const n = targets.length || count || 1;
    // (targets are accepted for interface parity with the real API, which will
    // composite each outfit onto the selfie.)
    return Array.from({ length: n }, (_, i) =>
      withTransform(sourceUrl, MOCK_VARIATIONS[i % MOCK_VARIATIONS.length])
    );
  }
}

let renderer;

export function getRenderer() {
  if (!renderer) {
    // if (process.env.PERFECTCORP_API_KEY) renderer = new PerfectCorpRenderer();
    renderer = new MockRenderer();
  }
  return renderer;
}
