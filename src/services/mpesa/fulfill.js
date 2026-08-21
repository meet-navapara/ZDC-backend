/**
 * Apply a verified M-Pesa (or future gateway) result onto a Payment and fulfill.
 */
import { Payment } from "../../models/Payment.js";
import { TryonJob } from "../../models/TryonJob.js";
import { nextPaymentTransition } from "../payments.js";
import { addCredits } from "../credits.js";
import { startProcessing } from "../../controllers/tryonController.js";
import { capture } from "../analytics.js";

/**
 * @param {import("mongoose").Document} payment
 * @param {"paid"|"failed"|"cancelled"} verifiedStatus
 * @param {object} [extra]
 */
export async function applyVerifiedPayment(payment, verifiedStatus, extra = {}) {
  const transition = nextPaymentTransition(payment.status, verifiedStatus);

  if (transition.status !== payment.status) {
    payment.status = transition.status;
  }
  if (extra.failureReason && transition.status !== "paid") {
    payment.failureReason = String(extra.failureReason).slice(0, 500);
  }
  if (transition.status === "paid") {
    payment.failureReason = null;
  }
  if (extra.mpesaReceiptNumber) {
    payment.reference = extra.mpesaReceiptNumber;
  }
  if (extra.meta) {
    payment.meta = { ...(payment.meta || {}), ...extra.meta };
  }
  await payment.save();

  if (!transition.fulfill) {
    return { payment, fulfilled: false, alreadyPaid: transition.alreadyPaid };
  }

  if (payment.purpose === "b2c_tryon" && payment.job) {
    const job = await TryonJob.findById(payment.job);
    if (job && job.status === "awaiting_payment") {
      job.payment = payment._id;
      job.amount = payment.amount;
      job.status = "processing";
      await job.save();
      startProcessing(job._id.toString());
    }
  } else if (payment.purpose === "b2b_credits") {
    const credits = Number(payment.meta?.credits || 0);
    if (credits > 0) {
      const balance = await addCredits(payment.user, credits, {
        type: "purchase",
        reference: payment.reference,
        note: `Purchased ${payment.meta?.packLabel || "credits"} (${credits} credits)`,
        payment: payment._id,
      });
      capture(String(payment.user), "credits_purchased", {
        pack: payment.meta?.packId,
        credits,
        amount: payment.amount,
        currency: payment.currency,
        balance,
        gateway: "mpesa",
      });
    }
  }

  return { payment, fulfilled: true, alreadyPaid: false };
}

/** Find pending payment by Daraja CheckoutRequestID and apply callback. */
export async function applyStkCallbackResult(parsed) {
  if (!parsed?.ok || !parsed.checkoutRequestId) {
    return { handled: false, reason: "invalid_callback" };
  }

  const payment = await Payment.findOne({
    gateway: "mpesa",
    providerCheckoutId: parsed.checkoutRequestId,
  });
  if (!payment) {
    return { handled: false, reason: "payment_not_found" };
  }

  // Light amount check when Safaricom sends Amount
  if (
    parsed.verifiedStatus === "paid" &&
    parsed.amount != null &&
    Number(payment.amount) !== Number(parsed.amount)
  ) {
    console.warn(
      `[mpesa] amount mismatch payment=${payment._id} expected=${payment.amount} got=${parsed.amount}`
    );
  }

  const result = await applyVerifiedPayment(payment, parsed.verifiedStatus, {
    failureReason: parsed.resultDesc,
    mpesaReceiptNumber: parsed.mpesaReceiptNumber,
    meta: {
      resultCode: parsed.resultCode,
      resultDesc: parsed.resultDesc,
      mpesaReceiptNumber: parsed.mpesaReceiptNumber,
      callbackPhone: parsed.phoneNumber,
      transactionDate: parsed.transactionDate,
    },
  });

  return { handled: true, ...result };
}
