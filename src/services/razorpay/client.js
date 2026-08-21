import crypto from "crypto";
import { env } from "../../config/env.js";

export function isRazorpayLive() {
  return Boolean(env.razorpay.enabled && env.razorpay.configured);
}

function authHeader() {
  const token = Buffer.from(
    `${env.razorpay.keyId}:${env.razorpay.keySecret}`
  ).toString("base64");
  return `Basic ${token}`;
}

async function razorpayFetch(path, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.error?.description ||
      data?.error?.reason ||
      `Razorpay HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status >= 500 ? 502 : 400;
    err.publicMessage = msg;
    throw err;
  }
  return data;
}

/** Amount in paise (INR × 100). */
export function toPaise(amountInr) {
  return Math.round(Number(amountInr) * 100);
}

/**
 * Create a Razorpay order for Checkout.
 * @returns {Promise<{ id: string, amount: number, currency: string, receipt: string }>}
 */
export async function createOrder({ amount, currency, receipt, notes }) {
  if (!isRazorpayLive()) {
    const err = new Error("Razorpay is not enabled");
    err.status = 400;
    err.publicMessage =
      "Razorpay is not enabled. Set RAZORPAY_ENABLED and key credentials.";
    throw err;
  }
  const cur = String(currency || "INR").toUpperCase();
  if (cur !== "INR") {
    const err = new Error("Razorpay only supports INR in Phase 3");
    err.status = 400;
    err.publicMessage = "Razorpay checkout is INR only.";
    throw err;
  }
  return razorpayFetch("/orders", {
    method: "POST",
    body: {
      amount: toPaise(amount),
      currency: "INR",
      receipt: String(receipt || `zimji_${Date.now()}`).slice(0, 40),
      notes: notes || undefined,
    },
  });
}

export function verifyPaymentSignature({
  orderId,
  paymentId,
  signature,
}) {
  const payload = `${orderId}|${paymentId}`;
  const expected = crypto
    .createHmac("sha256", env.razorpay.keySecret)
    .update(payload)
    .digest("hex");
  return expected === signature;
}

export function verifyWebhookSignature(rawBody, signature) {
  if (!env.razorpay.webhookSecret) return false;
  const expected = crypto
    .createHmac("sha256", env.razorpay.webhookSecret)
    .update(rawBody)
    .digest("hex");
  return expected === signature;
}

export async function fetchPayment(paymentId) {
  return razorpayFetch(`/payments/${paymentId}`);
}
