import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { env } from "../src/config/env.js";
import { User } from "../src/models/User.js";

const BASE = process.env.BASE || "http://localhost:8080";

function log(step, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${extra ? " — " + extra : ""}`);
  if (!ok) process.exitCode = 1;
}

async function jf(res) {
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

const H = (t, json = true) => {
  const h = { Authorization: `Bearer ${t}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
};

const adminEmail = `adminverify_${Date.now()}@zdc.app`;
const b2bEmail = `adminverify_b2b_${Date.now()}@zdc.app`;

async function main() {
  // Seed an admin directly (as the create-admin script would).
  await mongoose.connect(env.mongoUri);
  await User.create({
    email: adminEmail,
    passwordHash: await bcrypt.hash("adminpass123", 10),
    role: "admin",
    status: "active",
  });
  await mongoose.disconnect();

  // Admin login
  const adminLogin = await jf(
    await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adminEmail, password: "adminpass123" }),
    })
  );
  const adminToken = adminLogin.body.token;
  log("Admin login", adminLogin.status === 200 && adminLogin.body.user?.role === "admin");

  // Register a B2B (captures its token before any suspension)
  const reg = await jf(
    await fetch(`${BASE}/api/b2b/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: b2bEmail,
        password: "password123",
        business: { name: "Admin Verify Shop", category: "boutique" },
      }),
    })
  );
  const b2bToken = reg.body.token;
  const b2bId = reg.body.user?.id;
  log("B2B registered (active by default)", reg.status === 201 && reg.body.user?.status === "active");

  // Overview
  const ov = await jf(await fetch(`${BASE}/api/admin/overview`, { headers: H(adminToken, false) }));
  log(
    "Admin overview",
    ov.status === 200 && typeof ov.body.overview?.users?.total === "number" && ov.body.overview.users.b2b >= 1,
    `total=${ov.body.overview?.users?.total} b2b=${ov.body.overview?.users?.b2b}`
  );

  // List + search finds the business
  const list = await jf(
    await fetch(`${BASE}/api/admin/users?role=b2b&q=Admin%20Verify%20Shop`, { headers: H(adminToken, false) })
  );
  log(
    "List/search users",
    list.status === 200 && list.body.users?.some((u) => u.id === b2bId),
    `found=${list.body.users?.length}`
  );

  // Suspend -> B2B action blocked immediately (existing token)
  const susp = await jf(
    await fetch(`${BASE}/api/admin/users/${b2bId}/status`, {
      method: "PATCH",
      headers: H(adminToken),
      body: JSON.stringify({ status: "suspended" }),
    })
  );
  const blocked = await fetch(`${BASE}/api/b2b/me`, { headers: H(b2bToken, false) });
  log("Suspend blocks B2B access", susp.status === 200 && blocked.status === 403, `me=${blocked.status}`);

  // Suspended cannot log in
  const suspLogin = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: b2bEmail, password: "password123" }),
  });
  log("Suspended login rejected", suspLogin.status === 403, `status=${suspLogin.status}`);

  // Reactivate -> access restored
  await fetch(`${BASE}/api/admin/users/${b2bId}/status`, {
    method: "PATCH",
    headers: H(adminToken),
    body: JSON.stringify({ status: "active" }),
  });
  const restored = await fetch(`${BASE}/api/b2b/me`, { headers: H(b2bToken, false) });
  log("Reactivate restores access", restored.status === 200, `me=${restored.status}`);

  // Pending -> blocked with pending message
  await fetch(`${BASE}/api/admin/users/${b2bId}/status`, {
    method: "PATCH",
    headers: H(adminToken),
    body: JSON.stringify({ status: "pending" }),
  });
  const pend = await jf(await fetch(`${BASE}/api/b2b/me`, { headers: H(b2bToken, false) }));
  log("Pending blocks access", pend.status === 403 && /pending/i.test(pend.body.error || ""), `msg=${pend.body.error}`);
  // back to active
  await fetch(`${BASE}/api/admin/users/${b2bId}/status`, {
    method: "PATCH",
    headers: H(adminToken),
    body: JSON.stringify({ status: "active" }),
  });

  // Reset password -> login with new password
  const rp = await fetch(`${BASE}/api/admin/users/${b2bId}/reset-password`, {
    method: "POST",
    headers: H(adminToken),
    body: JSON.stringify({ password: "newpass456" }),
  });
  const newLogin = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: b2bEmail, password: "newpass456" }),
  });
  log("Admin reset password works", rp.status === 200 && newLogin.status === 200, `login=${newLogin.status}`);

  // User detail includes B2B stats
  const detail = await jf(await fetch(`${BASE}/api/admin/users/${b2bId}`, { headers: H(adminToken, false) }));
  log(
    "User detail with stats",
    detail.status === 200 && detail.body.stats && typeof detail.body.stats.credits === "number",
    `credits=${detail.body.stats?.credits}`
  );

  // RBAC: B2B blocked from admin API
  const rbac = await fetch(`${BASE}/api/admin/overview`, { headers: H(newLogin ? (await jf(newLogin)).body?.token : b2bToken, false) });
  log("RBAC blocks B2B from admin", rbac.status === 403, `status=${rbac.status}`);

  // Admin cannot delete an admin (guard) — try deleting self
  const adminId = adminLogin.body.user?.id;
  const selfDel = await fetch(`${BASE}/api/admin/users/${adminId}`, { method: "DELETE", headers: H(adminToken, false) });
  log("Cannot delete admin account", selfDel.status === 400, `status=${selfDel.status}`);

  // Delete the B2B user
  const del = await fetch(`${BASE}/api/admin/users/${b2bId}`, { method: "DELETE", headers: H(adminToken, false) });
  const gone = await fetch(`${BASE}/api/admin/users/${b2bId}`, { headers: H(adminToken, false) });
  log("Delete user removes it", del.status === 200 && gone.status === 404, `del=${del.status} get=${gone.status}`);
}

async function cleanup() {
  try {
    await mongoose.connect(env.mongoUri);
    const db = mongoose.connection;
    const users = await db.collection("users").find({ email: /^adminverify_/ }).toArray();
    const ids = users.map((u) => u._id);
    const del = async (c, q) => (await db.collection(c).deleteMany(q)).deletedCount;
    await del("tryonjobs", { user: { $in: ids } });
    await del("payments", { user: { $in: ids } });
    await del("creditwallets", { business: { $in: ids } });
    await del("creditledgers", { business: { $in: ids } });
    await del("categories", { business: { $in: ids } });
    await del("products", { business: { $in: ids } });
    const us = await del("users", { email: /^adminverify_/ });
    console.log(`\nCleanup — removed ${us} test account(s).`);
    await mongoose.disconnect();
  } catch (e) {
    console.log("Cleanup skipped:", e.message);
  }
}

main()
  .then(cleanup)
  .catch(async (e) => {
    console.error("SCRIPT ERROR", e);
    await cleanup();
    process.exit(1);
  });
