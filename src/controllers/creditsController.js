import { z } from "zod";
import { getCreditPacks, getCreditPack } from "../services/pricing.js";
import { Payment } from "../models/Payment.js";
import { getPaymentProvider, resolveGateway, CHECKOUT_REUSE_MS } from "../services/payments.js";
import { addCredits, getBalance, listLedger } from "../services/credits.js";
import { capture } from "../services/analytics.js";
import { buildCreditInvoicePdf, invoiceContextForPayment } from "../services/invoice.js";
import { objectIdField, slugField } from "../utils/validators.js";
import {
  serializePayment,
  customerForUser,
  startIntasendCheckout,
} from "./paymentsController.js";

export async function listCreditPacks(req, res, next) {
  try {
    const packs = await getCreditPacks();
    return res.json({ packs });
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
    const entries = await listLedger(req.user.sub, { limit });
    return res.json({ ledger: entries });
  } catch (err) {
    return next(err);
  }
}

const purchaseSchema = z.object({
  pack: slugField,
  gateway: z.enum(["stub", "mpesa", "intasend"]).optional(),
});

export async function purchaseCredits(req, res, next) {
  try {
    const data = purchaseSchema.parse(req.body);
    const pack = await getCreditPack(data.pack);
    if (!pack) {
      return res.status(400).json({ error: "Invalid credit pack" });
    }

    const gateway = resolveGateway(data.gateway);
    const packMeta = {
      packId: pack.id,
      packLabel: pack.label,
      credits: pack.credits,
    };

    if (gateway === "intasend") {
      const reuseAfter = new Date(Date.now() - CHECKOUT_REUSE_MS);
      const existing = await Payment.findOne({
        user: req.user.sub,
        purpose: "b2b_credits",
        gateway: "intasend",
        status: "pending",
        createdAt: { $gte: reuseAfter },
        checkoutUrl: { $ne: null },
        "meta.packId": pack.id,
      }).sort({ createdAt: -1 });
      if (existing) {
        return res.json({
          payment: serializePayment(existing),
          checkoutUrl: existing.checkoutUrl,
          credited: 0,
          balance: await getBalance(req.user.sub),
        });
      }

      let payment = await Payment.create({
        user: req.user.sub,
        gateway: "intasend",
        amount: pack.amount,
        currency: pack.currency,
        purpose: "b2b_credits",
        status: "pending",
        meta: packMeta,
      });
      try {
        payment = await startIntasendCheckout(
          payment,
          await customerForUser(req.user.sub),
          `zimji ${pack.label} credits`
        );
      } catch (err) {
        payment.status = "failed";
        payment.failureReason = err.publicMessage || err.message;
        await payment.save().catch(() => {});
        throw err;
      }

      return res.json({
        payment: serializePayment(payment),
        checkoutUrl: payment.checkoutUrl,
        credited: 0,
        balance: await getBalance(req.user.sub),
      });
    }

    const provider = getPaymentProvider(gateway);
    const charge = await provider.createCharge({
      amount: pack.amount,
      currency: pack.currency,
      reference: `credits_${data.pack}_${Date.now()}`,
    });

    const payment = await Payment.create({
      user: req.user.sub,
      gateway: charge.gateway,
      amount: pack.amount,
      currency: pack.currency,
      purpose: "b2b_credits",
      status: charge.status,
      reference: charge.reference,
      meta: packMeta,
    });

    if (charge.status !== "paid") {
      return res.status(402).json({
        error: "Payment not completed",
        payment: serializePayment(payment),
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
