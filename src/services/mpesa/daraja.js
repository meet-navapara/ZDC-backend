/**
 * Safaricom Daraja STK Push client (M-Pesa Express).
 * Docs: https://developer.safaricom.co.ke/
 */
import { env } from "../../config/env.js";

let cachedToken = null;
let cachedTokenExpiresAt = 0;

export function isMpesaLive() {
  return Boolean(env.mpesa.enabled && env.mpesa.configured);
}

function baseUrl() {
  return env.mpesa.env === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

function timestampNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function stkPassword(timestamp) {
  const raw = `${env.mpesa.shortcode}${env.mpesa.passkey}${timestamp}`;
  return Buffer.from(raw).toString("base64");
}

async function darajaFetch(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    console.error(
      "[mpesa] Daraja HTTP",
      res.status,
      path,
      JSON.stringify(data)?.slice(0, 500)
    );
    const detail =
      data?.errorMessage ||
      data?.error_description ||
      data?.ResponseDescription ||
      data?.requestId ||
      `Daraja HTTP ${res.status}`;
    const err = new Error(detail);
    err.status = 502;
    err.publicMessage =
      env.mpesa.env === "sandbox"
        ? `M-Pesa provider error: ${detail}`
        : "M-Pesa provider error. Please try again shortly.";
    err.daraja = data;
    throw err;
  }
  return data;
}

export async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiresAt - 30_000) {
    return cachedToken;
  }
  const basic = Buffer.from(
    `${env.mpesa.consumerKey}:${env.mpesa.consumerSecret}`
  ).toString("base64");
  const res = await fetch(
    `${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${basic}` } }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const err = new Error(data.error_description || "M-Pesa auth failed");
    err.status = 502;
    err.publicMessage = "Could not connect to M-Pesa. Check Daraja credentials.";
    throw err;
  }
  cachedToken = data.access_token;
  const expiresIn = parseInt(data.expires_in || "3599", 10);
  cachedTokenExpiresAt = now + expiresIn * 1000;
  return cachedToken;
}

/**
 * Initiate Lipa Na M-Pesa Online (STK Push).
 * @returns {{ merchantRequestId, checkoutRequestId, responseCode, customerMessage }}
 */
export async function stkPush({
  amount,
  phone254,
  accountReference,
  transactionDesc,
}) {
  const token = await getAccessToken();
  const timestamp = timestampNow();
  const password = stkPassword(timestamp);
  const amountInt = Math.max(1, Math.round(Number(amount)));

  const data = await darajaFetch(
    "/mpesa/stkpush/v1/processrequest",
    {
      method: "POST",
      token,
      body: {
        BusinessShortCode: env.mpesa.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: env.mpesa.transactionType,
        Amount: amountInt,
        PartyA: phone254,
        PartyB: env.mpesa.shortcode,
        PhoneNumber: phone254,
        CallBackURL: env.mpesa.callbackUrl,
        AccountReference: String(accountReference || "zimji").slice(0, 12),
        TransactionDesc: String(transactionDesc || "zimji payment").slice(0, 13),
      },
    }
  );

  // ResponseCode "0" means prompt was accepted — not that money moved.
  if (String(data.ResponseCode) !== "0") {
    const err = new Error(
      data.ResponseDescription || data.CustomerMessage || "STK Push rejected"
    );
    err.status = 400;
    err.publicMessage =
      data.CustomerMessage ||
      data.ResponseDescription ||
      "Could not start M-Pesa prompt. Check the phone number.";
    err.daraja = data;
    throw err;
  }

  return {
    merchantRequestId: data.MerchantRequestID || null,
    checkoutRequestId: data.CheckoutRequestID || null,
    responseCode: data.ResponseCode,
    customerMessage: data.CustomerMessage || null,
  };
}

/** Optional poll when callback is slow. */
export async function stkQuery(checkoutRequestId) {
  const token = await getAccessToken();
  const timestamp = timestampNow();
  const password = stkPassword(timestamp);
  return darajaFetch("/mpesa/stkpushquery/v1/query", {
    method: "POST",
    token,
    body: {
      BusinessShortCode: env.mpesa.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    },
  });
}

/**
 * True while Daraja has not finished the STK (keep Payment pending).
 * Do NOT treat these as failed — the UI error "still under processing" came from that bug.
 */
export function isStkInProgress(resultCode, resultDesc = "") {
  const code = String(resultCode ?? "").trim();
  const desc = String(resultDesc || "").toLowerCase();
  if (!code || code === "null" || code === "undefined") return true;
  if (code === "500.001.1001") return true; // not found / still processing
  if (Number.isNaN(Number(code))) return true;
  if (desc.includes("still under processing")) return true;
  if (desc.includes("being processed")) return true;
  return false;
}

/**
 * Map STK query/callback ResultCode to our payment statuses.
 * @returns {"paid"|"cancelled"|"failed"|null} null = keep pending
 */
export function mapStkResultCode(resultCode, resultDesc = "") {
  if (isStkInProgress(resultCode, resultDesc)) return null;
  const code = Number(resultCode);
  if (code === 0) return "paid";
  if (code === 1032) return "cancelled";
  // 1037 timeout, 1001 busy, 1 insufficient funds, etc.
  return "failed";
}
