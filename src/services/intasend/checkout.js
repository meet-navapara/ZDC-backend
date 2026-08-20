import { env } from "../../config/env.js";
import { intasendRequest, isIntasendConfigured } from "./client.js";
import { invoiceFromStatus, isDeadCardPending, mapIntasendState, sanitizeIntasendText, sanitizePhone } from "./status.js";

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
  // Sandbox M-Pesa: always use the official sandbox test number.
  // This avoids "Failed to initiate transaction" when the user's profile phone
  // is not STK/M-Pesa enabled.
  const phoneForCheckout =
    env.intasend.environment !== "live" && env.intasend.checkoutMethod === "M-PESA"
      ? env.intasend.mockMpesaPhone
      : checkoutPhoneForCountry(phone, country);
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
    phone_number: phoneForCheckout,
    country,
    ...billingFieldsForCountry(country),
    comment: sanitizeIntasendText(comment, 140) || undefined,
  };
  if (env.intasend.checkoutMethod) {
    payload.method = env.intasend.checkoutMethod;
  }

  const httpsRedirect = String(payload.redirect_url || "").startsWith("https://");
  console.log("[intasend] checkout_create", {
    apiRef: payload.api_ref,
    amount: payload.amount,
    currency: payload.currency,
    country: payload.country,
    method: payload.method || "all",
    host: payload.host,
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
export function buildPaymentStatusRequestBody({ invoiceId, checkoutId }) {
  const body = {};
  if (invoiceId) {
    body.invoice_id = invoiceId;
    if (checkoutId) body.checkout_id = checkoutId;
  } else if (checkoutId) {
    body.checkout_id = checkoutId;
  } else {
    const err = new Error("Missing IntaSend invoice id / checkout id");
    err.status = 400;
    throw err;
  }
  return body;
}

export async function getPaymentStatus({ invoiceId, checkoutId }) {
  // IntaSend supports checking by `invoice_id` OR `checkout_id`.
  // When checkout is created, `invoice_id` can be null; in that case we must
  // query using `checkout_id` only, otherwise status stays stuck.
  const body = buildPaymentStatusRequestBody({ invoiceId, checkoutId });
  const data = await intasendRequest("POST", "/api/v1/payment/status/", body, {
    auth: "secret",
  });
  const parsed = invoiceFromStatus(data);
  const deadCard = isDeadCardPending(parsed);
  return {
    status: deadCard ? "failed" : mapIntasendState(parsed.state),
    providerState: parsed.state,
    amount: parsed.amount,
    currency: parsed.currency,
    providerInvoiceId: parsed.invoiceId,
    providerCheckoutId: parsed.checkoutId || checkoutId || null,
    apiRef: parsed.apiRef,
    method: parsed.provider,
    failedReason: deadCard
      ? "Card 3DS authentication did not complete. Use M-Pesa (254708374149) for sandbox testing, or try a real card in live mode."
      : parsed.failedReason,
    _parsed: parsed,
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
