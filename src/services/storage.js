// Image storage provider. Uploads user images + rendered results to Cloudinary
// so nothing is persisted on the server's local disk in production.
//
// Configure via either CLOUDINARY_URL, or the three CLOUDINARY_* vars.
// If Cloudinary is not configured, a local-disk fallback is used ONLY for
// local development so the app still runs; production must set Cloudinary.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { v2 as cloudinary } from "cloudinary";

const hasUrl = !!process.env.CLOUDINARY_URL;
const hasVars = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

export const cloudinaryEnabled = hasUrl || hasVars;

if (cloudinaryEnabled) {
  if (hasVars) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  } else {
    // CLOUDINARY_URL is read automatically by the SDK
    cloudinary.config({ secure: true });
  }
} else {
  console.warn(
    "[storage] Cloudinary not configured — using LOCAL disk fallback (dev only). Set CLOUDINARY_URL to enable cloud storage."
  );
}

const LOCAL_DIR = path.resolve(process.env.FILE_STORAGE_DIR || "uploads");
if (!cloudinaryEnabled) fs.mkdirSync(LOCAL_DIR, { recursive: true });

/**
 * Uploads an image buffer and returns a public URL + provider metadata.
 * @param {Buffer} buffer
 * @param {{ folder?: string, originalName?: string }} opts
 * @returns {Promise<{ url: string, publicId: string|null, provider: string }>}
 */
export async function uploadImage(buffer, { folder = "zdc", originalName } = {}) {
  if (cloudinaryEnabled) {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: "image" },
        (err, result) => {
          if (err) return reject(err);
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            provider: "cloudinary",
          });
        }
      );
      stream.end(buffer);
    });
  }

  // Local fallback (development only)
  const ext = (path.extname(originalName || "") || ".png").toLowerCase();
  const name = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}${ext}`;
  fs.writeFileSync(path.join(LOCAL_DIR, name), buffer);
  return { url: `/uploads/${name}`, publicId: null, provider: "local" };
}

/**
 * Uploads a remote image (by URL) to storage — used to persist rendered
 * results returned by the AI provider.
 */
export async function uploadFromUrl(remoteUrl, { folder = "zdc" } = {}) {
  if (cloudinaryEnabled) {
    const result = await cloudinary.uploader.upload(remoteUrl, {
      folder,
      resource_type: "image",
    });
    return {
      url: result.secure_url,
      publicId: result.public_id,
      provider: "cloudinary",
    };
  }
  // In local fallback we just pass the URL through.
  return { url: remoteUrl, publicId: null, provider: "local" };
}
