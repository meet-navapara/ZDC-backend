// Payment provider interface.
//
// Stub marks charges paid immediately (local demo).
// IntaSend Checkout creates a hosted payment link and returns pending + checkoutUrl.

import { env } from "../config/env.js";
import { isIntasendConfigured, createCheckoutSession } from "./intasend/checkout.js";

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

export const CHECKOUT_REUSE_MS = 25 * 60 * 1000;

export { isIntasendConfigured };

/** Keys present and IntaSend allowed for checkout (off by default in dev). */
export function isIntasendEnabled() {
  return isIntasendConfigured() && env.intasend.enabled;
}

export function resolveGateway(requested) {
  const req = requested || null;
  if (req === "referral") return "referral";

  const intasendOn = isIntasendEnabled();
  if (env.isProd && intasendOn) {
    if (req && req !== "intasend") {
      const err = new Error("This server only accepts IntaSend for paid orders.");
      err.status = 400;
      err.publicMessage = err.message;
      throw err;
    }
    return "intasend";
  }

  if (req === "intasend") {
    if (!isIntasendConfigured()) {
      const err = new Error("IntaSend is not configured");
      err.status = 503;
      err.publicMessage =
        "IntaSend is not configured. Add INTASEND_PUBLIC_KEY and INTASEND_SECRET_KEY.";
      throw err;
    }
    if (!intasendOn) {
      const err = new Error("IntaSend is disabled in this environment");
      err.status = 503;
      err.publicMessage =
        "IntaSend checkout is off locally. Pay with demo mode (instant), or set INTASEND_ENABLED=true with an HTTPS FRONTEND_URL.";
      throw err;
    }
    return "intasend";
  }

  if (!req && intasendOn) return "intasend";
  return "stub";
}

export function getPaymentProvider(gateway = "stub") {
  if (gateway === "intasend") {
    return {
      name: "intasend",
      async createCharge(params) {
        return createCheckoutSession(params);
      },
    };
  }
  return new StubProvider();
}

export function publicPaymentMethods() {
  const configured = isIntasendConfigured();
  const enabled = isIntasendEnabled();
  const methods = [];
  if (enabled) {
    methods.push({ id: "intasend", label: "IntaSend", available: true });
  }
  if (!env.isProd || !enabled) {
    methods.push({ id: "stub", label: "Demo (instant, no charge)", available: true });
  }
  return {
    defaultGateway: enabled ? "intasend" : "stub",
    intasendConfigured: configured,
    intasendEnabled: enabled,
    sandbox: configured && env.intasend.environment !== "live",
    intasendCheckoutMethod: enabled ? env.intasend.checkoutMethod || null : null,
    paymentNotice: enabled
      ? null
      : configured && !env.isProd
        ? "Demo payment is active. IntaSend M-Pesa needs a Kenya Safaricom line; card sandbox often hangs. Set INTASEND_ENABLED=true only when testing from Kenya or with a working sandbox setup."
        : null,
    methods,
  };
}
