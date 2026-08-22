import { z } from "zod";
import { getCreditPacks, getCreditPack, getCreditPacksDual, getCreditPackBase } from "../services/pricing.js";
import { Payment } from "../models/Payment.js";
import { User } from "../models/User.js";
import { getPaymentProvider, resolveGateway } from "../services/payments.js";
import { isMpesaLive } from "../services/mpesa/daraja.js";
import { isRazorpayLive } from "../services/razorpay/client.js";
import { packAmountForGateway } from "../config/inrPricing.js";
import { addCredits, getBalance, listLedger } from "../services/credits.js";
import { capture } from "../services/analytics.js";
import { buildCreditInvoicePdf, invoiceContextForPayment } from "../services/invoice.js";
import { objectIdField, slugField } from "../utils/validators.js";
import { serializePayment } from "./paymentsController.js";
import { scheduleSandboxAutoPaid } from "../services/mpesa/sandboxAutoPaid.js";

export async function listCreditPacks(req, res, next) {
  try {
    const dualPrices = isMpesaLive() && isRazorpayLive();
    const packs = dualPrices
      ? await getCreditPacksDual()
      : await getCreditPacks(
          req.user?.sub ? await User.findById(req.user.sub) : null
        );
    return res.json({ packs, dualPrices });
  } catch (err) {
    return next(err);
  }
}

export async function getWallet(req, res, next) {
  try {
    const balance = await getBalance(req.user.sub);
    return res.json({ balance });
  } catch (err) {
    return next(err);
  }
}

export async function getLedger(req, res, next) {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || "50", 10) || 50));
    const page = Math.max(1, parseInt(req.query.page || "1", 10) || 1);
    const result = await listLedger(req.user.sub, { limit, page });
    return res.json({
      ledger: result.entries,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  } catch (err) {
    return next(err);
  }
}

const purchaseSchema = z.object({
  pack: slugField,
  gateway: z.enum(["stub", "mpesa", "razorpay", "intasend", "auto"]).optional(),
  phone: z.string().trim().min(9).max(20).optional(),
});

export async function purchaseCredits(req, res, next) {
  try {
    const data = purchaseSchema.parse(req.body);
    const user = await User.findById(req.user.sub);
    const pack = await getCreditPack(data.pack, user);
    if (!pack) {
      return res.status(400).json({ error: "Invalid credit pack" });
    }
    const requested =
      data.gateway === "auto" || !data.gateway ? null : data.gateway;

    let chargeAmount = pack.amount;
    let chargeCurrency = pack.currency;
    if (requested === "mpesa" || requested === "razorpay") {
      const basePack = await getCreditPackBase(data.pack);
      if (basePack) {
        const priced = packAmountForGateway(basePack, requested);
        chargeAmount = priced.amount;
        chargeCurrency = priced.currency;
      }
    }

    const gateway = resolveGateway(requested, user, {
      currency: chargeCurrency,
    });
    const packMeta = {
      packId: pack.id,
      packLabel: pack.label,
      credits: pack.credits,
    };

    const provider = getPaymentProvider(gateway);
    const phone =
      data.phone || user?.phone || user?.business?.whatsapp || null;

    const charge = await provider.createCharge({
      amount: chargeAmount,
      currency: chargeCurrency,
      reference: `credits_${data.pack}_${Date.now()}`.slice(0, 40),
      phone,
      description: "zimji credits",
    });

    const payment = await Payment.create({
      user: req.user.sub,
      gateway: charge.gateway,
      amount: chargeAmount,
      currency: chargeCurrency,
      purpose: "b2b_credits",
      status: charge.status,
      reference: charge.reference,
      providerCheckoutId: charge.providerCheckoutId || null,
      providerInvoiceId: charge.providerInvoiceId || undefined,
      meta: { ...packMeta, ...(charge.meta || {}) },
    });

    // Pending until provider confirms (M-Pesa callback / Razorpay verify).
    if (charge.status !== "paid") {
      scheduleSandboxAutoPaid(payment._id);
      const instructions =
        charge.gateway === "razorpay"
          ? charge.meta?.customerMessage ||
            "Complete payment in the Razorpay window."
          : charge.meta?.customerMessage ||
            "Check your phone and enter your M-Pesa PIN to complete payment.";
      return res.status(200).json({
        error: null,
        payment: serializePayment(payment),
        pending: true,
        instructions,
      });
    }

    const balance = await addCredits(req.user.sub, pack.credits, {
      type: "purchase",
      reference: charge.reference,
      note: `Purchased ${pack.label} pack (${pack.credits} credits)`,
      payment: payment._id,
    });

    capture(req.user.sub, "credits_purchased", {
      pack: pack.id,
      credits: pack.credits,
      amount: pack.amount,
      currency: pack.currency,
      balance,
    });

    const paymentId = payment._id.toString();
    return res.json({
      balance,
      credited: pack.credits,
      payment: serializePayment(payment),
      invoiceUrl: `/api/b2b/credits/payments/${paymentId}/invoice.pdf`,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    if (err.publicMessage) {
      return res.status(err.status || 400).json({ error: err.publicMessage });
    }
    return next(err);
  }
}

export async function downloadCreditInvoice(req, res, next) {
  try {
    const id = objectIdField.parse(req.params.paymentId);
    const payment = await Payment.findOne({
      _id: id,
      user: req.user.sub,
      purpose: "b2b_credits",
      status: "paid",
    });
    if (!payment) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const ctx = await invoiceContextForPayment(payment);
    const pdf = await buildCreditInvoicePdf({
      payment,
      pack: ctx.pack,
      business: ctx.business,
    });

    const fileName = `zimji-invoice-${payment.reference || payment._id}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );
    return res.send(pdf);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}
