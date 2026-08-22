/**
 * INR list prices for Phase 3 (Razorpay).
 * KES amounts stay in Pricing DB / config defaults; these override when market is India.
 */
export const B2C_INR_AMOUNTS = {
  single: 49,
  trio: 99,
};

export const CREDIT_INR_AMOUNTS = {
  starter: 499,
  growth: 1499,
  scale: 4999,
};

/** Apply INR amount when currency is INR; otherwise leave pack as-is. */
export function localizePackAmount(pack, currency) {
  if (!pack) return pack;
  const cur = String(currency || pack.currency || "KES").toUpperCase();
  if (cur !== "INR") {
    return { ...pack, currency: pack.currency || "KES" };
  }
  const id = pack.id;
  const inr =
    pack.amountInr ??
    B2C_INR_AMOUNTS[id] ??
    CREDIT_INR_AMOUNTS[id] ??
    pack.amount;
  return { ...pack, amount: inr, currency: "INR" };
}

/** Dual-currency display for B2C gateway choice (KES + INR). */
export function withDualPrices(pack) {
  if (!pack) return pack;
  const kes = localizePackAmount(pack, "KES");
  const inr = localizePackAmount(pack, "INR");
  return {
    ...kes,
    amountKes: kes.amount,
    amountInr: inr.amount,
    prices: {
      KES: { amount: kes.amount, currency: "KES" },
      INR: { amount: inr.amount, currency: "INR" },
    },
  };
}

/** Amount + currency for a chosen gateway. */
export function packAmountForGateway(pack, gateway) {
  if (!pack) return { amount: 0, currency: "KES" };
  if (gateway === "razorpay") {
    return localizePackAmount(pack, "INR");
  }
  if (gateway === "mpesa") {
    return localizePackAmount(pack, "KES");
  }
  return {
    amount: pack.amount,
    currency: pack.currency || "KES",
  };
}
