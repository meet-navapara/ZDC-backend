import PDFDocument from "pdfkit";
import { User } from "../models/User.js";

/**
 * Build a simple PDF invoice for a paid B2B credit purchase.
 * @returns {Promise<Buffer>}
 */
export function buildCreditInvoicePdf({ payment, pack, business }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const invoiceNo = `INV-${payment.reference || payment._id}`;
    const date = payment.createdAt
      ? new Date(payment.createdAt).toLocaleString("en-KE")
      : new Date().toLocaleString("en-KE");

    doc
      .fontSize(22)
      .fillColor("#2F5D50")
      .text("zimji", { continued: false })
      .fontSize(10)
      .fillColor("#666666")
      .text("Style, Smarter! · Credit Invoice")
      .moveDown(1.5);

    doc
      .fillColor("#111111")
      .fontSize(16)
      .text("TAX INVOICE / RECEIPT")
      .moveDown(0.5);

    doc.fontSize(10).fillColor("#333333");
    doc.text(`Invoice #: ${invoiceNo}`);
    doc.text(`Date: ${date}`);
    doc.text(`Payment status: ${(payment.status || "paid").toUpperCase()}`);
    doc.text(`Gateway: ${payment.gateway || "—"}`);
    doc.moveDown();

    doc.fontSize(11).fillColor("#111111").text("Bill to", { underline: true });
    doc.fontSize(10).fillColor("#333333");
    doc.text(business?.name || "Business account");
    if (business?.email) doc.text(business.email);
    if (business?.phone) doc.text(business.phone);
    const addr = business?.address;
    if (addr) {
      const line = [addr.line1, addr.city, addr.country].filter(Boolean).join(", ");
      if (line) doc.text(line);
    }
    doc.moveDown();

    doc.fontSize(11).fillColor("#111111").text("Items", { underline: true });
    doc.moveDown(0.3);

    const packLabel = pack?.label || payment.meta?.packLabel || "Credit pack";
    const credits = pack?.credits ?? payment.meta?.credits ?? "—";
    const amount = Number(payment.amount || 0).toFixed(2);
    const currency = payment.currency || "KES";

    // Simple table header
    const y = doc.y;
    doc.fontSize(9).fillColor("#666666");
    doc.text("Description", 50, y, { width: 260 });
    doc.text("Credits", 310, y, { width: 80 });
    doc.text("Amount", 400, y, { width: 120, align: "right" });
    doc
      .moveTo(50, y + 14)
      .lineTo(545, y + 14)
      .strokeColor("#cccccc")
      .stroke();

    const rowY = y + 22;
    doc.fontSize(10).fillColor("#111111");
    doc.text(`${packLabel} credit pack`, 50, rowY, { width: 260 });
    doc.text(String(credits), 310, rowY, { width: 80 });
    doc.text(`${currency} ${amount}`, 400, rowY, { width: 120, align: "right" });

    doc.moveDown(3);
    doc.fontSize(12).fillColor("#2F5D50");
    doc.text(`Total paid: ${currency} ${amount}`, { align: "right" });

    doc.moveDown(2);
    doc
      .fontSize(9)
      .fillColor("#888888")
      .text(
        "Thank you for your purchase. 1 credit = 1 try-on render. This document is a receipt for prepaid platform credits.",
        { align: "left", width: 495 }
      );

    doc.end();
  });
}

export async function invoiceContextForPayment(payment) {
  const user = await User.findById(payment.user);
  return {
    business: {
      name: user?.business?.name || null,
      email: user?.email || null,
      phone: user?.phone || null,
      address: user?.business?.address || null,
    },
    pack: payment.meta
      ? {
          label: payment.meta.packLabel,
          credits: payment.meta.credits,
          id: payment.meta.packId,
        }
      : null,
  };
}
