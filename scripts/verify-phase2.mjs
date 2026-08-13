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

async function jf(res) {
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

function authHeaders(token, json = true) {
  const h = { Authorization: `Bearer ${token}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function main() {
  // 0. Health
  const health = await (await fetch(`${BASE}/api/health`)).json();
  log("Health check", health.db === "connected", `db=${health.db}`);

  // 1. B2B registration
  const email = `b2bverify_${Date.now()}@zdc.app`;
  const reg = await jf(
    await fetch(`${BASE}/api/b2b/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "password123",
        phone: "+254700000000",
        business: {
          name: "Test Boutique",
          category: "boutique",
          address: { line1: "1 Biashara St", city: "Nairobi", country: "Kenya", lat: -1.286, lng: 36.817 },
        },
      }),
    })
  );
  const token = reg.body.token;
  log(
    "B2B register",
    reg.status === 201 && !!token && reg.body.user?.role === "b2b" && reg.body.user?.business?.name === "Test Boutique",
    `business=${reg.body.user?.business?.name}`
  );

  // 2. Profile + starting balance
  const me = await jf(await fetch(`${BASE}/api/b2b/me`, { headers: authHeaders(token, false) }));
  log("B2B /me profile", me.status === 200 && me.body.credits === 0, `credits=${me.body.credits}`);

  // 3. RBAC: b2c token blocked from b2b endpoints
  const b2c = await jf(
    await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `b2bverify_c_${Date.now()}@zdc.app`, password: "password123", role: "b2c" }),
    })
  );
  const rbac = await fetch(`${BASE}/api/b2b/me`, { headers: authHeaders(b2c.body.token, false) });
  log("RBAC blocks b2c from b2b", rbac.status === 403, `status=${rbac.status}`);

  // 4. Credit packs (public) + purchase
  const packs = await jf(await fetch(`${BASE}/api/b2b/credits/packs`));
  log("Credit packs listed", packs.status === 200 && packs.body.packs?.length >= 1, `packs=${packs.body.packs?.length}`);

  const buy = await jf(
    await fetch(`${BASE}/api/b2b/credits/purchase`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ pack: "starter", gateway: "stub" }),
    })
  );
  log("Purchase credits (starter=50)", buy.status === 200 && buy.body.balance === 50, `balance=${buy.body.balance}`);

  // 5. Ledger shows the purchase
  const ledger = await jf(await fetch(`${BASE}/api/b2b/credits/ledger`, { headers: authHeaders(token, false) }));
  log(
    "Ledger records purchase",
    ledger.status === 200 && ledger.body.ledger?.[0]?.type === "purchase" && ledger.body.ledger[0].balanceAfter === 50,
    `entries=${ledger.body.ledger?.length}`
  );

  // 6. Category CRUD + limit
  const cat = await jf(
    await fetch(`${BASE}/api/b2b/categories`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ name: "Dresses" }),
    })
  );
  const categoryId = cat.body.category?.id;
  log("Create category", cat.status === 201 && !!categoryId, `id=${categoryId}`);

  // Fill up to the max of 10, then expect the 11th to be rejected.
  for (let i = 2; i <= 10; i++) {
    await fetch(`${BASE}/api/b2b/categories`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ name: `Cat ${i}` }),
    });
  }
  const over = await fetch(`${BASE}/api/b2b/categories`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ name: "Too many" }),
  });
  log("Category limit enforced (max 10)", over.status === 409, `status=${over.status}`);

  // 7. Create product with image upload -> Cloudinary
  const pForm = new FormData();
  pForm.append("name", "Silk Wrap Dress");
  pForm.append("price", "4500");
  pForm.append("sku", "SWD-001");
  pForm.append("categoryId", categoryId);
  pForm.append("images", blob("apparel.png"), "dress.png");
  const prod = await jf(
    await fetch(`${BASE}/api/b2b/products`, {
      method: "POST",
      headers: authHeaders(token, false),
      body: pForm,
    })
  );
  const productId = prod.body.product?.id;
  const prodImg = prod.body.product?.imageUrls?.[0] || "";
  log(
    "Create product (image uploaded)",
    prod.status === 201 && !!productId && /^https?:\/\//.test(prodImg),
    `provider=${/res\.cloudinary\.com/.test(prodImg) ? "cloudinary" : "local"}`
  );

  // 8. List products
  const list = await jf(await fetch(`${BASE}/api/b2b/products`, { headers: authHeaders(token, false) }));
  log("List products", list.status === 200 && list.body.products?.length === 1, `count=${list.body.products?.length}`);

  // 9. B2B try-on consumes credits (count=2)
  const tForm = new FormData();
  tForm.append("productId", productId);
  tForm.append("count", "2");
  tForm.append("source", blob("model-print.png"), "selfie.png");
  const tryon = await jf(
    await fetch(`${BASE}/api/b2b/tryon`, {
      method: "POST",
      headers: authHeaders(token, false),
      body: tForm,
    })
  );
  const jobId = tryon.body.job?.id;
  log(
    "B2B try-on -> processing, credits debited",
    tryon.status === 201 && tryon.body.job?.status === "processing" && tryon.body.credits === 48,
    `credits=${tryon.body.credits} cost=${tryon.body.job?.creditsCost}`
  );

  // 10. Poll for completion
  let job = null;
  for (let i = 0; i < 12; i++) {
    await sleep(1000);
    job = (await (await fetch(`${BASE}/api/tryon/${jobId}`)).json()).job;
    if (job.status === "completed" || job.status === "failed") break;
  }
  log(
    "B2B render completed",
    job?.status === "completed" && job.resultImageUrls?.length === 2,
    `status=${job?.status} results=${job?.resultImageUrls?.length}`
  );

  // 11. Insufficient credits -> 402 (fresh business with 0 credits but owns a product)
  const email2 = `b2bverify_poor_${Date.now()}@zdc.app`;
  const reg2 = await jf(
    await fetch(`${BASE}/api/b2b/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email2, password: "password123", business: { name: "Broke Salon", category: "salon" } }),
    })
  );
  const token2 = reg2.body.token;
  const pForm2 = new FormData();
  pForm2.append("name", "Basic Tee");
  pForm2.append("images", blob("menswear.png"), "tee.png");
  const prod2 = await jf(
    await fetch(`${BASE}/api/b2b/products`, { method: "POST", headers: authHeaders(token2, false), body: pForm2 })
  );
  const tForm2 = new FormData();
  tForm2.append("productId", prod2.body.product?.id);
  tForm2.append("source", blob("model-print.png"), "selfie.png");
  const poor = await fetch(`${BASE}/api/b2b/tryon`, { method: "POST", headers: authHeaders(token2, false), body: tForm2 });
  log("Insufficient credits -> 402", poor.status === 402, `status=${poor.status}`);

  // 12. Update + delete product, delete category
  const upd = await jf(
    await fetch(`${BASE}/api/b2b/products/${productId}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ price: 5000, status: "archived" }),
    })
  );
  log("Update product", upd.status === 200 && upd.body.product?.price === 5000 && upd.body.product?.status === "archived");

  const del = await fetch(`${BASE}/api/b2b/products/${productId}`, { method: "DELETE", headers: authHeaders(token, false) });
  log("Delete product", del.status === 200, `status=${del.status}`);

  const delCat = await fetch(`${BASE}/api/b2b/categories/${categoryId}`, { method: "DELETE", headers: authHeaders(token, false) });
  log("Delete category", delCat.status === 200, `status=${delCat.status}`);

  return { emails: [email, email2, b2c.body.user?.email] };
}

async function cleanup(emails) {
  try {
    const { env } = await import("../src/config/env.js");
    const mongoose = (await import("mongoose")).default;
    await mongoose.connect(env.mongoUri);
    const db = mongoose.connection;
    const users = await db.collection("users").find({ email: /^b2bverify_/ }).toArray();
    const ids = users.map((u) => u._id);
    const del = async (c, q) => (await db.collection(c).deleteMany(q)).deletedCount;
    const jobs = await del("tryonjobs", { user: { $in: ids } });
    const pays = await del("payments", { user: { $in: ids } });
    const wallets = await del("creditwallets", { business: { $in: ids } });
    const ledgers = await del("creditledgers", { business: { $in: ids } });
    const cats = await del("categories", { business: { $in: ids } });
    const prods = await del("products", { business: { $in: ids } });
    const us = await del("users", { email: /^b2bverify_/ });
    console.log(
      `\nCleanup — users:${us} jobs:${jobs} payments:${pays} wallets:${wallets} ledgers:${ledgers} categories:${cats} products:${prods}`
    );
    await mongoose.disconnect();

    // Remove uploaded test images from Cloudinary (best-effort).
    try {
      const { v2: cl } = await import("cloudinary");
      cl.config({ secure: true });
      const r1 = await cl.api.delete_resources_by_prefix("zdc/catalog").catch(() => ({}));
      const r2 = await cl.api.delete_resources_by_prefix("zdc/b2b").catch(() => ({}));
      const n = Object.keys(r1.deleted || {}).length + Object.keys(r2.deleted || {}).length;
      console.log(`Cloudinary test assets cleared: ${n}`);
    } catch {
      // Cloudinary not configured (local fallback) — nothing to clean.
    }
  } catch (e) {
    console.log("Cleanup skipped:", e.message);
  }
}

main()
  .then((r) => cleanup(r?.emails || []))
  .catch((e) => {
    console.error("SCRIPT ERROR", e);
    process.exit(1);
  });
