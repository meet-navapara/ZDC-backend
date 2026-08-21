/**
 * Parse Daraja STK callback body into a normalized result.
 */
import { mapStkResultCode } from "./daraja.js";

export function parseStkCallback(body) {
  const cb = body?.Body?.stkCallback;
  if (!cb) {
    return { ok: false, error: "missing_stkCallback" };
  }

  const resultCode = cb.ResultCode;
  const resultDesc = cb.ResultDesc || null;
  const items = {};
  for (const item of cb.CallbackMetadata?.Item || []) {
    if (item?.Name) items[item.Name] = item.Value;
  }

  const verifiedStatus = mapStkResultCode(resultCode, resultDesc || "");
  // If Daraja sends a non-final callback, ignore it (stay pending).
  if (!verifiedStatus) {
    return {
      ok: false,
      error: "in_progress",
      checkoutRequestId: cb.CheckoutRequestID || null,
      resultCode,
      resultDesc,
    };
  }

  return {
    ok: true,
    checkoutRequestId: cb.CheckoutRequestID || null,
    merchantRequestId: cb.MerchantRequestID || null,
    resultCode: Number(resultCode),
    resultDesc,
    verifiedStatus,
    amount: items.Amount != null ? Number(items.Amount) : null,
    mpesaReceiptNumber: items.MpesaReceiptNumber
      ? String(items.MpesaReceiptNumber)
      : null,
    phoneNumber: items.PhoneNumber != null ? String(items.PhoneNumber) : null,
    transactionDate: items.TransactionDate != null
      ? String(items.TransactionDate)
      : null,
  };
}
