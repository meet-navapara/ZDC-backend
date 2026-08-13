import fs from "fs";
import path from "path";

const BASE = process.env.BASE || "http://localhost:8080";
const IMG_DIR = path.resolve("../frontend/public/images");

function log(step, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${extra ? " — " + extra : ""}`);
  if (!ok) process.exitCode = 1;
}
function blob(name) {
  return new Blob([fs.readFileSync(path.join(IMG_DIR, name))], { type: "image/png" });
}
const H = (t, json = true) => ({
  Authorization: `Bearer ${t}`,
  ...(json ? { "Content-Type": "application/json" } : {}),
});
async function jf(res) {
  const t = await res.text();
  try {
    return { status: res.status, body: JSON.parse(t) };
  } catch {
    return { status: res.status, body: t };
  }
}

async function main() {
  const email = `b2bverify_gaps_${Date.now()}@zdc.app`;
  const reg = await jf(
    await fetch(`${BASE}/api/b2b/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "password123",
        business: {
          name: "Gap Test",
          category: "boutique",
          address: { line1: "1 St", city: "Nairobi", country: "Kenya", lat: -1.29, lng: 36.82 },
        },
      }),
    })
  );
  const token = reg.body.token;
  log("Register with lat/lng", reg.status === 201 && reg.body.user?.business?.address?.lat === -1.29, `lat=${reg.body.user?.business?.address?.lat}`);

  // Category rename
  const cat = await jf(
    await fetch(`${BASE}/api/b2b/categories`, {
      method: "POST",
      headers: H(token),
      body: JSON.stringify({ name: "Old Name" }),
    })
  );
  const catId = cat.body.category?.id;
  const ren = await jf(
    await fetch(`${BASE}/api/b2b/categories/${catId}`, {
      method: "PATCH",
      headers: H(token),
      body: JSON.stringify({ name: "New Name" }),
    })
  );
  log("Rename category", ren.status === 200 && ren.body.category?.name === "New Name", `name=${ren.body.category?.name}`);

  // Product with 2 images
  const pf = new FormData();
  pf.append("name", "Multi Image Dress");
  pf.append("images", blob("apparel.png"), "a.png");
  pf.append("images", blob("streetwear.png"), "b.png");
  const prod = await jf(
    await fetch(`${BASE}/api/b2b/products`, { method: "POST", headers: H(token, false), body: pf })
  );
  const productId = prod.body.product?.id;
  const imgs = prod.body.product?.imageUrls || [];
  log("Create product with 2 images", prod.status === 201 && imgs.length === 2, `images=${imgs.length}`);

  // Update: keep only first image, add a new one -> should end with 2
  const uf = new FormData();
  uf.append("imageUrls", JSON.stringify([imgs[0]]));
  uf.append("images", blob("menswear.png"), "c.png");
  const upd = await jf(
    await fetch(`${BASE}/api/b2b/products/${productId}`, { method: "PATCH", headers: H(token, false), body: uf })
  );
  const upImgs = upd.body.product?.imageUrls || [];
  log(
    "Update product images (remove 1, add 1)",
    upd.status === 200 && upImgs.length === 2 && upImgs[0] === imgs[0] && upImgs[1] !== imgs[1],
    `images=${upImgs.length}`
  );

  return email;
}

async function cleanup() {
  try {
    const { env } = await import("../src/config/env.js");
    const mongoose = (await import("mongoose")).default;
    await mongoose.connect(env.mongoUri);
    const db = mongoose.connection;
    const users = await db.collection("users").find({ email: /^b2bverify_gaps_/ }).toArray();
    const ids = users.map((u) => u._id);
    for (const c of ["tryonjobs", "payments", "categories", "products"]) {
      await db.collection(c).deleteMany({ business: { $in: ids } }).catch(() => {});
      await db.collection(c).deleteMany({ user: { $in: ids } }).catch(() => {});
    }
    await db.collection("creditwallets").deleteMany({ business: { $in: ids } });
    await db.collection("creditledgers").deleteMany({ business: { $in: ids } });
    const u = await db.collection("users").deleteMany({ email: /^b2bverify_gaps_/ });
    console.log(`\nCleanup — users:${u.deletedCount}`);
    await mongoose.disconnect();
    try {
      const { v2: cl } = await import("cloudinary");
      cl.config({ secure: true });
      const r = await cl.api.delete_resources_by_prefix("zdc/catalog").catch(() => ({}));
      console.log(`Cloudinary catalog assets cleared: ${Object.keys(r.deleted || {}).length}`);
    } catch {
      /* local fallback */
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
