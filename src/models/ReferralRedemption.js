import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Audit trail for B2C referral redemptions (one row per successful signup redeem).
 */
const referralRedemptionSchema = new Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true, index: true },
    referrer: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    referee: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    rewardReferrer: { type: Number, default: 1 },
    rewardReferee: { type: Number, default: 1 },
  },
  { timestamps: true }
);

export const ReferralRedemption = mongoose.model(
  "ReferralRedemption",
  referralRedemptionSchema
);
