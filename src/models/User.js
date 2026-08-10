import mongoose from "mongoose";

const { Schema } = mongoose;

export const ROLES = ["b2c", "b2b", "admin"];
export const STATUSES = ["active", "pending", "suspended"];

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
  },
  { timestamps: true }
);

userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    role: this.role,
    email: this.email,
    phone: this.phone,
    firstName: this.firstName,
    lastName: this.lastName,
    status: this.status,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model("User", userSchema);
