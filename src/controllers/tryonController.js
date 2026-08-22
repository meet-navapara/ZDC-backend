import { z } from "zod";
import mongoose from "mongoose";
import { TryonJob, JOB_STATUSES } from "../models/TryonJob.js";
import { User } from "../models/User.js";
import { getPack, getB2cPacks, getCreditPacksDual } from "../services/pricing.js";
import { getRenderer } from "../services/renderer.js";
import { uploadImage } from "../services/storage.js";
import { refundCredits } from "../services/credits.js";
import { capture } from "../services/analytics.js";
import { slugField, emailField, optionalText, LIMITS } from "../utils/validators.js";
import { env } from "../config/env.js";
import {
  PERFECTCORP_FEATURE_OPTIONS,
  normalizePerfectCorpFeature,
  isKnownPerfectCorpFeature,
  featureNeedsReferenceImage,
  getHairColorOptions,
  isValidHairColorPreset,
  normalizeHairColorPreset,
  parseMultiValueField,
  joinMultiValueField,
} from "../services/perfectcorp/features.js";
import { isPerfectCorpConfigured } from "../services/perfectcorp/renderer.js";
import { listAllBeardStyleTemplates } from "../services/perfectcorp/client.js";
import { getBeardTemplatesWithPreviews } from "../services/perfectcorp/beardPreviews.js";

const ALLOWED_THUMB_HOSTS = new Set([
  "cdn.perfectcorp.com",
  "plugins-media.makeupar.com",
]);

export async function proxyPerfectCorpThumbnail(req, res, next) {
  try {
    const raw = req.query.url;
    if (!raw || typeof raw !== "string") {
      return res.status(400).json({ error: "Missing url" });
    }
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return res.status(400).json({ error: "Invalid url" });
    }
    if (
      parsed.protocol !== "https:" ||
      !ALLOWED_THUMB_HOSTS.has(parsed.hostname)
    ) {
      return res.status(400).json({ error: "Thumbnail host not allowed" });
    }

    const upstream = await fetch(parsed.toString(), {
      headers: { Accept: "image/*", "User-Agent": "zdc-backend/1.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) {
      return res.status(502).json({ error: "Thumbnail unavailable" });
    }

    const ct = upstream.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=86400");
    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.send(buf);
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      return res.status(504).json({ error: "Thumbnail fetch timed out" });
    }
    return next(err);
  }
}

const createSchema = z.object({
  pack: slugField,
  email: emailField.optional().or(z.literal("")),
  whatsapp: optionalText(LIMITS.phone),
  feature: optionalText(32).optional(),
  hairColorPreset: optionalText(64).optional(),
  hairColorPresets: optionalText(512).optional(),
  beardTemplateId: optionalText(64).optional(),
  beardTemplateIds: optionalText(512).optional(),
});

let beardTemplatesCache = { at: 0, items: [] };
const BEARD_CACHE_MS = 15 * 60 * 1000;

async function getBeardTemplatesForOptions() {
  if (Date.now() - beardTemplatesCache.at < BEARD_CACHE_MS && beardTemplatesCache.items.length) {
    return beardTemplatesCache.items;
  }
  try {
    const items = await getBeardTemplatesWithPreviews();
    beardTemplatesCache = { at: Date.now(), items };
  } catch (err) {
    console.warn("[perfectcorp] beard templates:", err.message);
  }
  return beardTemplatesCache.items;
}

export async function listPricing(req, res, next) {
  try {
    const user = req.user?.sub ? await User.findById(req.user.sub) : null;
    // B2C always gets dual KES+INR so the customer can pick a gateway.
    const dualPrices = !user || user.role === "b2c";
    const packs = await getB2cPacks(user, { dualPrices });
    const creditPacks = !user ? await getCreditPacksDual() : undefined;
    return res.json({
      packs,
      ...(creditPacks ? { creditPacks } : {}),
    });
  } catch (err) {
    return next(err);
  }
}

export async function listPerfectCorpOptions(req, res, next) {
  try {
    const beardTemplates = await getBeardTemplatesForOptions();
    return res.json({
      configured: isPerfectCorpConfigured(),
      defaultFeature: normalizePerfectCorpFeature(env.perfectcorp.defaultFeature),
      defaultHairColorPreset: normalizeHairColorPreset(env.perfectcorp.hairColorPreset),
      defaultBeardTemplateId:
        env.perfectcorp.beardTemplateId.trim() ||
        beardTemplates[0]?.id ||
        "all_anchor",
      features: PERFECTCORP_FEATURE_OPTIONS,
      hairColors: getHairColorOptions(),
      beardTemplates,
    });
  } catch (err) {
    return next(err);
  }
}

function referenceImageLabel(feature, count) {
  const word =
    feature === "hair"
      ? "hairstyle"
      : feature === "haircolor"
        ? "hair color"
        : feature === "beard"
          ? "beard style"
          : "outfit";
  return `${count} ${word} image${count > 1 ? "s" : ""}`;
}

export async function createJob(req, res, next) {
  try {
    if (!req.user?.sub) {
      return res.status(401).json({ error: "Please log in to start a try-on" });
    }
    const data = createSchema.parse(req.body);
    const user = await User.findById(req.user.sub);
    const pack = await getPack(data.pack, user);
    if (!pack) {
      return res.status(400).json({ error: "Invalid pack" });
    }

    const source = req.files?.source?.[0];
    const targets = req.files?.target || [];
    if (!source) {
      return res
        .status(400)
        .json({ error: "A 'source' (selfie) image is required" });
    }

    const feature = data.feature
      ? normalizePerfectCorpFeature(data.feature)
      : normalizePerfectCorpFeature(env.perfectcorp.defaultFeature);
    if (data.feature && !isKnownPerfectCorpFeature(feature)) {
      return res.status(400).json({ error: "Invalid try-on feature" });
    }

    const needsRef = featureNeedsReferenceImage(feature);

    if (needsRef && targets.length !== pack.images) {
      return res.status(400).json({
        error: `This pack needs ${referenceImageLabel(feature, pack.images)} (received ${targets.length}).`,
      });
    }
    if (!needsRef && targets.length > 0) {
      return res.status(400).json({
        error:
          feature === "haircolor"
            ? "Hair color try-on uses a color preset — do not upload reference images."
            : "Beard try-on uses a style from the catalog — do not upload reference images.",
      });
    }

    let hairColorPreset = null;
    let beardTemplateId = null;

    if (feature === "haircolor") {
      const envDefault = normalizeHairColorPreset(env.perfectcorp.hairColorPreset);
      const rawPresets =
        req.body.hairColorPresets ||
        req.body.hairColorPreset ||
        envDefault;
      const presetList = parseMultiValueField(rawPresets, pack.images, envDefault);
      for (const p of presetList) {
        if (!isValidHairColorPreset(p)) {
          return res.status(400).json({ error: `Invalid hair color preset: ${p}` });
        }
      }
      hairColorPreset = joinMultiValueField(presetList);
    }

    if (feature === "beard") {
      const envDefault =
        env.perfectcorp.beardTemplateId.trim() ||
        (await getBeardTemplatesForOptions())[0]?.id ||
        "";
      const rawTemplates =
        req.body.beardTemplateIds ||
        req.body.beardTemplateId ||
        envDefault;
      const templateList = parseMultiValueField(rawTemplates, pack.images, envDefault);
      if (!templateList.every(Boolean)) {
        return res.status(400).json({ error: "Choose a beard style." });
      }
      beardTemplateId = joinMultiValueField(templateList);
    }

    const [srcUp, ...tgtUps] = await Promise.all([
      uploadImage(source.buffer, {
        folder: "zdc/tryon/source",
        originalName: source.originalname,
      }),
      ...(needsRef
        ? targets.map((t) =>
            uploadImage(t.buffer, {
              folder: "zdc/tryon/target",
              originalName: t.originalname,
            })
          )
        : []),
    ]);

    const targetUrls = needsRef
      ? tgtUps.map((u) => u.url)
      : Array.from({ length: pack.images }, () => srcUp.url);

    const job = await TryonJob.create({
      user: req.user.sub,
      channel: "b2c",
      pack: pack.id,
      imageCount: pack.images,
      amount: pack.amount,
      currency: pack.currency,
      sourceImageUrl: srcUp.url,
      targetImageUrl: targetUrls[0],
      targetImageUrls: targetUrls,
      perfectcorpFeature: feature,
      perfectcorpPreset: hairColorPreset,
      perfectcorpTemplateId: beardTemplateId,
      status: "awaiting_payment",
      deliverTo: {
        email: data.email || null,
        whatsapp: data.whatsapp || null,
      },
    });

    return res.status(201).json({ job: job.toJSONSafe() });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}

export async function getJob(req, res, next) {
  try {
    const job = await TryonJob.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    // Jobs tied to an account are only visible to that user (or admins via other routes).
    if (job.user) {
      if (!req.user?.sub || String(job.user) !== String(req.user.sub)) {
        return res.status(404).json({ error: "Job not found" });
      }
    }
    return res.json({ job: job.toJSONSafe() });
  } catch (err) {
    return next(err);
  }
}

/** Logged-in consumer: list own try-on jobs (newest first). */
export async function listMyJobs(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "20", 10)));
    const filter = { user: req.user.sub, channel: "b2c" };
    if (req.query.status && JOB_STATUSES.includes(req.query.status)) {
      filter.status = req.query.status;
    }

    const [total, jobs] = await Promise.all([
      TryonJob.countDocuments(filter),
      TryonJob.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    return res.json({
      jobs: jobs.map((j) => j.toJSONSafe()),
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
      total,
    });
  } catch (err) {
    return next(err);
  }
}

/** Logged-in consumer dashboard summary. */
export async function getMyStats(req, res, next) {
  try {
    const uid = req.user.sub;
    const filter = { user: uid, channel: "b2c" };
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      total,
      completed,
      failed,
      processing,
      todayCount,
      spendAgg,
      recent,
    ] = await Promise.all([
      TryonJob.countDocuments(filter),
      TryonJob.countDocuments({ ...filter, status: "completed" }),
      TryonJob.countDocuments({ ...filter, status: "failed" }),
      TryonJob.countDocuments({
        ...filter,
        status: { $in: ["processing", "awaiting_payment"] },
      }),
      TryonJob.countDocuments({ ...filter, createdAt: { $gte: today } }),
      TryonJob.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(uid),
            channel: "b2c",
            status: "completed",
          },
        },
        {
          $group: {
            _id: "$currency",
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
      TryonJob.find({ ...filter, status: "completed" })
        .sort({ createdAt: -1 })
        .limit(6),
    ]);

    const spend = spendAgg[0]
      ? { amount: spendAgg[0].total, currency: spendAgg[0]._id || "KES" }
      : { amount: 0, currency: "KES" };

    return res.json({
      stats: {
        total,
        completed,
        failed,
        processing,
        today: todayCount,
        spentTotal: spend.amount,
        currency: spend.currency,
      },
      recent: recent.map((j) => j.toJSONSafe()),
    });
  } catch (err) {
    return next(err);
  }
}

// Kicks off rendering (called after payment succeeds). Simulates async
// processing so the frontend can poll a "processing" -> "completed" transition.
export function startProcessing(jobId) {
  setTimeout(async () => {
    try {
      const job = await TryonJob.findById(jobId);
      if (!job || job.status !== "processing") return;

      const renderer = getRenderer();
      const targetUrls =
        job.targetImageUrls && job.targetImageUrls.length
          ? job.targetImageUrls
          : [job.targetImageUrl];
      const raw = await renderer.render({
        sourceUrl: job.sourceImageUrl,
        targetUrls,
        feature: job.perfectcorpFeature,
        hairColorPreset: job.perfectcorpPreset,
        beardTemplateId: job.perfectcorpTemplateId,
        count: job.imageCount,
      });
      const results = Array.isArray(raw) ? raw : raw.urls;
      if (!Array.isArray(raw) && raw.taskIds?.length) {
        job.perfectcorpRef = raw.taskIds.join("|");
      }

      job.resultImageUrls = results;
      job.status = "completed";
      await job.save();

      if (job.user) {
        capture(job.user, "render_completed", {
          channel: job.channel,
          imageCount: job.imageCount,
          creditsCost: job.creditsCost,
        });
      }
    } catch (err) {
      console.error("[tryon] render failed:", err.message);
      try {
        const job = await TryonJob.findById(jobId);
        if (job) {
          job.status = "failed";
          job.error = err.message;
          await job.save();
          // Refund reserved credits for failed B2B renders.
          if (job.channel === "b2b" && job.creditsCost > 0 && job.user) {
            await refundCredits(job.user, job.creditsCost, {
              note: "Refund for failed render",
              job: job._id,
            });
          }
        }
      } catch {
        // noop
      }
    }
  }, 2500);
}
