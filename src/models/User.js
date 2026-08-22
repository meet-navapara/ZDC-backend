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
    // Billing currency chosen at signup (drives pack pricing display / payouts).
    currency: { type: String, trim: true, uppercase: true, default: "KES" },
    address: {
      line1: { type: String, trim: true, default: null },
      city: { type: String, trim: true, default: null },
      country: { type: String, trim: true, default: null },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    // Kept for legacy profiles; branches are no longer capped by this field.
    branchCount: { type: Number, min: 1, default: 1 },
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
    // B2C billing market (B2B uses business.currency / business.address.country).
    country: { type: String, trim: true, default: null },
    currency: { type: String, trim: true, uppercase: true, default: null },
    passwordHash: { type: String, required: true },
    status: { type: String, enum: STATUSES, default: "active" },
    emailVerified: { type: Boolean, default: false },
    business: { type: businessSchema, default: undefined },
    // B2C referral program
    referralCode: {
      type: String,
      uppercase: true,
      trim: true,
      sparse: true,
      unique: true,
    },
    referredBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** Free try-on renders earned via referrals (1 = one styled image job). */
    freeTryons: { type: Number, min: 0, default: 0 },
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
    emailVerified: Boolean(this.emailVerified),
    createdAt: this.createdAt,
  };
  if (this.role === "b2c") {
    base.country = this.country || null;
    base.currency = this.currency || null;
    base.referralCode = this.referralCode || null;
    base.freeTryons = this.freeTryons || 0;
    base.referredBy = this.referredBy ? String(this.referredBy) : null;
  }
  if (this.role === "b2b" && this.business) {
    base.business = {
      name: this.business.name,
      category: this.business.category,
      logoUrl: this.business.logoUrl,
      whatsapp: this.business.whatsapp || null,
      currency: this.business.currency || "KES",
      address: this.business.address,
      branchCount: this.business.branchCount ?? 1,
    };
  }
  return base;
};

export const User = mongoose.model("User", userSchema);
