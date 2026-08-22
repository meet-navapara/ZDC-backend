import { v2 as cloudinary } from "cloudinary";
import { cloudinaryEnabled } from "../storage.js";
import { listAllBeardStyleTemplates } from "./client.js";

function safePublicId(templateId) {
  return String(templateId || "beard")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);
}

/**
 * Mirror Perfect Corp beard template thumbs to Cloudinary so previews load
 * even when cdn.perfectcorp.com is blocked on the client network.
 */
async function mirrorBeardThumb(templateId, remoteUrl) {
  if (!remoteUrl || !cloudinaryEnabled) return remoteUrl;

  const folder = "zdc/beard-previews";
  const publicId = `${folder}/${safePublicId(templateId)}`;

  try {
    await cloudinary.api.resource(publicId, { resource_type: "image" });
    return cloudinary.url(publicId, { secure: true });
  } catch {
    // not cached yet
  }

  try {
    const result = await cloudinary.uploader.upload(remoteUrl, {
      public_id: publicId,
      overwrite: true,
      resource_type: "image",
    });
    return result.secure_url;
  } catch (err) {
    console.warn(`[beard-previews] cache failed ${templateId}:`, err.message);
    return remoteUrl;
  }
}

export async function getBeardTemplatesWithPreviews() {
  const raw = await listAllBeardStyleTemplates();
  const items = await Promise.all(
    raw.map(async (t) => {
      const remote = t.thumb || null;
      const thumb = remote ? await mirrorBeardThumb(t.id, remote) : null;
      return {
        id: t.id,
        title: t.title || t.id,
        thumb,
        category: t.category_name || "All",
      };
    })
  );
  return items;
}
