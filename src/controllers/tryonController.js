import { z } from "zod";
import mongoose from "mongoose";
import { TryonJob, JOB_STATUSES } from "../models/TryonJob.js";
import { getPack, getB2cPacks } from "../services/pricing.js";
import { getRenderer } from "../services/renderer.js";
import { uploadImage } from "../services/storage.js";
import { refundCredits } from "../services/credits.js";
import { capture } from "../services/analytics.js";
import { slugField, emailField, optionalText, LIMITS } from "../utils/validators.js";

const createSchema = z.object({
  pack: slugField,
  email: emailField.optional().or(z.literal("")),
  whatsapp: optionalText(LIMITS.phone),
});

export async function listPricing(req, res, next) {
  try {
    const packs = await getB2cPacks();
    return res.json({ packs });
  } catch (err) {
    return next(err);
  }
}

export async function createJob(req, res, next) {
  try {
    if (!req.user?.sub) {
      return res.status(401).json({ error: "Please log in to start a try-on" });
    }
    const data = createSchema.parse(req.body);
    const pack = await getPack(data.pack);
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
    // Each rendered image comes from its own uploaded outfit/hairstyle, so the
    // number of target images must match the pack's image count.
    if (targets.length !== pack.images) {
      return res.status(400).json({
        error: `This pack needs ${pack.images} outfit image${
          pack.images > 1 ? "s" : ""
        } (received ${targets.length}).`,
      });
    }

    // Upload all images to cloud storage (Cloudinary) — never stored locally.
    const [srcUp, ...tgtUps] = await Promise.all([
      uploadImage(source.buffer, {
        folder: "zdc/tryon/source",
        originalName: source.originalname,
      }),
      ...targets.map((t) =>
        uploadImage(t.buffer, {
          folder: "zdc/tryon/target",
          originalName: t.originalname,
        })
      ),
    ]);

    const targetUrls = tgtUps.map((u) => u.url);

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
      const results = await renderer.render({
        sourceUrl: job.sourceImageUrl,
        targetUrls,
      });

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
