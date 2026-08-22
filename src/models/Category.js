import mongoose from "mongoose";

const { Schema } = mongoose;

export const MAX_CATEGORIES_PER_BUSINESS = 10;
export const TRY_ON_FEATURE_VALUES = ["cloth", "hair", "haircolor", "beard"];

const categorySchema = new Schema(
  {
    business: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: null },
    order: { type: Number, default: 0 },
    /** Which Perfect Corp try-on API runs for products in this category (B2B). */
    tryOnFeature: {
      type: String,
      enum: TRY_ON_FEATURE_VALUES,
      default: "cloth",
    },
    /** Perfect Corp preset when tryOnFeature is haircolor */
    hairColorPreset: { type: String, default: null },
    /** Perfect Corp template_id when tryOnFeature is beard */
    beardTemplateId: { type: String, default: null },
  },
  { timestamps: true }
);

categorySchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    name: this.name,
    description: this.description,
    order: this.order,
    tryOnFeature: this.tryOnFeature || "cloth",
    hairColorPreset: this.hairColorPreset || null,
    beardTemplateId: this.beardTemplateId || null,
    createdAt: this.createdAt,
  };
};

export const Category = mongoose.model("Category", categorySchema);
