import { normalizeKenyaMsisdn, isKenyaMsisdn } from "../../utils/phone.js";
import { env } from "../../config/env.js";
import { isMpesaLive, stkPush } from "./daraja.js";

export class MpesaProvider {
  constructor() {
    this.name = "mpesa";
  }

  /**
   * Starts STK Push. Returns pending until Daraja callback confirms paid.
   * When MPESA_SANDBOX_AUTO_PAID=true (sandbox only), skips Daraja STK so
   * local verify is not blocked by DS timeout (1037).
   * @param {{ amount: number, currency: string, reference: string, phone?: string, description?: string }} opts
   */
  async createCharge({ amount, currency, reference, phone, description }) {
    if (!isMpesaLive()) {
      const err = new Error("M-Pesa is not configured");
      err.status = 503;
      err.publicMessage =
        "M-Pesa is not enabled. Set MPESA_ENABLED and Daraja credentials.";
      throw err;
    }

    const cur = String(currency || "").toUpperCase();
    if (cur !== "KES") {
      const err = new Error("M-Pesa only accepts KES");
      err.status = 400;
      err.publicMessage = "M-Pesa payments must be in Kenyan Shillings (KES).";
      throw err;
    }

    const msisdn = normalizeKenyaMsisdn(phone);
    if (!msisdn || !isKenyaMsisdn(msisdn)) {
      const err = new Error("Invalid Kenya M-Pesa phone");
      err.status = 400;
      err.publicMessage =
        "Enter a valid Safaricom M-Pesa number (e.g. 07XXXXXXXX or 2547XXXXXXXX).";
      throw err;
    }

    // Local verification mode: no Daraja STK → no DS timeout race.
    if (env.mpesa.env === "sandbox" && env.mpesa.sandboxAutoPaid) {
      const checkoutId = `ws_SANDBOX_${Date.now()}`;
      console.info(
        "[mpesa] SANDBOX_AUTO_PAID: skipping Daraja STK; will auto-confirm shortly"
      );
      return {
        status: "pending",
        gateway: this.name,
        reference: reference || `mpesa_${Date.now()}`,
        amount,
        currency: "KES",
        providerCheckoutId: checkoutId,
        providerInvoiceId: `m_SANDBOX_${Date.now()}`,
        meta: {
          phone: msisdn,
          customerMessage:
            "Sandbox auto-pay: confirming in a few seconds (no PIN needed).",
          sandboxAutoPaid: true,
          checkoutRequestId: checkoutId,
        },
      };
    }

    const stk = await stkPush({
      amount,
      phone254: msisdn,
      accountReference: reference,
      transactionDesc: description || "zimji",
    });

    return {
      status: "pending",
      gateway: this.name,
      reference: reference || `mpesa_${Date.now()}`,
      amount,
      currency: "KES",
      providerCheckoutId: stk.checkoutRequestId,
      providerInvoiceId: stk.merchantRequestId,
      meta: {
        phone: msisdn,
        customerMessage: stk.customerMessage,
        merchantRequestId: stk.merchantRequestId,
        checkoutRequestId: stk.checkoutRequestId,
      },
    };
  }
}
