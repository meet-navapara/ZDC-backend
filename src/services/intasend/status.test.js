import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mapIntasendState,
  amountsMatch,
  nextPaymentTransition,
  sanitizeIntasendText,
  invoiceFromStatus,
} from "./status.js";

describe("mapIntasendState", () => {
  it("maps COMPLETE to paid", () => {
    assert.equal(mapIntasendState("COMPLETE"), "paid");
  });
  it("maps FAILED and CANCELED", () => {
    assert.equal(mapIntasendState("FAILED"), "failed");
    assert.equal(mapIntasendState("CANCELED"), "cancelled");
  });
  it("keeps PENDING/PROCESSING as pending", () => {
    assert.equal(mapIntasendState("PENDING"), "pending");
    assert.equal(mapIntasendState("PROCESSING"), "pending");
  });
});

describe("amountsMatch", () => {
  it("accepts matching KES amounts", () => {
    assert.equal(amountsMatch(20, "KES", "20.00", "kes"), true);
  });
  it("rejects tampered amount or currency", () => {
    assert.equal(amountsMatch(20, "KES", 1, "KES"), false);
    assert.equal(amountsMatch(20, "KES", 20, "USD"), false);
  });
});

describe("nextPaymentTransition", () => {
  it("fulfills only on the first paid event", () => {
    const first = nextPaymentTransition("pending", "paid");
    const dup = nextPaymentTransition("paid", "paid");
    assert.equal(first.fulfill, true);
    assert.equal(dup.fulfill, false);
    assert.equal(dup.alreadyPaid, true);
  });
  it("does not mark a paid order failed", () => {
    assert.equal(nextPaymentTransition("paid", "failed").status, "paid");
  });
});

describe("sanitizeIntasendText", () => {
  it("strips characters IntaSend rejects", () => {
    assert.equal(sanitizeIntasendText("Joe@Doe!"), "Joe Doe");
  });
});

describe("invoiceFromStatus", () => {
  it("reads invoice_id and state from the status payload", () => {
    const parsed = invoiceFromStatus({
      invoice: {
        invoice_id: "XMSLWOS",
        state: "COMPLETE",
        value: "20.00",
        currency: "KES",
        api_ref: "pay1",
      },
    });
    assert.equal(parsed.invoiceId, "XMSLWOS");
    assert.equal(parsed.state, "COMPLETE");
    assert.equal(parsed.currency, "KES");
  });
});
