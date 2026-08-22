import mongoose from "mongoose";

const { Schema } = mongoose;

export const OTP_PURPOSES = ["signup_b2c", "signup_b2b", "password_reset"];

const emailOtpSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    purpose: {
      type: String,
      enum: OTP_PURPOSES,
      required: true,
    },
    codeHash: { type: String, required: true },
    // Serialized signup fields (password already hashed).
    payload: { type: Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);

emailOtpSchema.index({ email: 1, purpose: 1 });
// Auto-clean expired challenges
emailOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const EmailOtp = mongoose.model("EmailOtp", emailOtpSchema);
