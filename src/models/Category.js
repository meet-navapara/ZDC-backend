import mongoose from "mongoose";

const { Schema } = mongoose;

export const MAX_CATEGORIES_PER_BUSINESS = 10;

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
  },
  { timestamps: true }
);

categorySchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    name: this.name,
    description: this.description,
    order: this.order,
    createdAt: this.createdAt,
  };
};

export const Category = mongoose.model("Category", categorySchema);
