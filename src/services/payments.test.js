import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  nextPaymentTransition,
  resolveGateway,
  resolveMarketGateway,
  publicPaymentMethods,
} from "./payments.js";
import { normalizeKenyaMsisdn, isKenyaMsisdn } from "../utils/phone.js";
import { parseStkCallback } from "./mpesa/parseCallback.js";
import { mapStkResultCode } from "./mpesa/daraja.js";

describe("resolveGateway", () => {
  it("defaults to stub when M-Pesa is off", () => {
    assert.equal(resolveGateway(), "stub");
    assert.equal(resolveGateway("stub"), "stub");
  });
  it("keeps referral", () => {
    assert.equal(resolveGateway("referral"), "referral");
  });
  it("rejects razorpay / intasend until later phases", () => {
    assert.throws(() => resolveGateway("intasend"), /not available/);
    assert.throws(() => resolveGateway("razorpay"), /not available|Phase 3/);
  });
  it("rejects explicit mpesa when not configured, else allows", async () => {
    const { isMpesaLive } = await import("./mpesa/daraja.js");
    if (isMpesaLive()) {
      assert.equal(resolveGateway("mpesa"), "mpesa");
    } else {
      assert.throws(() => resolveGateway("mpesa"), /not enabled/);
    }
  });
  it("routes KES pack currency to mpesa when live, even for India profiles", async () => {
    const { isMpesaLive } = await import("./mpesa/daraja.js");
    if (!isMpesaLive()) return;
    const india = {
      business: { currency: "INR", address: { country: "India" } },
    };
    assert.equal(resolveGateway(null, india), "stub");
    assert.equal(resolveGateway(null, india, { currency: "KES" }), "mpesa");
  });
});

describe("resolveMarketGateway", () => {
  it("routes Kenya + KES to mpesa", () => {
    const m = resolveMarketGateway({
      business: { currency: "KES", address: { country: "Kenya" } },
    });
    assert.equal(m.gateway, "mpesa");
    assert.equal(m.currency, "KES");
  });
  it("routes India + INR to razorpay", () => {
    const m = resolveMarketGateway({
      business: { currency: "INR", address: { country: "India" } },
    });
    assert.equal(m.gateway, "razorpay");
  });
  it("routes KES without country to mpesa", () => {
    assert.equal(resolveMarketGateway({ currency: "KES" }).gateway, "mpesa");
  });
  it("keeps unsupported markets on stub", () => {
    const m = resolveMarketGateway({
      business: { currency: "UGX", address: { country: "Uganda" } },
    });
    assert.equal(m.gateway, "stub");
  });
});

describe("publicPaymentMethods", () => {
  it("exposes demo stub when mpesa offline", () => {
    const methods = publicPaymentMethods();
    assert.equal(methods.defaultGateway, "stub");
    assert.ok(methods.methods.some((m) => m.id === "stub"));
  });
  it("includes planned gateway when user provided", () => {
    const methods = publicPaymentMethods({
      business: { currency: "KES", address: { country: "Kenya" } },
    });
    assert.equal(methods.plannedGateway, "mpesa");
  });
});

describe("normalizeKenyaMsisdn", () => {
  it("normalizes local and international forms", () => {
    assert.equal(normalizeKenyaMsisdn("0712345678"), "254712345678");
    assert.equal(normalizeKenyaMsisdn("+254712345678"), "254712345678");
    assert.equal(normalizeKenyaMsisdn("254712345678"), "254712345678");
    assert.equal(normalizeKenyaMsisdn("712345678"), "254712345678");
  });
  it("rejects unusable values", () => {
    assert.equal(normalizeKenyaMsisdn(""), null);
    assert.equal(normalizeKenyaMsisdn("abc"), null);
  });
  it("isKenyaMsisdn checks Safaricom-style 2547…", () => {
    assert.equal(isKenyaMsisdn("0712345678"), true);
    assert.equal(isKenyaMsisdn("254112345678"), false);
  });
});

describe("parseStkCallback", () => {
  it("parses success callback", () => {
    const parsed = parseStkCallback({
      Body: {
        stkCallback: {
          MerchantRequestID: "m-1",
          CheckoutRequestID: "ws_CO_1",
          ResultCode: 0,
          ResultDesc: "The service request is processed successfully.",
          CallbackMetadata: {
            Item: [
              { Name: "Amount", Value: 100 },
              { Name: "MpesaReceiptNumber", Value: "ABC123" },
              { Name: "PhoneNumber", Value: 254712345678 },
            ],
          },
        },
      },
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.verifiedStatus, "paid");
    assert.equal(parsed.mpesaReceiptNumber, "ABC123");
    assert.equal(parsed.checkoutRequestId, "ws_CO_1");
  });
  it("parses user cancel", () => {
    const parsed = parseStkCallback({
      Body: {
        stkCallback: {
          CheckoutRequestID: "ws_CO_2",
          ResultCode: 1032,
          ResultDesc: "Request cancelled by user.",
        },
      },
    });
    assert.equal(parsed.verifiedStatus, "cancelled");
  });
});

describe("mapStkResultCode", () => {
  it("maps common codes", () => {
    assert.equal(mapStkResultCode(0), "paid");
    assert.equal(mapStkResultCode(1032), "cancelled");
    assert.equal(mapStkResultCode(1037), "failed");
    assert.equal(
      mapStkResultCode(1, "The transaction is still under processing"),
      null
    );
    assert.equal(mapStkResultCode("500.001.1001"), null);
  });
});

describe("nextPaymentTransition", () => {
  it("fulfills only on the first paid event", () => {
    const first = nextPaymentTransition("pending", "paid");
    const second = nextPaymentTransition("paid", "paid");
    assert.equal(first.fulfill, true);
    assert.equal(second.fulfill, false);
    assert.equal(second.alreadyPaid, true);
  });
  it("does not mark a paid order failed", () => {
    assert.equal(nextPaymentTransition("paid", "failed").status, "paid");
  });
});
