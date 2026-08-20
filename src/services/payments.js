// Payment provider interface.
// Stub marks charges paid immediately (demo / until a live gateway is wired).

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

export function resolveGateway(requested) {
  const req = requested || null;
  if (req === "referral") return "referral";
  if (req === "intasend" || req === "mpesa") {
    const err = new Error("That payment method is no longer available");
    err.status = 400;
    err.publicMessage =
      "External card/M-Pesa checkout is disabled. Use demo payment for now.";
    throw err;
  }
  return "stub";
}

export function getPaymentProvider(gateway = "stub") {
  return new StubProvider();
}

export function publicPaymentMethods() {
  return {
    defaultGateway: "stub",
    methods: [{ id: "stub", label: "Demo (instant, no charge)", available: true }],
    paymentNotice:
      "Demo payment is active. Live card/M-Pesa checkout will be added with a new provider.",
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
