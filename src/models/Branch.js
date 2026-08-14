import mongoose from "mongoose";

const { Schema } = mongoose;

const branchSchema = new Schema(
  {
    business: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    address: {
      line1: { type: String, trim: true, default: null },
      city: { type: String, trim: true, default: null },
      country: { type: String, trim: true, default: null },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    phone: { type: String, trim: true, default: null },
    isPrimary: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  { timestamps: true }
);

branchSchema.index({ business: 1, name: 1 });

branchSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    name: this.name,
    address: this.address || {},
    phone: this.phone,
    isPrimary: Boolean(this.isPrimary),
    status: this.status,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const Branch = mongoose.model("Branch", branchSchema);
