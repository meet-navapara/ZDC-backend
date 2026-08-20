export function mapIntasendState(state) {
  const s = String(state || "").toUpperCase();
  if (s === "COMPLETE") return "paid";
  if (s === "CANCELED" || s === "CANCELLED") return "cancelled";
  if (s === "FAILED") return "failed";
  return "pending";
}

export function amountsMatch(expectedAmount, expectedCurrency, actualAmount, actualCurrency) {
  const expC = String(expectedCurrency || "").toUpperCase();
  const actC = String(actualCurrency || "").toUpperCase();
  if (!expC || !actC || expC !== actC) return false;
  const exp = Math.round(Number(expectedAmount) * 100);
  const act = Math.round(Number(actualAmount) * 100);
  return Number.isFinite(exp) && Number.isFinite(act) && exp === act;
}

export function nextPaymentTransition(currentStatus, verifiedStatus) {
  if (currentStatus === "paid" && verifiedStatus === "refunded") {
    return { status: "refunded", fulfill: false, alreadyPaid: true };
  }
  if (currentStatus === "paid") {
    return { status: "paid", fulfill: false, alreadyPaid: true };
  }
  if (verifiedStatus === "paid") {
    return { status: "paid", fulfill: true, alreadyPaid: false };
  }
  if (verifiedStatus === "cancelled" && currentStatus === "pending") {
    return { status: "cancelled", fulfill: false, alreadyPaid: false };
  }
  if (verifiedStatus === "failed" && currentStatus === "pending") {
    return { status: "failed", fulfill: false, alreadyPaid: false };
  }
  return { status: currentStatus, fulfill: false, alreadyPaid: false };
}

/** IntaSend field pattern: letters, numbers, space, - _ : */
export function sanitizeIntasendText(value, max = 45) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9-_: ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function sanitizePhone(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  return digits.slice(0, 30) || null;
}

export function invoiceFromStatus(data) {
  // IntaSend returns HTTP 200 with {"detail":"Invoice with specified id does not exist"}
  // when queried by checkout_id before the invoice is created, or for unknown IDs.
  // Treat this as a "no data yet" response rather than a real failure state.
  const isNoData =
    !data ||
    (data.detail && !data.invoice && !data.state && !data.invoice_id) ||
    typeof data.detail === "string";

  if (isNoData) {
    return {
      invoiceId: null,
      state: null,
      amount: null,
      currency: null,
      apiRef: null,
      provider: null,
      providerRef: null,
      failedReason: null,
      failedCode: null,
      retryCount: null,
      checkoutId: null,
      noData: true,
    };
  }

  const invoice = data?.invoice || data || {};
  return {
    invoiceId: invoice.invoice_id || invoice.id || data?.invoice_id || null,
    state: invoice.state || data?.state || null,
    amount: invoice.value ?? invoice.net_amount ?? data?.value ?? null,
    currency: invoice.currency || data?.currency || null,
    apiRef: invoice.api_ref || data?.api_ref || null,
    provider: invoice.provider || data?.provider || null,
    providerRef: invoice.provider_ref || data?.provider_ref || null,
    failedReason: invoice.failed_reason || data?.failed_reason || null,
    failedCode: invoice.failed_code || data?.failed_code || null,
    retryCount: invoice.retry_count ?? data?.retry_count ?? null,
    checkoutId: data?.meta?.id || null,
    noData: false,
  };
}

/** Minimum age before a null-provider_ref card PENDING/PROCESSING is treated as dead. */
export const DEAD_CARD_MIN_AGE_MS = 120_000;

/**
 * IntaSend card 3DS can stall — invoice stays PENDING or PROCESSING with
 * provider_ref: null. That is also the *normal* state while 3DS is in progress,
 * so we only treat it as dead after the payment has been open long enough.
 */
export function isDeadCardPending(parsed, { paymentAgeMs = 0, minAgeMs = DEAD_CARD_MIN_AGE_MS } = {}) {
  const state = String(parsed.state || "").toUpperCase();
  if (state !== "PENDING" && state !== "PROCESSING") return false;
  const provider = String(parsed.provider || "").toUpperCase();
  if (!provider.includes("CARD")) return false;
  // provider_ref is set once the card processor responds; null means 3DS not done
  if (parsed.providerRef !== null && parsed.providerRef !== undefined) return false;
  if (Number(paymentAgeMs) < Number(minAgeMs)) return false;
  return true;
}

/**
 * M-Pesa STK push can stay PROCESSING for a long time if the user never
 * enters their PIN, or if the sandbox phone is not reachable.
 * After retryCount exceeds the threshold, or once it's been PROCESSING
 * with no activity, surface it as failed so the UI stops looping.
 */
export function isDeadMpesaProcessing(parsed) {
  const state = String(parsed.state || "").toUpperCase();
  if (state !== "PROCESSING") return false;
  const provider = String(parsed.provider || "").toUpperCase();
  if (!provider.includes("PESA") && !provider.includes("MPESA")) return false;
  // IntaSend retries STK up to 2 times; if retry_count >= 2 and still PROCESSING, it's stuck
  if (parsed.retryCount != null && Number(parsed.retryCount) >= 2) return true;
  return false;
}
