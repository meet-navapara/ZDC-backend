import { env } from "../../config/env.js";

export class IntasendError extends Error {
  constructor(message, { status = 502, publicMessage } = {}) {
    super(message);
    this.name = "IntasendError";
    this.status = status;
    this.publicMessage = publicMessage || message;
  }
}

export function isIntasendConfigured() {
  return Boolean(env.intasend.publicKey && env.intasend.secretKey);
}

async function parseBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 400) };
  }
}

/**
 * IntaSend REST helper.
 * Checkout uses the public key header; status/refunds use Bearer secret.
 * @see https://developers.intasend.com/docs/authentication
 */
export async function intasendRequest(method, path, body, { auth } = {}) {
  if (!isIntasendConfigured()) {
    throw new IntasendError("IntaSend is not configured", {
      status: 503,
      publicMessage: "IntaSend is not configured on this server.",
    });
  }

  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  if (auth === "public") {
    headers["X-IntaSend-Public-API-Key"] = env.intasend.publicKey;
  } else {
    headers.Authorization = `Bearer ${env.intasend.secretKey}`;
  }

  const url = `${env.intasend.apiBase}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(env.intasend.timeoutMs),
    });
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    throw new IntasendError(
      timedOut ? "IntaSend API timeout" : `IntaSend network error: ${err.message}`,
      {
        status: 504,
        publicMessage: timedOut
          ? "Payment provider timed out. Please try again."
          : "Could not reach IntaSend. Please try again.",
      }
    );
  }

  const data = await parseBody(res);
  if (!res.ok) {
    const info = data?.detail || data?.message || data?.error || `HTTP ${res.status}`;
    console.error("[intasend] api_error", {
      method,
      path,
      status: res.status,
      detail: typeof info === "string" ? info.slice(0, 200) : null,
    });
    throw new IntasendError(`IntaSend API error: ${info}`, {
      status: res.status >= 400 && res.status < 500 ? 400 : 502,
      publicMessage: "IntaSend could not start or verify this payment.",
    });
  }
  return data;
}
