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

export function resolveGateway(requested) {
  const req = requested || null;
  if (req === "referral") return "referral";

  const intasendOn = isIntasendConfigured();
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
    if (!intasendOn) {
      const err = new Error("IntaSend is not configured");
      err.status = 503;
      err.publicMessage =
        "IntaSend is not configured. Add INTASEND_PUBLIC_KEY and INTASEND_SECRET_KEY.";
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
  const intasendOn = isIntasendConfigured();
  const methods = [];
  if (intasendOn) {
    methods.push({ id: "intasend", label: "IntaSend", available: true });
  }
  if (!env.isProd || !intasendOn) {
    methods.push({ id: "stub", label: "Demo (no charge)", available: true });
  }
  return {
    defaultGateway: intasendOn ? "intasend" : "stub",
    intasendConfigured: intasendOn,
    sandbox: intasendOn && env.intasend.environment !== "live",
    methods,
  };
}
