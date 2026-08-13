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

const H = (token, json = true) => {
  const h = { Authorization: `Bearer ${token}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
};

async function main() {
  const email = `statsverify_${Date.now()}@zdc.app`;

  // Register + buy credits
  const reg = await jf(
    await fetch(`${BASE}/api/b2b/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "password123",
        business: { name: "Stats Studio", category: "salon" },
      }),
    })
  );
  const token = reg.body.token;
  log("Register business", reg.status === 201 && !!token);

  await fetch(`${BASE}/api/b2b/credits/purchase`, {
    method: "POST",
    headers: H(token),
    body: JSON.stringify({ pack: "starter", gateway: "stub" }),
  });

  // Category + product with image
  const cat = await jf(
    await fetch(`${BASE}/api/b2b/categories`, {
      method: "POST",
      headers: H(token),
      body: JSON.stringify({ name: "Wigs" }),
    })
  );
  const pForm = new FormData();
  pForm.append("name", "Lace Front Wig");
  pForm.append("price", "3000");
  pForm.append("categoryId", cat.body.category.id);
  pForm.append("images", blob("apparel.png"), "wig.png");
  const prod = await jf(
    await fetch(`${BASE}/api/b2b/products`, {
      method: "POST",
      headers: H(token, false),
      body: pForm,
    })
  );
  const productId = prod.body.product.id;
  log("Setup product", prod.status === 201 && !!productId);

  // Run two try-ons to generate KPI data
  for (let i = 0; i < 2; i++) {
    const tForm = new FormData();
    tForm.append("productId", productId);
    tForm.append("count", "1");
    tForm.append("source", blob("model-print.png"), "selfie.png");
    await fetch(`${BASE}/api/b2b/tryon`, {
      method: "POST",
      headers: H(token, false),
      body: tForm,
    });
  }
  await sleep(4000); // let renders complete

  // ---- Stats JSON ----
  const st = await jf(await fetch(`${BASE}/api/b2b/stats`, { headers: H(token, false) }));
  const s = st.body.stats;
  log("GET /stats returns 200", st.status === 200 && !!s);
  log(
    "Catalogue KPI",
    s?.catalog?.activeProducts === 1 && s?.catalog?.categories === 1,
    `products=${s?.catalog?.activeProducts} categories=${s?.catalog?.categories}`
  );
  log(
    "Credits KPI",
    s?.credits?.balance === 48 && s?.credits?.consumed === 2 && s?.credits?.purchased === 50,
    `balance=${s?.credits?.balance} consumed=${s?.credits?.consumed} purchased=${s?.credits?.purchased}`
  );
  log(
    "Try-ons KPI",
    s?.tryons?.total === 2 && s?.tryons?.completed === 2 && s?.tryons?.successRate === 100,
    `total=${s?.tryons?.total} completed=${s?.tryons?.completed} success=${s?.tryons?.successRate}%`
  );
  log(
    "Series is continuous (14 days)",
    Array.isArray(s?.series) && s.series.length === 14 && s.series.every((d) => "date" in d && "count" in d),
    `points=${s?.series?.length}`
  );
  log(
    "Popular styles ranked",
    Array.isArray(s?.popular) && s.popular[0]?.name === "Lace Front Wig" && s.popular[0]?.count === 2,
    `top=${s?.popular?.[0]?.name} count=${s?.popular?.[0]?.count}`
  );

  // ---- Excel export ----
  const xlsx = await fetch(`${BASE}/api/b2b/stats/export.xlsx`, { headers: H(token, false) });
  const ct = xlsx.headers.get("content-type") || "";
  const cd = xlsx.headers.get("content-disposition") || "";
  const buf = Buffer.from(await xlsx.arrayBuffer());
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b; // "PK" = xlsx/zip magic
  log(
    "Export returns .xlsx",
    xlsx.status === 200 &&
      ct.includes("spreadsheetml") &&
      /attachment; filename=/.test(cd) &&
      isZip &&
      buf.length > 1000,
    `bytes=${buf.length} zip=${isZip}`
  );

  // ---- RBAC on stats ----
  const noAuth = await fetch(`${BASE}/api/b2b/stats`);
  log("Stats requires auth", noAuth.status === 401, `status=${noAuth.status}`);

  return { emails: [email] };
}

async function cleanup() {
  try {
    const { env } = await import("../src/config/env.js");
    const mongoose = (await import("mongoose")).default;
    await mongoose.connect(env.mongoUri);
    const db = mongoose.connection;
    const users = await db.collection("users").find({ email: /^statsverify_/ }).toArray();
    const ids = users.map((u) => u._id);
    const del = async (c, q) => (await db.collection(c).deleteMany(q)).deletedCount;
    await del("tryonjobs", { user: { $in: ids } });
    await del("payments", { user: { $in: ids } });
    await del("creditwallets", { business: { $in: ids } });
    await del("creditledgers", { business: { $in: ids } });
    await del("categories", { business: { $in: ids } });
    await del("products", { business: { $in: ids } });
    const us = await del("users", { email: /^statsverify_/ });
    console.log(`\nCleanup — removed ${us} test business(es) and related data.`);
    await mongoose.disconnect();

    try {
      const { v2: cl } = await import("cloudinary");
      cl.config({ secure: true });
      await cl.api.delete_resources_by_prefix("zdc/catalog").catch(() => ({}));
      await cl.api.delete_resources_by_prefix("zdc/b2b").catch(() => ({}));
    } catch {
      // local fallback — nothing to clean
    }
  } catch (e) {
    console.log("Cleanup skipped:", e.message);
  }
}

main()
  .then(cleanup)
  .catch((e) => {
    console.error("SCRIPT ERROR", e);
    process.exit(1);
  });
