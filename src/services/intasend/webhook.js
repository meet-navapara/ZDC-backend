import mongoose from "mongoose";
import { Payment } from "../../models/Payment.js";
import { amountsMatch } from "./status.js";
import { verifyPayment } from "./checkout.js";
import { verifyWebhookChallenge } from "./webhookAuth.js";
import { applyVerifiedPayment } from "../paymentFulfillment.js";

/**
 * Persist invoice_id from IntaSend webhook when checkout creation did not return one.
 * Returns true when providerInvoiceId was set on the in-memory payment document.
 */
export function persistInvoiceIdIfMissing(payment, invoiceId) {
  const id = String(invoiceId ?? "").trim();
  if (!id) return false;
  if (payment.providerInvoiceId) return false;
  payment.providerInvoiceId = id;
  return true;
}

export function resolveIntasendStatusIds(payment, extraIds = {}) {
  const checkoutId = extraIds.checkoutId || payment.providerCheckoutId;
  const invoiceId =
    extraIds.invoiceId ||
    payment.providerInvoiceId ||
    // Only fall back to `reference` when we don't have checkout_id.
    (!checkoutId ? payment.reference : undefined);
  return { invoiceId, checkoutId };
}

export async function syncIntasendPayment(payment, extraIds = {}) {
  // IntaSend checkout can be created before it has an invoice_id.
  // When invoice_id is missing, we must poll using checkout_id only,
  // otherwise status can stay stuck at PENDING/PROCESSING forever.
  const { invoiceId, checkoutId } = resolveIntasendStatusIds(payment, extraIds);
  if (!invoiceId && !checkoutId) {
    const err = new Error("Payment has no IntaSend invoice id");
    err.status = 409;
    err.publicMessage = "This payment is not an IntaSend checkout.";
    throw err;
  }

  const paymentAgeMs = payment.createdAt
    ? Date.now() - new Date(payment.createdAt).getTime()
    : 0;
  const verified = await verifyPayment({ invoiceId, checkoutId, paymentAgeMs });

  if (verified.status === "paid") {
    if (
      verified.amount != null &&
      verified.currency &&
      !amountsMatch(payment.amount, payment.currency, verified.amount, verified.currency)
    ) {
      console.error("[intasend] amount_mismatch", {
        paymentId: String(payment._id),
        expectedAmount: payment.amount,
        expectedCurrency: payment.currency,
        actualAmount: verified.amount,
        actualCurrency: verified.currency,
      });
      const err = new Error("IntaSend amount/currency does not match the order");
      err.status = 409;
      err.publicMessage = "Payment amount did not match the order. Not marked paid.";
      throw err;
    }
  }

  const updated = await applyVerifiedPayment(payment, verified);
  console.log("[intasend] status_sync", {
    paymentId: String(payment._id),
    from: payment.status,
    to: updated.status,
    providerState: verified.providerState,
  });
  return updated;
}

export async function handleIntasendWebhook(req) {
  const body = req.body || {};
  const auth = verifyWebhookChallenge(body.challenge);
  if (!auth.ok) {
    console.log("[intasend] webhook_rejected", { reason: auth.reason });
    const err = new Error("Invalid IntaSend webhook");
    err.status = 401;
    err.publicMessage = "Invalid webhook.";
    throw err;
  }

  console.log("[intasend] webhook_received", {
    invoiceId: body.invoice_id || null,
    apiRef: body.api_ref || null,
    state: body.state || null,
  });

  let payment = null;
  if (body.invoice_id) {
    payment = await Payment.findOne({
      gateway: "intasend",
      providerInvoiceId: body.invoice_id,
    });
  }
  if (!payment && body.api_ref && mongoose.isValidObjectId(body.api_ref)) {
    payment = await Payment.findOne({ _id: body.api_ref, gateway: "intasend" });
  }
  if (!payment) {
    console.log("[intasend] webhook_unknown_payment", {
      invoiceId: body.invoice_id || null,
      apiRef: body.api_ref || null,
    });
    return { ok: true, ignored: true };
  }

  if (persistInvoiceIdIfMissing(payment, body.invoice_id)) {
    await payment.save();
  }

  const updated = await syncIntasendPayment(payment, {
    invoiceId: body.invoice_id,
  });
  return { ok: true, paymentId: String(updated._id), status: updated.status };
}
