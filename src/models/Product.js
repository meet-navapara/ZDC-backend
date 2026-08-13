import mongoose from "mongoose";

const { Schema } = mongoose;

export const PRODUCT_STATUSES = ["active", "archived"];

const productSchema = new Schema(
  {
    business: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      default: null,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    sku: { type: String, trim: true, default: null },
    description: { type: String, trim: true, default: null },
    price: { type: Number, default: 0 },
    currency: { type: String, default: "KES" },
    imageUrls: { type: [String], default: [] },
    status: { type: String, enum: PRODUCT_STATUSES, default: "active" },
  },
  { timestamps: true }
);

productSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    category: this.category ? this.category.toString() : null,
    name: this.name,
    sku: this.sku,
    description: this.description,
    price: this.price,
    currency: this.currency,
    imageUrls: this.imageUrls,
    status: this.status,
    createdAt: this.createdAt,
  };
};

export const Product = mongoose.model("Product", productSchema);
