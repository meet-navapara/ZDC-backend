import { env } from "../../config/env.js";
import { Payment } from "../../models/Payment.js";
import { applyVerifiedPayment } from "./fulfill.js";

/**
 * After pending charge created, mark paid locally (sandbox + AUTO_PAID only).
 */
export function scheduleSandboxAutoPaid(paymentId, delayMs = 2500) {
  if (env.mpesa.env !== "sandbox" || !env.mpesa.sandboxAutoPaid) {
    console.info(
      "[mpesa] sandbox auto-paid skipped (env=%s auto=%s)",
      env.mpesa.env,
      env.mpesa.sandboxAutoPaid
    );
    return;
  }
  if (!paymentId) return;

  const id = String(paymentId);
  console.info(`[mpesa] sandbox auto-paid scheduled in ${delayMs}ms for ${id}`);

  setTimeout(async () => {
    try {
      const payment = await Payment.findById(id);
      if (!payment || payment.gateway !== "mpesa") return;
      if (payment.status === "paid") {
        console.info(`[mpesa] sandbox auto-paid already paid ${id}`);
        return;
      }
      // pending or any failed/cancelled — force paid for local verify
      await applyVerifiedPayment(payment, "paid", {
        mpesaReceiptNumber: `SANDBOX${Date.now().toString(36).toUpperCase()}`,
        failureReason: null,
        meta: {
          sandboxAutoPaid: true,
          note: "Local MPESA_SANDBOX_AUTO_PAID simulation",
          previousStatus: payment.status,
        },
      });
      const fresh = await Payment.findById(id);
      if (fresh) {
        fresh.failureReason = null;
        fresh.status = "paid";
        await fresh.save();
      }
      console.info(`[mpesa] sandbox auto-paid OK payment=${id}`);
    } catch (err) {
      console.error("[mpesa] sandbox auto-paid failed:", err?.message || err);
    }
  }, delayMs);
}
