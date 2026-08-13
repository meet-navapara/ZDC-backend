// Creates (or promotes) a Super Admin account.
// Usage:
//   node scripts/create-admin.mjs <email> <password>
//   or set ADMIN_EMAIL / ADMIN_PASSWORD env vars and run without args.
import bcrypt from "bcryptjs";
import { env } from "../src/config/env.js";
import mongoose from "mongoose";
import { User } from "../src/models/User.js";

const email = (process.argv[2] || process.env.ADMIN_EMAIL || "").toLowerCase().trim();
const password = process.argv[3] || process.env.ADMIN_PASSWORD || "";

if (!email || !password) {
  console.error(
    "Usage: node scripts/create-admin.mjs <email> <password>\n" +
      "   (or set ADMIN_EMAIL and ADMIN_PASSWORD)"
  );
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

async function run() {
  await mongoose.connect(env.mongoUri);
  const passwordHash = await bcrypt.hash(password, 10);

  const existing = await User.findOne({ email });
  if (existing) {
    existing.role = "admin";
    existing.status = "active";
    existing.passwordHash = passwordHash;
    await existing.save();
    console.log(`Updated existing user to admin: ${email}`);
  } else {
    await User.create({ email, passwordHash, role: "admin", status: "active" });
    console.log(`Created admin: ${email}`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
