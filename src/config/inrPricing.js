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
    B2C_INR_AMOUNTS[id] ?? CREDIT_INR_AMOUNTS[id] ?? pack.amount;
  return { ...pack, amount: inr, currency: "INR" };
}
