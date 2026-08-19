import { env } from "../../config/env.js";
import { intasendRequest, isIntasendConfigured } from "./client.js";
import { invoiceFromStatus, mapIntasendState, sanitizeIntasendText, sanitizePhone } from "./status.js";

export { isIntasendConfigured };

/** IntaSend rails the currency to a country. Shopper country (e.g. IN) on KES stalls card 3DS. */
const CURRENCY_COUNTRY = {
  KES: "KE",
  GHS: "GH",
  NGN: "NG",
  UGX: "UG",
  TZS: "TZ",
  XAF: "CM",
  XOF: "CI",
};

const KE_BILLING = {
  address: "Nairobi",
  city: "Nairobi",
  state: "Nairobi",
  zipcode: "00100",
};

export function checkoutCountryForCurrency(currency) {
  const code = String(currency || "").toUpperCase();
  return CURRENCY_COUNTRY[code] || env.intasend.country || "KE";
}

/** Co-op Bank card auth needs a local address. India + KES often hangs on Processing. */
export function billingFieldsForCountry(country) {
  return country === "KE" ? { ...KE_BILLING } : {};
}

/** Skip non-Kenyan numbers on KES checkouts so M-Pesa is not prefilled with a foreign MSISDN. */
export function checkoutPhoneForCountry(phone, country) {
  const digits = sanitizePhone(phone);
  if (!digits) return undefined;
  if (country === "KE" && !(digits.startsWith("254") || digits.startsWith("0"))) {
    return undefined;
  }
  return digits;
}

/**
 * Create a hosted checkout link.
 * POST /api/v1/checkout/ with X-IntaSend-Public-API-Key
 * @see https://developers.intasend.com/docs/checkout-links
 * @see https://developers.intasend.com/reference/api_v1_checkout_create
 */
export async function createCheckoutSession({
  apiRef,
  amount,
  currency,
  email,
  firstName,
  lastName,
  phone,
  country: _ignoredCountry,
  comment,
  redirectUrl,
  host,
}) {
  const country = checkoutCountryForCurrency(currency);
  const payload = {
    amount: Number(amount).toFixed(2),
    currency: String(currency).toUpperCase(),
    api_ref: sanitizeIntasendText(apiRef, 140),
    redirect_url: redirectUrl,
    host,
    channel: "WEBSITE",
    email: email || undefined,
    first_name: sanitizeIntasendText(firstName) || undefined,
    last_name: sanitizeIntasendText(lastName) || undefined,
    phone_number: checkoutPhoneForCountry(phone, country),
    country,
    ...billingFieldsForCountry(country),
    comment: sanitizeIntasendText(comment, 140) || undefined,
  };

  const httpsRedirect = String(payload.redirect_url || "").startsWith("https://");
  console.log("[intasend] checkout_create", {
    apiRef: payload.api_ref,
    amount: payload.amount,
    currency: payload.currency,
    country: payload.country,
    httpsRedirect,
  });
  if (!httpsRedirect) {
    console.warn(
      "[intasend] redirect_url is not HTTPS. IntaSend card 3DS can stay on Processing. Use M-Pesa 254708374149 in sandbox, or set FRONTEND_URL to https."
    );
  }

  const data = await intasendRequest("POST", "/api/v1/checkout/", payload, {
    auth: "public",
  });

  const checkoutUrl = data?.url;
  const checkoutId = data?.id || null;
  const invoiceId = data?.invoice?.invoice_id || data?.invoice_id || null;

  if (!checkoutUrl) {
    const err = new Error("IntaSend checkout response did not include a URL");
    err.status = 502;
    err.publicMessage = "IntaSend did not return a checkout page.";
    throw err;
  }

  console.log("[intasend] checkout_created", {
    apiRef: payload.api_ref,
    checkoutId,
    invoiceId,
  });

  return {
    status: "pending",
    gateway: "intasend",
    checkoutUrl,
    providerCheckoutId: checkoutId,
    providerInvoiceId: invoiceId || undefined,
    reference: invoiceId || checkoutId || payload.api_ref,
  };
}

/**
 * Verify payment with IntaSend. Never trust redirect or webhook body alone.
 * POST /api/v1/payment/status/
 * @see https://developers.intasend.com/docs/payment-status
 * @see https://developers.intasend.com/reference/api_v1_payment_status_create
 */
export async function getPaymentStatus({ invoiceId, checkoutId }) {
  const invoice_id = invoiceId || checkoutId;
  if (!invoice_id) {
    const err = new Error("Missing IntaSend invoice id");
    err.status = 400;
    throw err;
  }
  const body = { invoice_id };
  if (checkoutId) body.checkout_id = checkoutId;
  const data = await intasendRequest("POST", "/api/v1/payment/status/", body, {
    auth: "secret",
  });
  const parsed = invoiceFromStatus(data);
  return {
    status: mapIntasendState(parsed.state),
    providerState: parsed.state,
    amount: parsed.amount,
    currency: parsed.currency,
    providerInvoiceId: parsed.invoiceId,
    providerCheckoutId: parsed.checkoutId || checkoutId || null,
    apiRef: parsed.apiRef,
    method: parsed.provider,
    failedReason: parsed.failedReason,
  };
}

export function verifyPayment(ids) {
  return getPaymentStatus(ids);
}

/**
 * Refund / chargeback.
 * POST /api/v1/chargebacks/
 * @see https://developers.intasend.com/docs/creating-refunds
 * @see https://developers.intasend.com/reference/api_v1_chargebacks_create
 */
export async function refundPayment({ invoiceId, amount, reason = "Customer refund" }) {
  if (!invoiceId) {
    const err = new Error("Missing IntaSend invoice id");
    err.status = 400;
    throw err;
  }
  console.log("[intasend] refund_request", { invoiceId, amount: Number(amount) });
  const data = await intasendRequest(
    "POST",
    "/api/v1/chargebacks/",
    {
      invoice_id: invoiceId,
      amount: Number(amount).toFixed(2),
      reason: sanitizeIntasendText(reason, 140) || "Refund",
    },
    { auth: "secret" }
  );
  return data;
}
