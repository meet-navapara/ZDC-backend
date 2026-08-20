import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { persistInvoiceIdIfMissing, resolveIntasendStatusIds } from "./webhook.js";
import { buildPaymentStatusRequestBody } from "./checkout.js";

describe("persistInvoiceIdIfMissing", () => {
  it("sets providerInvoiceId when missing", () => {
    const payment = {
      providerInvoiceId: null,
      providerCheckoutId: "c33365c5-512b-487e-ad39-c2d1757a4087",
    };
    const changed = persistInvoiceIdIfMissing(payment, "Y7WB32Q");
    assert.equal(changed, true);
    assert.equal(payment.providerInvoiceId, "Y7WB32Q");
    assert.equal(payment.providerCheckoutId, "c33365c5-512b-487e-ad39-c2d1757a4087");
  });

  it("does not overwrite an existing providerInvoiceId", () => {
    const payment = { providerInvoiceId: "EXISTING1" };
    const changed = persistInvoiceIdIfMissing(payment, "Y7WB32Q");
    assert.equal(changed, false);
    assert.equal(payment.providerInvoiceId, "EXISTING1");
  });

  it("ignores empty invoice_id", () => {
    const payment = { providerInvoiceId: null };
    assert.equal(persistInvoiceIdIfMissing(payment, ""), false);
    assert.equal(persistInvoiceIdIfMissing(payment, "   "), false);
    assert.equal(payment.providerInvoiceId, null);
  });
});

describe("syncIntasendPayment identifier preference", () => {
  it("prefers payment.providerInvoiceId over checkout_id for status requests", () => {
    const payment = {
      providerInvoiceId: "Y7WB32Q",
      providerCheckoutId: "c33365c5-512b-487e-ad39-c2d1757a4087",
      reference: "c33365c5-512b-487e-ad39-c2d1757a4087",
    };
    const { invoiceId, checkoutId } = resolveIntasendStatusIds(payment);
    const body = buildPaymentStatusRequestBody({ invoiceId, checkoutId });
    assert.equal(invoiceId, "Y7WB32Q");
    assert.equal(body.invoice_id, "Y7WB32Q");
    assert.equal(body.checkout_id, "c33365c5-512b-487e-ad39-c2d1757a4087");
  });

  it("uses checkout_id only when providerInvoiceId is missing", () => {
    const payment = {
      providerInvoiceId: null,
      providerCheckoutId: "c33365c5-512b-487e-ad39-c2d1757a4087",
      reference: "c33365c5-512b-487e-ad39-c2d1757a4087",
    };
    const { invoiceId, checkoutId } = resolveIntasendStatusIds(payment);
    const body = buildPaymentStatusRequestBody({ invoiceId, checkoutId });
    assert.equal(invoiceId, undefined);
    assert.equal(body.checkout_id, "c33365c5-512b-487e-ad39-c2d1757a4087");
    assert.equal(body.invoice_id, undefined);
  });
});
