import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { verifyWebhookChallenge } from "./webhookAuth.js";

describe("verifyWebhookChallenge", () => {
  it("allows traffic when no dashboard challenge is configured", () => {
    if (!process.env.INTASEND_WEBHOOK_CHALLENGE) {
      const result = verifyWebhookChallenge("anything");
      assert.equal(result.ok, true);
      assert.equal(result.reason, "no_challenge_configured");
    }
  });
});
