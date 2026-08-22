import mongoose from "mongoose";

const { Schema } = mongoose;

// A B2C pay-per-image pack.
const b2cPackSchema = new Schema(
  {
    id: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    images: { type: Number, required: true, min: 1 },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "KES" },
    amountInr: { type: Number, min: 0, default: null },
  },
  { _id: false }
);

// A B2B prepaid credit bundle (1 credit = 1 image).
const creditPackSchema = new Schema(
  {
    id: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    credits: { type: Number, required: true, min: 1 },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "KES" },
    amountInr: { type: Number, min: 0, default: null },
  },
  { _id: false }
);

// Singleton pricing document (one row for the whole platform, keyed "default").
const pricingSchema = new Schema(
  {
    key: { type: String, default: "default", unique: true },
    b2cPacks: { type: [b2cPackSchema], default: [] },
    creditPacks: { type: [creditPackSchema], default: [] },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

pricingSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    b2cPacks: this.b2cPacks.map((p) => ({
      id: p.id,
      label: p.label,
      images: p.images,
      amount: p.amount,
      currency: p.currency,
      amountInr: p.amountInr ?? null,
    })),
    creditPacks: this.creditPacks.map((p) => ({
      id: p.id,
      label: p.label,
      credits: p.credits,
      amount: p.amount,
      currency: p.currency,
      amountInr: p.amountInr ?? null,
    })),
    updatedAt: this.updatedAt,
  };
};

export const Pricing = mongoose.model("Pricing", pricingSchema);
