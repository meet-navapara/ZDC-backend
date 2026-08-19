import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextPaymentTransition } from "./intasend/status.js";

describe("duplicate webhook / success-page refresh", () => {
  it("updates the order only on the first COMPLETE event", () => {
    const first = nextPaymentTransition("pending", "paid");
    const second = nextPaymentTransition("paid", "paid");
    assert.equal(first.fulfill, true);
    assert.equal(second.fulfill, false);
  });
});
