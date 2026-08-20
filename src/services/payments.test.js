import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextPaymentTransition, resolveGateway, publicPaymentMethods } from "./payments.js";

describe("resolveGateway", () => {
  it("defaults to stub", () => {
    assert.equal(resolveGateway(), "stub");
    assert.equal(resolveGateway("stub"), "stub");
  });
  it("keeps referral", () => {
    assert.equal(resolveGateway("referral"), "referral");
  });
  it("rejects removed IntaSend / mpesa gateways", () => {
    assert.throws(() => resolveGateway("intasend"), /no longer available/);
    assert.throws(() => resolveGateway("mpesa"), /no longer available/);
  });
});

describe("publicPaymentMethods", () => {
  it("exposes demo stub only", () => {
    const methods = publicPaymentMethods();
    assert.equal(methods.defaultGateway, "stub");
    assert.equal(methods.methods.length, 1);
    assert.equal(methods.methods[0].id, "stub");
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
