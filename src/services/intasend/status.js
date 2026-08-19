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
  const invoice = data?.invoice || data || {};
  return {
    invoiceId: invoice.invoice_id || invoice.id || data?.invoice_id || null,
    state: invoice.state || data?.state || null,
    amount: invoice.value ?? invoice.net_amount ?? data?.value ?? null,
    currency: invoice.currency || data?.currency || null,
    apiRef: invoice.api_ref || data?.api_ref || null,
    provider: invoice.provider || data?.provider || null,
    failedReason: invoice.failed_reason || data?.failed_reason || null,
    checkoutId: data?.meta?.id || null,
  };
}
