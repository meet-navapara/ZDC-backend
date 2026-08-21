import { z } from "zod";
import { TryonJob } from "../models/TryonJob.js";
import { Payment } from "../models/Payment.js";
import { User } from "../models/User.js";
import {
  getPaymentProvider,
  resolveGateway,
  publicPaymentMethods,
} from "../services/payments.js";
import { startProcessing } from "./tryonController.js";
import { consumeFreeTryon } from "../services/referral.js";
import { objectIdField } from "../utils/validators.js";
import {
  isMpesaLive,
  stkQuery,
  mapStkResultCode,
} from "../services/mpesa/daraja.js";
import { applyVerifiedPayment } from "../services/mpesa/fulfill.js";
import { scheduleSandboxAutoPaid } from "../services/mpesa/sandboxAutoPaid.js";

const paySchema = z.object({
  jobId: objectIdField,
  gateway: z
    .enum(["stub", "mpesa", "razorpay", "intasend", "referral", "auto"])
    .optional(),
  phone: z.string().trim().min(9).max(20).optional(),
  useFreeTryon: z.coerce.boolean().optional(),
});

export function serializePayment(payment) {
  const base = {
    id: payment._id.toString(),
    status: payment.status,
    reference: payment.reference,
    gateway: payment.gateway,
    amount: payment.amount,
    currency: payment.currency,
    purpose: payment.purpose,
    job: payment.job ? String(payment.job) : null,
    failureReason: payment.failureReason || null,
    providerCheckoutId: payment.providerCheckoutId || null,
    customerMessage: payment.meta?.customerMessage || null,
    createdAt: payment.createdAt,
  };
  if (payment.gateway === "razorpay") {
    base.razorpay = {
      keyId: payment.meta?.razorpayKeyId || null,
      orderId:
        payment.providerCheckoutId || payment.meta?.razorpayOrderId || null,
      amountPaise: payment.meta?.amountPaise || null,
    };
  }
  return base;
}

export async function listPaymentMethods(req, res, next) {
  try {
    const user = req.user?.sub ? await User.findById(req.user.sub) : null;
    return res.json(publicPaymentMethods(user));
  } catch (err) {
    return next(err);
  }
}

export async function payForJob(req, res, next) {
  try {
    if (!req.user?.sub) {
      return res.status(401).json({ error: "Please log in to pay for a try-on" });
    }
    const data = paySchema.parse(req.body);
    const user = await User.findById(req.user.sub);

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
      const requested =
        data.gateway === "auto" || !data.gateway ? null : data.gateway;
      const gateway = resolveGateway(requested, user, {
        currency: job.currency,
      });
      const provider = getPaymentProvider(gateway);
      const phone =
        data.phone ||
        user?.phone ||
        user?.business?.whatsapp ||
        null;

      const charge = await provider.createCharge({
        amount: job.amount,
        currency: job.currency,
        reference: `job_${job._id}`,
        phone,
        description: "zimji try-on",
      });

      payment = await Payment.create({
        user: req.user.sub,
        job: job._id,
        gateway: charge.gateway,
        amount: job.amount,
        currency: job.currency,
        purpose: "b2c_tryon",
        status: charge.status,
        reference: charge.reference,
        providerCheckoutId: charge.providerCheckoutId || null,
        providerInvoiceId: charge.providerInvoiceId || undefined,
        meta: charge.meta || null,
      });

      // Pending until callback (or sandbox auto-pay after a short delay) —
      // same wait/poll flow for B2C and B2B.
      if (charge.status !== "paid") {
        scheduleSandboxAutoPaid(payment._id);
        const instructions =
          charge.gateway === "razorpay"
            ? charge.meta?.customerMessage ||
              "Complete payment in the Razorpay window."
            : charge.meta?.customerMessage ||
              "Check your phone and enter your M-Pesa PIN to complete payment.";
        return res.status(200).json({
          error: null,
          payment: serializePayment(payment),
          pending: true,
          instructions,
        });
      }
    }

    job.payment = payment._id;
    job.amount = payment.amount;
    job.status = "processing";
    await job.save();
    startProcessing(job._id.toString());

    return res.json({
      payment: serializePayment(payment),
      job: job.toJSONSafe(),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    if (err.publicMessage) {
      return res.status(err.status || 400).json({ error: err.publicMessage });
    }
    return next(err);
  }
}

export async function getPayment(req, res, next) {
  try {
    const id = objectIdField.parse(req.params.id);
    const payment = await Payment.findOne({ _id: id, user: req.user.sub });
    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    // Optional Daraja query if STK callback is delayed.
    // Throttle hard — polling every few seconds hits Spike Arrest (HTTP 429).
    if (
      payment.status === "pending" &&
      payment.gateway === "mpesa" &&
      payment.providerCheckoutId &&
      isMpesaLive()
    ) {
      try {
        const ageMs = Date.now() - new Date(payment.createdAt).getTime();
        const lastQueryAt = payment.meta?.lastStkQueryAt
          ? new Date(payment.meta.lastStkQueryAt).getTime()
          : 0;
        const sinceQuery = Date.now() - lastQueryAt;
        if (ageMs > 20_000 && sinceQuery > 20_000) {
          payment.meta = {
            ...(payment.meta || {}),
            lastStkQueryAt: new Date().toISOString(),
          };
          await payment.save();

          const q = await stkQuery(payment.providerCheckoutId);
          const verified = mapStkResultCode(q?.ResultCode, q?.ResultDesc || "");
          if (verified) {
            await applyVerifiedPayment(payment, verified, {
              failureReason: q.ResultDesc,
              meta: {
                queryResultCode: q.ResultCode,
                queryResultDesc: q.ResultDesc,
              },
            });
          }
        }
      } catch (err) {
        console.warn("[mpesa] stkQuery failed:", err?.message || err);
      }
    }

    const fresh = await Payment.findById(payment._id);
    return res.json({ payment: serializePayment(fresh || payment) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}

export async function cancelPayment(req, res, next) {
  try {
    const id = objectIdField.parse(req.params.id);
    const payment = await Payment.findOne({ _id: id, user: req.user.sub });
    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }
    if (payment.status === "paid") {
      return res.status(409).json({ error: "Payment is already paid" });
    }
    if (payment.status === "pending") {
      payment.status = "cancelled";
      payment.failureReason = "customer_cancelled";
      await payment.save();
    }
    return res.json({ payment: serializePayment(payment) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}

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
