import { env } from "../../config/env.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {string} path e.g. /s2s/v2.0/task/cloth
 */
async function yceRequest(path, { method = "GET", body } = {}) {
  if (!env.perfectcorp.apiKey) {
    const err = new Error("PERFECTCORP_API_KEY is not configured");
    err.status = 503;
    throw err;
  }

  const res = await fetch(`${env.perfectcorp.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.perfectcorp.apiKey}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.error_message ||
      data?.error ||
      data?.message ||
      `YouCam API HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status >= 500 ? 502 : res.status;
    err.code = data?.error_code || null;
    throw err;
  }
  if (data?.status && data.status !== 200) {
    const err = new Error(data?.error || data?.error_message || "YouCam API error");
    err.status = 502;
    err.code = data?.error_code || null;
    throw err;
  }
  return data;
}

/**
 * Poll async task until success or error.
 * @param {{ apiVersion: string, feature: string, taskId: string }} opts
 */
export async function pollTask({ apiVersion, feature, taskId }) {
  const encoded = encodeURIComponent(taskId);
  const path = `/s2s/${apiVersion}/task/${feature}/${encoded}`;
  const { pollIntervalMs, pollMaxAttempts } = env.perfectcorp;

  for (let attempt = 0; attempt < pollMaxAttempts; attempt += 1) {
    const res = await yceRequest(path);
    const data = res?.data || {};
    const status = data.task_status;

    if (status === "success") {
      const url = data.results?.url;
      if (!url) {
        throw new Error("YouCam task succeeded but returned no image URL");
      }
      return { url, taskId, raw: data };
    }

    if (status === "error" || data.error) {
      throw new Error(
        data.error_message || data.error || "YouCam rendering failed"
      );
    }

    await sleep(pollIntervalMs);
  }

  throw new Error("YouCam task timed out while waiting for the render");
}

/** AI Clothes virtual try-on — apparel / outfit swap. */
export async function runClothTryOn({ sourceUrl, refUrl }) {
  const res = await yceRequest("/s2s/v2.0/task/cloth", {
    method: "POST",
    body: {
      src_file_url: sourceUrl,
      ref_file_url: refUrl,
      garment_category: env.perfectcorp.garmentCategory,
      change_shoes: env.perfectcorp.changeShoes,
    },
  });
  const taskId = res?.data?.task_id;
  if (!taskId) throw new Error("YouCam cloth task did not return task_id");
  return pollTask({ apiVersion: "v2.0", feature: "cloth", taskId });
}

/** AI Hairstyle transfer (reference hairstyle image). */
export async function runHairTransferTryOn({ sourceUrl, refUrl }) {
  const res = await yceRequest("/s2s/v2.1/task/hair-transfer", {
    method: "POST",
    body: {
      src_file_url: sourceUrl,
      ref_file_url: refUrl,
    },
  });
  const taskId = res?.data?.task_id;
  if (!taskId) throw new Error("YouCam hair task did not return task_id");
  return pollTask({ apiVersion: "v2.1", feature: "hair-transfer", taskId });
}

/** AI Hair Color — preset, pattern, or custom palettes (preset is simplest). */
export async function runHairColorTryOn({ sourceUrl, preset, pattern, palettes }) {
  const body = { src_file_url: sourceUrl };
  if (preset) body.preset = preset;
  if (pattern) body.pattern = pattern;
  if (palettes) body.palettes = palettes;

  const res = await yceRequest("/s2s/v2.0/task/hair-color", {
    method: "POST",
    body,
  });
  const taskId = res?.data?.task_id;
  if (!taskId) throw new Error("YouCam hair-color task did not return task_id");
  return pollTask({ apiVersion: "v2.0", feature: "hair-color", taskId });
}

/** AI Beard Style — uses predefined template_id from YouCam catalog. */
export async function runBeardStyleTryOn({ sourceUrl, templateId }) {
  if (!templateId) {
    throw new Error("Beard style requires a template_id (pick a style in the studio)");
  }
  const res = await yceRequest("/s2s/v2.0/task/beard-style", {
    method: "POST",
    body: {
      src_file_url: sourceUrl,
      template_id: templateId,
    },
  });
  const taskId = res?.data?.task_id;
  if (!taskId) throw new Error("YouCam beard task did not return task_id");
  return pollTask({ apiVersion: "v2.0", feature: "beard-style", taskId });
}

/** List beard style templates (paginated). */
export async function listBeardStyleTemplates({
  pageSize = 20,
  startingToken = null,
} = {}) {
  const qs = new URLSearchParams({ page_size: String(pageSize) });
  if (startingToken) qs.set("starting_token", String(startingToken));
  const res = await yceRequest(
    `/s2s/v2.0/task/template/beard-style?${qs.toString()}`
  );
  return {
    templates: res?.data?.templates || [],
    nextToken: res?.data?.next_token ?? null,
  };
}

/** Fetch all beard templates (usually ~15 styles). */
export async function listAllBeardStyleTemplates() {
  const all = [];
  let token = null;
  for (let page = 0; page < 10; page += 1) {
    const res = await listBeardStyleTemplates({
      pageSize: 20,
      startingToken: token,
    });
    all.push(...res.templates);
    if (!res.nextToken) break;
    token = res.nextToken;
  }
  return all;
}

/** Check remaining API credits (optional health probe). */
export async function fetchCreditBalance() {
  const res = await yceRequest("/s2s/v1.0/client/credit");
  return res?.data ?? res;
}

export function isPublicImageUrl(url) {
  if (!url || typeof url !== "string") return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (/localhost|127\.0\.0\.1|\/uploads\//i.test(url)) return false;
  return true;
}
