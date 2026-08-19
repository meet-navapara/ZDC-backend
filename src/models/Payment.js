import mongoose from "mongoose";

const { Schema } = mongoose;

export const PAYMENT_STATUSES = ["pending", "paid", "failed", "cancelled", "refunded"];

const paymentSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    job: { type: Schema.Types.ObjectId, ref: "TryonJob", default: null },
    gateway: { type: String, default: "stub" },
    amount: { type: Number, required: true },
    currency: { type: String, default: "KES" },
    purpose: { type: String, default: "b2c_tryon" },
    status: { type: String, enum: PAYMENT_STATUSES, default: "pending" },
    reference: { type: String, default: null },
    // Omit until IntaSend returns an invoice_id. Unique+sparse still indexes
    // explicit null, so a second unpaid checkout used to 500 with E11000.
    providerInvoiceId: { type: String },
    providerCheckoutId: { type: String, default: null },
    checkoutUrl: { type: String, default: null },
    failureReason: { type: String, default: null },
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

paymentSchema.index(
  { providerInvoiceId: 1 },
  {
    unique: true,
    name: "providerInvoiceId_unique",
    partialFilterExpression: { providerInvoiceId: { $type: "string" } },
  }
);
paymentSchema.index({ user: 1, createdAt: -1 });
paymentSchema.index({ job: 1, status: 1 });

export const Payment = mongoose.model("Payment", paymentSchema);

/** Drop the old sparse unique index and clear stored nulls so unpaid checkouts can be created. */
export async function repairPaymentInvoiceIndex() {
  const col = Payment.collection;
  const cleared = await col.updateMany(
    { $or: [{ providerInvoiceId: null }, { providerInvoiceId: "" }] },
    { $unset: { providerInvoiceId: "" } }
  );
  if (cleared.modifiedCount) {
    console.log(`[db] unset empty providerInvoiceId on ${cleared.modifiedCount} payment(s)`);
  }
  try {
    await col.dropIndex("providerInvoiceId_1");
    console.log("[db] dropped unique sparse index providerInvoiceId_1");
  } catch (err) {
    if (err?.code !== 27 && err?.codeName !== "IndexNotFound") {
      console.warn("[db] dropIndex providerInvoiceId_1:", err.message);
    }
  }
  await Payment.syncIndexes();
}
