import mongoose from "mongoose";

const { Schema } = mongoose;

// One wallet per B2B business (keyed by the owner User id).
const creditWalletSchema = new Schema(
  {
    business: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    balance: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true }
);

creditWalletSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    business: this.business.toString(),
    balance: this.balance,
    updatedAt: this.updatedAt,
  };
};

export const CreditWallet = mongoose.model("CreditWallet", creditWalletSchema);
