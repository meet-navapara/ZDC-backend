import fs from "fs";
import path from "path";

const BASE = process.env.BASE || "http://localhost:8080";
const IMG_DIR = path.resolve("../frontend/public/images");

function log(step, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${extra ? " — " + extra : ""}`);
  if (!ok) process.exitCode = 1;
}

function blob(name) {
  const buf = fs.readFileSync(path.join(IMG_DIR, name));
  return new Blob([buf], { type: "image/png" });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. Health
  const health = await (await fetch(`${BASE}/api/health`)).json();
  log("Health check", health.status === "ok" && health.db === "connected", `db=${health.db}`);

  // 2. Auth: register + login + me
  const email = `verify_${Date.now()}@zdc.app`;
  const reg = await (
    await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123", role: "b2c" }),
    })
  ).json();
  log("Auth register", !!reg.token, `user=${reg.user?.email}`);
  const token = reg.token;

  const me = await (
    await fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  log("Auth /me with JWT", me.user?.email === email);

  const noAuth = await fetch(`${BASE}/api/auth/me`);
  log("Auth /me rejects without token", noAuth.status === 401, `status=${noAuth.status}`);

  // 3. Pricing
  const pricing = await (await fetch(`${BASE}/api/tryon/pricing`)).json();
  log("Pricing packs", Array.isArray(pricing.packs) && pricing.packs.length >= 2, `packs=${pricing.packs?.length}`);

  // 4. Create try-on job (multipart)
  const form = new FormData();
  form.append("pack", "trio");
  form.append("email", email);
  form.append("source", blob("model-print.png"), "selfie.png");
  form.append("target", blob("apparel.png"), "outfit.png");
  const created = await (
    await fetch(`${BASE}/api/tryon`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
  ).json();
  const jobId = created.job?.id;
  log("Create try-on job", created.job?.status === "awaiting_payment" && !!jobId, `amount=${created.job?.amount} ${created.job?.currency}`);

  // 5. Validation: missing images rejected
  const badForm = new FormData();
  badForm.append("pack", "trio");
  const bad = await fetch(`${BASE}/api/tryon`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: badForm,
  });
  log("Reject job without images", bad.status === 400, `status=${bad.status}`);

  // 6. Pay (stub) -> processing
  const paid = await (
    await fetch(`${BASE}/api/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jobId, gateway: "stub" }),
    })
  ).json();
  log("Payment (stub) -> processing", paid.payment?.status === "paid" && paid.job?.status === "processing", `ref=${paid.payment?.reference}`);

  // 7. Double-pay rejected
  const dbl = await fetch(`${BASE}/api/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jobId }),
  });
  log("Reject double payment", dbl.status === 409, `status=${dbl.status}`);

  // 8. Poll for completion
  let job = null;
  for (let i = 0; i < 12; i++) {
    await sleep(1000);
    job = (await (await fetch(`${BASE}/api/tryon/${jobId}`)).json()).job;
    if (job.status === "completed" || job.status === "failed") break;
  }
  log(
    "Render completed with result images",
    job?.status === "completed" && job.resultImageUrls?.length === 3,
    `status=${job?.status} results=${job?.resultImageUrls?.length}`
  );

  // 9. Result image is downloadable (absolute Cloudinary URL or local /uploads)
  if (job?.resultImageUrls?.[0]) {
    const raw = job.resultImageUrls[0];
    const imgUrl = /^https?:\/\//.test(raw) ? raw : `${BASE}${raw}`;
    const provider = /res\.cloudinary\.com/.test(imgUrl) ? "cloudinary" : "local";
    const imgRes = await fetch(imgUrl);
    log("Result image served", imgRes.ok, `provider=${provider} status=${imgRes.status}`);
  }

  // Cleanup test user
  console.log("\nCleanup: verify user left in DB (harmless): " + email);
}

main().catch((e) => {
  console.error("SCRIPT ERROR", e);
  process.exit(1);
});
