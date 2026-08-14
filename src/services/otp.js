import crypto from "crypto";
import bcrypt from "bcryptjs";
import { EmailOtp } from "../models/EmailOtp.js";
import { sendSignupOtpEmail } from "./mail.js";
import { env } from "../config/env.js";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

export function generateOtpCode() {
  // 6-digit numeric, cryptographically strong
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, "0");
}

/**
 * Create / replace a pending signup OTP challenge.
 * @param {{ email: string, purpose: string, payload: object }}
 */
export async function issueSignupOtp({ email, purpose, payload }) {
  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await EmailOtp.deleteMany({ email, purpose });
  await EmailOtp.create({
    email,
    purpose,
    codeHash,
    payload,
    expiresAt,
    attempts: 0,
  });

  await sendSignupOtpEmail(email, code);

  const result = {
    email,
    purpose,
    expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    mailConfigured: Boolean(env.smtp.host && env.smtp.user && env.smtp.pass),
  };

  // Helpful for local/dev when SMTP is not set — never expose in production.
  if (!env.isProd && !result.mailConfigured) {
    result.devOtp = code;
  }

  return result;
}

/**
 * Verify OTP and return the stored signup payload (then delete the challenge).
 */
export async function consumeSignupOtp({ email, purpose, code }) {
  const challenge = await EmailOtp.findOne({ email, purpose }).sort({
    createdAt: -1,
  });
  if (!challenge) {
    const err = new Error("No verification code found. Request a new one.");
    err.status = 400;
    throw err;
  }
  if (challenge.expiresAt.getTime() < Date.now()) {
    await challenge.deleteOne();
    const err = new Error("Verification code expired. Request a new one.");
    err.status = 400;
    throw err;
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    await challenge.deleteOne();
    const err = new Error("Too many attempts. Request a new code.");
    err.status = 429;
    throw err;
  }

  const ok = await bcrypt.compare(String(code).trim(), challenge.codeHash);
  if (!ok) {
    challenge.attempts += 1;
    await challenge.save();
    const err = new Error("Invalid verification code.");
    err.status = 400;
    throw err;
  }

  const payload = challenge.payload;
  await challenge.deleteOne();
  return payload;
}
