// Payment provider interface.
// Stub = instant demo pay. M-Pesa = Daraja STK when MPESA_ENABLED + credentials.
// Razorpay = Phase 3.
import { env } from "../config/env.js";
import { isMpesaLive } from "./mpesa/daraja.js";
import { MpesaProvider } from "./mpesa/provider.js";

class StubProvider {
  constructor() {
    this.name = "stub";
  }

  async createCharge({ amount, currency, reference }) {
    return {
      status: "paid",
      gateway: this.name,
      reference: reference || `stub_${Date.now()}`,
      amount,
      currency,
    };
  }
}

/**
 * Infer billing country + currency from a User document (B2B business profile,
 * or future B2C fields).
 *
 * @param {object|null|undefined} user
 * @returns {{ country: string|null, currency: string, gateway: "mpesa"|"razorpay"|"stub", reason: string }}
 */
export function resolveMarketGateway(user) {
  const countryRaw =
    user?.business?.address?.country || user?.country || null;
  const country = countryRaw ? String(countryRaw).trim() : null;

  let currency = user?.business?.currency || user?.currency || null;
  currency = currency ? String(currency).trim().toUpperCase() : null;

  const countryLower = (country || "").toLowerCase();
  const isKenya = countryLower === "kenya" || countryLower === "ke";
  const isIndia = countryLower === "india" || countryLower === "in";

  if (!currency) {
    if (isKenya) currency = "KES";
    else if (isIndia) currency = "INR";
    else currency = "KES";
  }

  if (currency === "KES" && (isKenya || !country)) {
    return {
      country: country || "Kenya",
      currency: "KES",
      gateway: "mpesa",
      reason: "Kenya / KES → M-Pesa",
    };
  }

  if (currency === "INR" && (isIndia || !country)) {
    return {
      country: country || "India",
      currency: "INR",
      gateway: "razorpay",
      reason: "India / INR → Razorpay (Phase 3)",
    };
  }

  return {
    country,
    currency,
    gateway: "stub",
    reason: "Market not enabled for live checkout; demo stub",
  };
}

/**
 * Pick charge gateway. KES charges (B2B packs + B2C plans) auto-route to M-Pesa when live.
 * @param {string|null|undefined} requested
 * @param {object|null|undefined} user
 * @param {{ currency?: string|null }} [opts]
 */
export function resolveGateway(requested, user = null, opts = {}) {
  const req = requested || null;
  if (req === "referral") return "referral";

  const market = user ? resolveMarketGateway(user) : null;
  const mpesaLive = isMpesaLive();
  const chargeCurrency = String(
    opts.currency || market?.currency || ""
  ).toUpperCase();

  // Auto: Kenya market OR any KES invoice → M-Pesa when configured
  // (B2B credit packs are always KES even if the business profile is India/other).
  if (
    mpesaLive &&
    (market?.gateway === "mpesa" || chargeCurrency === "KES")
  ) {
    return "mpesa";
  }

  if (req === "mpesa") {
    if (mpesaLive) return "mpesa";
    const err = new Error("M-Pesa is not enabled");
    err.status = 400;
    err.publicMessage =
      "M-Pesa is not enabled yet. Set MPESA_ENABLED and Daraja credentials, or use demo payment.";
    throw err;
  }

  if (req === "intasend" || req === "razorpay") {
    const err = new Error("That payment method is not available yet");
    err.status = 400;
    err.publicMessage =
      req === "razorpay"
        ? "Razorpay (India) ships in Phase 3. Use demo payment for now."
        : "That payment method is no longer available.";
    throw err;
  }

  return "stub";
}

export function getPaymentProvider(gateway = "stub") {
  if (gateway === "mpesa") return new MpesaProvider();
  return new StubProvider();
}

export function publicPaymentMethods(user) {
  const market = user ? resolveMarketGateway(user) : null;
  const mpesaLive = isMpesaLive();
  const methods = [];

  // Phase 2: all catalog prices are KES — expose M-Pesa whenever Daraja is live,
  // even if the business profile country is not Kenya (common B2B gap).
  if (mpesaLive) {
    methods.push({
      id: "mpesa",
      label: "M-Pesa (STK Push)",
      available: true,
    });
  }

  // Demo stub always available for local/dev and when live gateway is off.
  if (!mpesaLive || env.nodeEnv !== "production" || market?.gateway === "stub") {
    methods.push({
      id: "stub",
      label: "Demo (instant, no charge)",
      available: true,
    });
  }

  if (!methods.length) {
    methods.push({
      id: "stub",
      label: "Demo (instant, no charge)",
      available: true,
    });
  }

  let defaultGateway = "stub";
  if (mpesaLive) defaultGateway = "mpesa";

  let paymentNotice = null;
  if (defaultGateway === "mpesa" && env.mpesa.sandboxAutoPaid) {
    paymentNotice =
      "Sandbox auto-pay is ON — payment confirms in a few seconds without PIN (local testing only).";
  } else if (defaultGateway === "mpesa") {
    paymentNotice =
      "Pay with M-Pesa: you will get an STK prompt on your phone to enter your PIN.";
  } else if (market?.gateway === "mpesa" && !mpesaLive) {
    paymentNotice =
      "Demo payment is active. M-Pesa is planned for this Kenya/KES account — enable MPESA_* on the server to go live.";
  } else if (market?.gateway === "razorpay") {
    paymentNotice =
      "Demo payment is active. Razorpay (India/INR) ships in Phase 3.";
  } else {
    paymentNotice =
      "Demo payment is active. Live M-Pesa (Kenya) and Razorpay (India) follow phased rollout.";
  }

  return {
    defaultGateway,
    plannedGateway: market?.gateway || null,
    market,
    mpesaEnabled: mpesaLive,
    sandboxAutoPaid: Boolean(env.mpesa.sandboxAutoPaid),
    methods,
    paymentNotice,
  };
}

/** Shared status transitions for paid / failed / cancelled (idempotent fulfill). */
export function nextPaymentTransition(currentStatus, verifiedStatus) {
  if (currentStatus === "paid" && verifiedStatus === "refunded") {
    return { status: "refunded", fulfill: false, alreadyPaid: true };
  }
  if (currentStatus === "paid") {
    return { status: "paid", fulfill: false, alreadyPaid: true };
  }
  if (verifiedStatus === "paid") {
    // Allow recovering a failed/cancelled sandbox payment into paid (auto-paid).
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
