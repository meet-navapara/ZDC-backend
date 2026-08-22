import mongoose from "mongoose";

const { Schema } = mongoose;

export const JOB_STATUSES = [
  "awaiting_payment",
  "processing",
  "completed",
  "failed",
];

const tryonJobSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    channel: { type: String, enum: ["b2c", "b2b"], default: "b2c" },
    // B2C uses a paid pack; B2B consumes credits (pack is null).
    pack: { type: String, default: null },
    imageCount: { type: Number, required: true },
    amount: { type: Number, required: true, default: 0 },
    currency: { type: String, default: "KES" },
    // B2B credit cost (0 for B2C jobs).
    creditsCost: { type: Number, default: 0 },
    // For B2B, the product whose image was used as the try-on target.
    product: { type: Schema.Types.ObjectId, ref: "Product", default: null },
    sourceImageUrl: { type: String, required: true },
    // Primary target (first uploaded outfit / product image). Kept for
    // backward compatibility and single-image (B2B) jobs.
    targetImageUrl: { type: String, required: true },
    // All target images. For B2C multi-image packs (e.g. Trio) the customer
    // uploads one outfit per rendered image.
    targetImageUrls: { type: [String], default: [] },
    resultImageUrls: { type: [String], default: [] },
    status: { type: String, enum: JOB_STATUSES, default: "awaiting_payment" },
    payment: { type: Schema.Types.ObjectId, ref: "Payment", default: null },
    perfectcorpRef: { type: String, default: null },
    /** cloth | hair | haircolor | beard — overrides env PERFECTCORP_FEATURE */
    perfectcorpFeature: { type: String, default: null },
    perfectcorpPreset: { type: String, default: null },
    perfectcorpTemplateId: { type: String, default: null },
    deliverTo: {
      email: { type: String, default: null },
      whatsapp: { type: String, default: null },
    },
    error: { type: String, default: null },
  },
  { timestamps: true }
);

// Auto-delete documents 72 hours after creation to manage storage.
tryonJobSchema.index({ createdAt: 1 }, { expireAfterSeconds: 72 * 60 * 60 });

tryonJobSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    channel: this.channel,
    pack: this.pack,
    imageCount: this.imageCount,
    amount: this.amount,
    currency: this.currency,
    creditsCost: this.creditsCost,
    product: this.product ? this.product.toString() : null,
    sourceImageUrl: this.sourceImageUrl,
    targetImageUrl: this.targetImageUrl,
    targetImageUrls:
      this.targetImageUrls && this.targetImageUrls.length
        ? this.targetImageUrls
        : this.targetImageUrl
        ? [this.targetImageUrl]
        : [],
    resultImageUrls: this.resultImageUrls,
    status: this.status,
    error: this.error || null,
    createdAt: this.createdAt,
  };
};

export const TryonJob = mongoose.model("TryonJob", tryonJobSchema);
