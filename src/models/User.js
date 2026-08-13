import mongoose from "mongoose";

const { Schema } = mongoose;

export const ROLES = ["b2c", "b2b", "admin"];
export const STATUSES = ["active", "pending", "suspended"];
export const BUSINESS_CATEGORIES = ["boutique", "salon", "other"];

// Business profile for B2B accounts. Ignored for b2c/admin users.
const businessSchema = new Schema(
  {
    name: { type: String, trim: true },
    category: { type: String, enum: BUSINESS_CATEGORIES, default: "boutique" },
    logoUrl: { type: String, default: null },
    whatsapp: { type: String, trim: true, default: null },
    address: {
      line1: { type: String, trim: true, default: null },
      city: { type: String, trim: true, default: null },
      country: { type: String, trim: true, default: null },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    // Declared number of locations (registration "Number of Branches").
    // Actual Branch documents are capped by this when set, and by
    // MAX_BRANCHES_PER_BUSINESS otherwise.
    branchCount: { type: Number, min: 1, max: 20, default: 1 },
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    role: { type: String, enum: ROLES, required: true, default: "b2c" },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: { type: String, trim: true },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    passwordHash: { type: String, required: true },
    status: { type: String, enum: STATUSES, default: "active" },
    business: { type: businessSchema, default: undefined },
  },
  { timestamps: true }
);

userSchema.methods.toSafeJSON = function toSafeJSON() {
  const base = {
    id: this._id.toString(),
    role: this.role,
    email: this.email,
    phone: this.phone,
    firstName: this.firstName,
    lastName: this.lastName,
    status: this.status,
    createdAt: this.createdAt,
  };
  if (this.role === "b2b" && this.business) {
    base.business = {
      name: this.business.name,
      category: this.business.category,
      logoUrl: this.business.logoUrl,
      whatsapp: this.business.whatsapp || null,
      address: this.business.address,
      branchCount: this.business.branchCount ?? 1,
    };
  }
  return base;
};

export const User = mongoose.model("User", userSchema);
