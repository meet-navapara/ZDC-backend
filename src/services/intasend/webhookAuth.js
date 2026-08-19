import crypto from "crypto";
import { env } from "../../config/env.js";

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * IntaSend webhooks include a `challenge` you set in the dashboard.
 * @see https://developers.intasend.com/docs/setup
 * @see https://developers.intasend.com/docs/payment-collection-events
 */
export function verifyWebhookChallenge(provided) {
  const expected = env.intasend.webhookChallenge;
  if (!expected) return { ok: true, reason: "no_challenge_configured" };
  if (provided && timingSafeEqualString(provided, expected)) {
    return { ok: true, reason: "challenge" };
  }
  return { ok: false, reason: "invalid_challenge" };
}
