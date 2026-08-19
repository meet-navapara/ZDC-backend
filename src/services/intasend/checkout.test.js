import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkoutCountryForCurrency,
  billingFieldsForCountry,
  checkoutPhoneForCountry,
} from "./checkout.js";

describe("checkoutCountryForCurrency", () => {
  it("maps KES to Kenya so the hosted form is not India", () => {
    assert.equal(checkoutCountryForCurrency("KES"), "KE");
    assert.equal(checkoutCountryForCurrency("kes"), "KE");
  });
});

describe("billingFieldsForCountry", () => {
  it("sends Nairobi billing for KE card auth", () => {
    const billing = billingFieldsForCountry("KE");
    assert.equal(billing.city, "Nairobi");
    assert.equal(billing.zipcode, "00100");
  });
  it("does not invent KE address for other countries", () => {
    assert.deepEqual(billingFieldsForCountry("GH"), {});
  });
});

describe("checkoutPhoneForCountry", () => {
  it("keeps Kenyan MSISDNs", () => {
    assert.equal(checkoutPhoneForCountry("254708374149", "KE"), "254708374149");
  });
  it("drops Indian numbers on KES checkout", () => {
    assert.equal(checkoutPhoneForCountry("919876543210", "KE"), undefined);
  });
});
