import { z } from "zod";
import { TryonJob } from "../models/TryonJob.js";
import { Payment } from "../models/Payment.js";
import { User } from "../models/User.js";
import { env } from "../config/env.js";
import {
  getPaymentProvider,
  resolveGateway,
  publicPaymentMethods,
  CHECKOUT_REUSE_MS,
} from "../services/payments.js";
import { startProcessing } from "./tryonController.js";
import { consumeFreeTryon } from "../services/referral.js";
import { objectIdField } from "../utils/validators.js";
import { handleIntasendWebhook, syncIntasendPayment } from "../services/intasend/webhook.js";

const paySchema = z.object({
  jobId: objectIdField,
  gateway: z.enum(["stub", "mpesa", "intasend", "referral"]).optional(),
  useFreeTryon: z.coerce.boolean().optional(),
});

export function serializePayment(payment) {
  return {
    id: payment._id.toString(),
    status: payment.status,
    reference: payment.reference,
    gateway: payment.gateway,
    amount: payment.amount,
    currency: payment.currency,
    purpose: payment.purpose,
    checkoutUrl: payment.checkoutUrl || null,
    job: payment.job ? String(payment.job) : null,
    failureReason: payment.failureReason || null,
    createdAt: payment.createdAt,
  };
}

function returnUrl(paymentId) {
  const frontend = env.frontendUrl.replace(/\/$/, "");
  return `${frontend}/payments/intasend/return?p=${paymentId}`;
}

export async function customerForUser(userId) {
  const user = await User.findById(userId).select(
    "email phone firstName lastName business"
  );
  if (!user) {
    return { email: null, phone: null, firstName: null, lastName: null, country: env.intasend.country };
  }
  return {
    email: user.email,
    phone: user.phone || user.business?.whatsapp || null,
    firstName: user.firstName || user.business?.name || null,
    lastName: user.lastName || null,
    // Country is derived from checkout currency (KES → KE). Shopper country
    // on IntaSend's card form (e.g. India) can leave 3DS on Processing.
    country: env.intasend.country,
  };
}

export async function startIntasendCheckout(payment, customer, comment) {
  const host = env.frontendUrl.replace(/\/$/, "");
  const provider = getPaymentProvider("intasend");
  const charge = await provider.createCharge({
    apiRef: payment._id.toString(),
    amount: payment.amount,
    currency: payment.currency,
    email: customer.email,
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: customer.phone,
    country: customer.country,
    comment,
    redirectUrl: returnUrl(payment._id.toString()),
    host,
  });
  payment.gateway = "intasend";
  payment.status = "pending";
  payment.reference = charge.reference;
  if (charge.providerInvoiceId) {
    payment.providerInvoiceId = charge.providerInvoiceId;
  } else {
    payment.providerInvoiceId = undefined;
  }
  payment.providerCheckoutId = charge.providerCheckoutId;
  payment.checkoutUrl = charge.checkoutUrl;
  await payment.save();
  return payment;
}

export function listPaymentMethods(req, res) {
  return res.json(publicPaymentMethods());
}

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
      const gateway = resolveGateway(data.gateway);

      if (gateway === "intasend") {
        const reuseAfter = new Date(Date.now() - CHECKOUT_REUSE_MS);
        const existing = await Payment.findOne({
          job: job._id,
          gateway: "intasend",
          status: "pending",
          createdAt: { $gte: reuseAfter },
          checkoutUrl: { $ne: null },
        }).sort({ createdAt: -1 });
        if (existing) {
          return res.json({
            payment: serializePayment(existing),
            checkoutUrl: existing.checkoutUrl,
            job: job.toJSONSafe(),
          });
        }

        payment = await Payment.create({
          user: req.user.sub,
          job: job._id,
          gateway: "intasend",
          amount: job.amount,
          currency: job.currency,
          purpose: "b2c_tryon",
          status: "pending",
        });
        try {
          payment = await startIntasendCheckout(
            payment,
            await customerForUser(req.user.sub),
            `zimji try-on ${job.pack || "pack"}`
          );
        } catch (err) {
          payment.status = "failed";
          payment.failureReason = err.publicMessage || err.message;
          await payment.save().catch(() => {});
          throw err;
        }

        return res.json({
          payment: serializePayment(payment),
          checkoutUrl: payment.checkoutUrl,
          job: job.toJSONSafe(),
        });
      }

      const provider = getPaymentProvider(gateway);
      const charge = await provider.createCharge({
        amount: job.amount,
        currency: job.currency,
        reference: `job_${job._id}`,
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
      });

      if (charge.status !== "paid") {
        return res.status(402).json({
          error: "Payment not completed",
          payment: serializePayment(payment),
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
    if (payment.gateway === "intasend" && payment.status === "pending") {
      try {
        const invoiceId = req.query.invoice_id || undefined;
        const checkoutId = req.query.checkout_id || undefined;
        const synced = await syncIntasendPayment(payment, { invoiceId, checkoutId });
        return res.json({ payment: serializePayment(synced) });
      } catch (err) {
        console.error("[intasend] status_poll_failed", {
          paymentId: String(payment._id),
          error: err.publicMessage || err.message,
        });
        return res.json({ payment: serializePayment(payment) });
      }
    }
    return res.json({ payment: serializePayment(payment) });
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
    if (payment.gateway === "intasend" && (payment.providerInvoiceId || payment.providerCheckoutId)) {
      try {
        const synced = await syncIntasendPayment(payment);
        if (synced.status === "paid") {
          return res.status(409).json({
            error: "Payment completed at IntaSend",
            payment: serializePayment(synced),
          });
        }
        if (synced.status === "pending") {
          synced.status = "cancelled";
          synced.failureReason = "customer_cancelled";
          await synced.save();
        }
        return res.json({ payment: serializePayment(synced) });
      } catch {
        // Fall through to local cancel if IntaSend has no invoice yet.
      }
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

export async function intasendWebhook(req, res, next) {
  try {
    const result = await handleIntasendWebhook(req);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status === 401) {
      return res.status(401).json({ error: err.publicMessage || "Invalid webhook" });
    }
    console.error("[intasend] webhook_error", err.publicMessage || err.message);
    if (err.status && err.status < 500) {
      return res.status(200).json({ ok: true, ignored: true });
    }
    return res.status(500).json({ error: "Webhook processing failed" });
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
