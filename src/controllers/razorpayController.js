import { z } from "zod";
import { Payment } from "../models/Payment.js";
import { applyVerifiedPayment } from "../services/mpesa/fulfill.js";
import {
  fetchPayment,
  verifyPaymentSignature,
  verifyWebhookSignature,
  toPaise,
} from "../services/razorpay/client.js";
import { objectIdField } from "../utils/validators.js";
import { serializePayment } from "./paymentsController.js";

const verifySchema = z.object({
  paymentId: objectIdField,
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

/** Client Checkout success → verify HMAC and fulfill. */
export async function razorpayVerify(req, res, next) {
  try {
    const data = verifySchema.parse(req.body);
    const payment = await Payment.findOne({
      _id: data.paymentId,
      user: req.user.sub,
      gateway: "razorpay",
    });
    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    const orderId =
      payment.providerCheckoutId || payment.meta?.razorpayOrderId;
    if (orderId && orderId !== data.razorpay_order_id) {
      return res.status(400).json({ error: "Order mismatch" });
    }

    const ok = verifyPaymentSignature({
      orderId: data.razorpay_order_id,
      paymentId: data.razorpay_payment_id,
      signature: data.razorpay_signature,
    });
    if (!ok) {
      return res.status(400).json({ error: "Invalid payment signature" });
    }

    let rpPayment;
    try {
      rpPayment = await fetchPayment(data.razorpay_payment_id);
    } catch (fetchErr) {
      console.warn("[razorpay] verify fetch failed:", fetchErr?.message || fetchErr);
      return res.status(502).json({ error: "Could not confirm payment with Razorpay" });
    }
    if (rpPayment.status !== "captured") {
      return res.status(400).json({ error: "Payment not captured" });
    }
    const expectedPaise = toPaise(payment.amount);
    if (Number(rpPayment.amount) !== expectedPaise) {
      return res.status(400).json({ error: "Payment amount mismatch" });
    }

    await applyVerifiedPayment(payment, "paid", {
      mpesaReceiptNumber: data.razorpay_payment_id,
      meta: {
        razorpayPaymentId: data.razorpay_payment_id,
        razorpayOrderId: data.razorpay_order_id,
        verifiedVia: "checkout",
      },
    });

    const fresh = await Payment.findById(payment._id);
    return res.json({
      payment: serializePayment(fresh || payment),
      pending: false,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}

/**
 * Razorpay webhooks — public. Prefer raw body for signature; fall back to JSON stringify.
 * Configure event: payment.captured (and optionally payment.failed).
 */
export async function razorpayWebhook(req, res) {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const raw =
      typeof req.body === "string" || Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : JSON.stringify(req.body || {});

    if (!signature || !verifyWebhookSignature(raw, signature)) {
      console.warn("[razorpay] webhook signature rejected");
      return res.status(400).json({ error: "Invalid signature" });
    }

    const event =
      typeof req.body === "object" && !Buffer.isBuffer(req.body)
        ? req.body
        : JSON.parse(raw);

    const eventName = event?.event;
    const entity = event?.payload?.payment?.entity;
    if (!entity?.order_id) {
      return res.json({ ok: true, ignored: true });
    }

    const payment = await Payment.findOne({
      gateway: "razorpay",
      providerCheckoutId: entity.order_id,
    });
    if (!payment) {
      console.warn("[razorpay] webhook payment not found order=", entity.order_id);
      return res.json({ ok: true, matched: false });
    }

    if (eventName === "payment.captured" || entity.status === "captured") {
      await applyVerifiedPayment(payment, "paid", {
        mpesaReceiptNumber: entity.id,
        meta: {
          razorpayPaymentId: entity.id,
          razorpayOrderId: entity.order_id,
          verifiedVia: "webhook",
          method: entity.method,
        },
      });
      console.info(
        `[razorpay] webhook paid payment=${payment._id} rzp=${entity.id}`
      );
    } else if (
      eventName === "payment.failed" ||
      entity.status === "failed"
    ) {
      await applyVerifiedPayment(payment, "failed", {
        failureReason: entity.error_description || "Payment failed",
        meta: {
          razorpayPaymentId: entity.id,
          verifiedVia: "webhook",
        },
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("[razorpay] webhook error:", err?.message || err);
    // Still ACK to avoid endless retries for bad payloads we can't process.
    return res.status(200).json({ ok: false });
  }
}

/** Optional: re-check a payment with Razorpay API (admin/debug). */
export async function razorpayFetchStatus(req, res, next) {
  try {
    const id = objectIdField.parse(req.params.id);
    const payment = await Payment.findOne({
      _id: id,
      user: req.user.sub,
      gateway: "razorpay",
    });
    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }
    const rzpId = payment.meta?.razorpayPaymentId;
    if (!rzpId) {
      return res.json({ payment: serializePayment(payment), remote: null });
    }
    const remote = await fetchPayment(rzpId);
    return res.json({ payment: serializePayment(payment), remote });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}
