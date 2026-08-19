import { Payment } from "../models/Payment.js";
import { TryonJob } from "../models/TryonJob.js";
import { CreditLedger } from "../models/CreditLedger.js";
import { addCredits } from "./credits.js";
import { startProcessing } from "../controllers/tryonController.js";
import { nextPaymentTransition } from "./intasend/status.js";
import { capture } from "./analytics.js";

function logFulfill(event, extra) {
  console.log("[intasend]", event, extra);
}

async function fulfillPaid(payment) {
  if (payment.purpose === "b2c_tryon" && payment.job) {
    const job = await TryonJob.findOneAndUpdate(
      { _id: payment.job, status: "awaiting_payment" },
      {
        $set: {
          payment: payment._id,
          amount: payment.amount,
          status: "processing",
        },
      },
      { new: true }
    );
    if (job) {
      startProcessing(job._id.toString());
      logFulfill("job_processing", {
        paymentId: String(payment._id),
        jobId: String(job._id),
      });
    }
    return;
  }

  if (payment.purpose === "b2b_credits") {
    const already = await CreditLedger.findOne({
      payment: payment._id,
      type: "purchase",
    });
    if (already) return;
    const credits = Number(payment.meta?.credits);
    if (!Number.isFinite(credits) || credits <= 0) {
      logFulfill("credits_missing_meta", { paymentId: String(payment._id) });
      return;
    }
    try {
      const balance = await addCredits(payment.user, credits, {
        type: "purchase",
        reference: payment.reference,
        note: `Purchased ${payment.meta?.packLabel || "credit pack"} (${credits} credits)`,
        payment: payment._id,
      });
      capture(payment.user, "credits_purchased", {
        pack: payment.meta?.packId,
        credits,
        amount: payment.amount,
        currency: payment.currency,
        balance,
        gateway: "intasend",
      });
      logFulfill("credits_added", {
        paymentId: String(payment._id),
        credits,
        balance,
      });
    } catch (err) {
      if (err?.code === 11000) return;
      throw err;
    }
  }
}

export async function applyVerifiedPayment(payment, verified) {
  const transition = nextPaymentTransition(payment.status, verified.status);
  const set = {
    "meta.providerState": verified.providerState || null,
    "meta.lastVerifiedAt": new Date(),
    "meta.method": verified.method || null,
  };
  if (verified.providerInvoiceId) set.providerInvoiceId = verified.providerInvoiceId;
  if (verified.providerCheckoutId) set.providerCheckoutId = verified.providerCheckoutId;
  if (verified.failedReason) set.failureReason = verified.failedReason;

  if (transition.status !== payment.status) {
    set.status = transition.status;
    if (transition.status === "paid") set.failureReason = null;
    if (transition.status === "failed" || transition.status === "cancelled") {
      set.failureReason = verified.failedReason || verified.providerState || transition.status;
    }
  }

  const updated = await Payment.findByIdAndUpdate(payment._id, { $set: set }, { new: true });
  if (updated.status === "paid") {
    await fulfillPaid(updated);
  }
  return updated;
}
