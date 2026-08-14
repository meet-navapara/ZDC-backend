import mongoose from "mongoose";
import { env } from "./env.js";

function isAtlasUri(uri) {
  return typeof uri === "string" && uri.includes("mongodb.net");
}

function printAtlasHelp(err) {
  const msg = err?.message || "";
  const looksLikeWhitelist =
    /IP that isn't whitelisted|whitelist|Could not connect to any servers/i.test(
      msg
    );
  if (!looksLikeWhitelist || !isAtlasUri(env.mongoUri)) return;

  console.error(`
[db] Atlas refused the connection (usually Network Access / IP whitelist).

Fix in MongoDB Atlas (takes ~1 minute):
  1. Open https://cloud.mongodb.com → your project → Network Access
  2. Click "Add IP Address"
  3. For local dev, click "Allow Access from Anywhere" (0.0.0.0/0)
     or add your current public IP only
  4. Wait 1–2 minutes for the change to apply, then restart: npm run dev

Also confirm Database Access has a user that matches MONGODB_URI in .env.
`);
}

export async function connectDB() {
  mongoose.set("strictQuery", true);
  try {
    await mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log("[db] MongoDB connected");
  } catch (err) {
    console.error("[db] MongoDB connection error:", err.message);
    printAtlasHelp(err);
    throw err;
  }

  mongoose.connection.on("disconnected", () => {
    console.warn("[db] MongoDB disconnected");
  });
}
