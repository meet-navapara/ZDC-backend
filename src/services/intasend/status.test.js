import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mapIntasendState,
  amountsMatch,
  nextPaymentTransition,
  sanitizeIntasendText,
  invoiceFromStatus,
  isDeadCardPending,
  isDeadMpesaProcessing,
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
    assert.equal(parsed.noData, false);
  });

  it("returns noData=true for IntaSend 'does not exist' 200 response", () => {
    const parsed = invoiceFromStatus({ detail: "Invoice with specified id does not exist" });
    assert.equal(parsed.noData, true);
    assert.equal(parsed.state, null);
    assert.equal(parsed.invoiceId, null);
  });

  it("returns noData=true for null response", () => {
    assert.equal(invoiceFromStatus(null).noData, true);
  });
});

describe("isDeadCardPending", () => {
  const cardPending = { state: "PENDING", provider: "CARD-PAYMENT", providerRef: null };

  it("does NOT flag a fresh PENDING card (normal 3DS window)", () => {
    assert.equal(isDeadCardPending(cardPending, { paymentAgeMs: 5_000 }), false);
  });
  it("detects PENDING card with no provider_ref as dead after min age", () => {
    assert.equal(isDeadCardPending(cardPending, { paymentAgeMs: 120_000 }), true);
  });
  it("detects PROCESSING card with no provider_ref as dead after min age", () => {
    assert.equal(
      isDeadCardPending(
        { state: "PROCESSING", provider: "CARD-PAYMENT", providerRef: null },
        { paymentAgeMs: 120_000 }
      ),
      true
    );
  });
  it("does not flag card with a provider_ref", () => {
    assert.equal(
      isDeadCardPending(
        { state: "PENDING", provider: "CARD-PAYMENT", providerRef: "XYZ" },
        { paymentAgeMs: 120_000 }
      ),
      false
    );
  });
  it("does not flag M-Pesa", () => {
    assert.equal(
      isDeadCardPending(
        { state: "PENDING", provider: "M-PESA", providerRef: null },
        { paymentAgeMs: 120_000 }
      ),
      false
    );
  });
});

describe("isDeadMpesaProcessing", () => {
  it("detects M-Pesa PROCESSING with high retry_count as dead", () => {
    assert.equal(isDeadMpesaProcessing({ state: "PROCESSING", provider: "M-PESA", retryCount: 2 }), true);
  });
  it("does not flag M-Pesa PROCESSING with low retry_count", () => {
    assert.equal(isDeadMpesaProcessing({ state: "PROCESSING", provider: "M-PESA", retryCount: 1 }), false);
  });
  it("does not flag M-Pesa PENDING", () => {
    assert.equal(isDeadMpesaProcessing({ state: "PENDING", provider: "M-PESA", retryCount: 3 }), false);
  });
  it("does not flag card", () => {
    assert.equal(isDeadMpesaProcessing({ state: "PROCESSING", provider: "CARD-PAYMENT", retryCount: 3 }), false);
  });
});
