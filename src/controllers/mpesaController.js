import { parseStkCallback } from "../services/mpesa/parseCallback.js";
import { applyStkCallbackResult } from "../services/mpesa/fulfill.js";

/** Public Daraja callback — no auth. Always ACK quickly. */
export async function mpesaStkCallback(req, res) {
  // Acknowledge first so Safaricom does not retry aggressively.
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

  try {
    const parsed = parseStkCallback(req.body);
    if (!parsed.ok) {
      console.warn("[mpesa] callback ignored:", parsed.error);
      return;
    }
    const result = await applyStkCallbackResult(parsed);
    if (!result.handled) {
      console.warn(
        "[mpesa] callback not matched:",
        parsed.checkoutRequestId,
        result.reason
      );
      return;
    }
    console.info(
      `[mpesa] callback payment=${result.payment?._id} status=${result.payment?.status} fulfilled=${result.fulfilled}`
    );
  } catch (err) {
    console.error("[mpesa] callback handler error:", err?.message || err);
  }
}
