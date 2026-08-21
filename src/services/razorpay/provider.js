import { env } from "../../config/env.js";
import { createOrder, isRazorpayLive, toPaise } from "./client.js";

export class RazorpayProvider {
  constructor() {
    this.name = "razorpay";
  }

  /**
   * Creates a Razorpay Order. Client opens Checkout; verify/webhook marks paid.
   */
  async createCharge({ amount, currency, reference, description, notes }) {
    if (!isRazorpayLive()) {
      const err = new Error("Razorpay is not enabled");
      err.status = 400;
      err.publicMessage =
        "Razorpay is not enabled yet. Set RAZORPAY_ENABLED and keys, or use demo payment.";
      throw err;
    }

    const order = await createOrder({
      amount,
      currency: currency || "INR",
      receipt: reference,
      notes: {
        description: description || "zimji",
        ...(notes || {}),
      },
    });

    return {
      status: "pending",
      gateway: this.name,
      reference: order.receipt || reference,
      amount,
      currency: "INR",
      providerCheckoutId: order.id,
      meta: {
        razorpayOrderId: order.id,
        razorpayKeyId: env.razorpay.keyId,
        amountPaise: order.amount || toPaise(amount),
        customerMessage: "Complete payment in the Razorpay window.",
      },
    };
  }
}
