import mongoose from "mongoose";

const { Schema } = mongoose;

export const LEDGER_TYPES = ["purchase", "consume", "adjust"];

// Immutable log of every credit movement for a business.
const creditLedgerSchema = new Schema(
  {
    business: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: { type: String, enum: LEDGER_TYPES, required: true },
    // Signed amount: positive for purchase/adjust-up, negative for consume.
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    reference: { type: String, default: null },
    note: { type: String, default: null },
    job: { type: Schema.Types.ObjectId, ref: "TryonJob", default: null },
    payment: { type: Schema.Types.ObjectId, ref: "Payment", default: null },
  },
  { timestamps: true }
);

creditLedgerSchema.index({ payment: 1 }, { unique: true, sparse: true });

creditLedgerSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    type: this.type,
    amount: this.amount,
    balanceAfter: this.balanceAfter,
    reference: this.reference,
    note: this.note,
    job: this.job ? this.job.toString() : null,
    createdAt: this.createdAt,
  };
};

export const CreditLedger = mongoose.model("CreditLedger", creditLedgerSchema);
