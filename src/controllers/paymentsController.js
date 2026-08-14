import { z } from "zod";
import { TryonJob } from "../models/TryonJob.js";
import { Payment } from "../models/Payment.js";
import { getPaymentProvider } from "../services/payments.js";
import { startProcessing } from "./tryonController.js";
import { consumeFreeTryon } from "../services/referral.js";
import { objectIdField } from "../utils/validators.js";

const paySchema = z.object({
  jobId: objectIdField,
  gateway: z.enum(["stub", "mpesa", "intasend", "referral"]).optional(),
  /** Spend one free try-on reward instead of paying. */
  useFreeTryon: z.coerce.boolean().optional(),
});

export async function payForJob(req, res, next) {
  try {
    if (!req.user?.sub) {
      return res.status(401).json({ error: "Please log in to pay for a try-on" });
    }
    const data = paySchema.parse(req.body);

    const job = await TryonJob.findById(data.jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    if (!job.user || String(job.user) !== String(req.user.sub)) {
      return res.status(403).json({ error: "Not allowed to pay for this job" });
    }
    if (job.status !== "awaiting_payment") {
      return res
        .status(409)
        .json({ error: `Job is not awaiting payment (status: ${job.status})` });
    }

    let payment;
    if (data.useFreeTryon) {
      // Free rewards cover single-image jobs only (1 free try-on = 1 render).
      if (job.imageCount > 1) {
        return res.status(400).json({
          error:
            "Free try-on rewards can only be used on single-image packs. Choose the Single pack or pay normally.",
        });
      }
      const remaining = await consumeFreeTryon(req.user.sub);
      if (remaining === null) {
        return res.status(402).json({ error: "No free try-ons left" });
      }
      payment = await Payment.create({
        user: req.user.sub,
        job: job._id,
        gateway: "referral",
        amount: 0,
        currency: job.currency,
        purpose: "b2c_tryon",
        status: "paid",
        reference: `referral_free_${job._id}`,
        meta: { freeTryon: true, freeTryonsRemaining: remaining },
      });
    } else {
      const provider = getPaymentProvider();
      const charge = await provider.createCharge({
        amount: job.amount,
        currency: job.currency,
        reference: `job_${job._id}`,
      });

      payment = await Payment.create({
        user: req.user.sub,
        job: job._id,
        gateway: data.gateway || charge.gateway,
        amount: job.amount,
        currency: job.currency,
        purpose: "b2c_tryon",
        status: charge.status,
        reference: charge.reference,
      });

      if (charge.status !== "paid") {
        return res.status(402).json({ error: "Payment not completed", payment });
      }
    }

    job.payment = payment._id;
    job.amount = payment.amount;
    job.status = "processing";
    await job.save();

    startProcessing(job._id.toString());

    return res.json({
      payment: {
        id: payment._id.toString(),
        status: payment.status,
        reference: payment.reference,
        gateway: payment.gateway,
        amount: payment.amount,
        currency: payment.currency,
      },
      job: job.toJSONSafe(),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}

/** Logged-in consumer: payment history for try-on packs. */
export async function listMyPayments(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "20", 10)));
    const filter = { user: req.user.sub, purpose: "b2c_tryon" };

    const [total, rows] = await Promise.all([
      Payment.countDocuments(filter),
      Payment.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("job", "pack status resultImageUrls"),
    ]);

    return res.json({
      payments: rows.map((p) => ({
        id: String(p._id),
        status: p.status,
        amount: p.amount,
        currency: p.currency,
        gateway: p.gateway,
        reference: p.reference,
        purpose: p.purpose,
        createdAt: p.createdAt,
        job: p.job
          ? {
              id: String(p.job._id),
              pack: p.job.pack,
              status: p.job.status,
              thumbnail: p.job.resultImageUrls?.[0] || null,
            }
          : null,
      })),
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
      total,
    });
  } catch (err) {
    return next(err);
  }
}
