import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isIntasendConfigured } from "./client.js";
import { resolveGateway } from "../payments.js";

describe("isIntasendConfigured", () => {
  it("is false without public and secret keys", () => {
    if (!process.env.INTASEND_PUBLIC_KEY && !process.env.INTASEND_SECRET_KEY) {
      assert.equal(isIntasendConfigured(), false);
    }
  });
});

describe("resolveGateway", () => {
  it("uses stub when IntaSend is not configured", () => {
    if (!process.env.INTASEND_PUBLIC_KEY) {
      assert.equal(resolveGateway(undefined), "stub");
      assert.equal(resolveGateway("stub"), "stub");
    }
  });
  it("rejects intasend when credentials are missing", () => {
    if (!process.env.INTASEND_PUBLIC_KEY) {
      assert.throws(() => resolveGateway("intasend"), /not configured/);
    }
  });
});
