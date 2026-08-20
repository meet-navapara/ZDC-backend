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
    // Optional external invoice id from a former provider; unique when set.
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
  try {
    await col.dropIndex("providerInvoiceId_1");
  } catch (err) {
    if (err?.code !== 27 && err?.codeName !== "IndexNotFound") {
      console.warn("[db] dropIndex providerInvoiceId_1:", err.message);
    }
  }
  await Payment.syncIndexes();
}
