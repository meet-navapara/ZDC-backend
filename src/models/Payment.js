import mongoose from "mongoose";

const { Schema } = mongoose;

export const PAYMENT_STATUSES = ["pending", "paid", "failed"];

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
    // Extra purchase details for invoices (pack label, credits, etc.).
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

export const Payment = mongoose.model("Payment", paymentSchema);
