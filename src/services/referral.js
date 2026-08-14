import { User } from "../models/User.js";
import { ReferralRedemption } from "../models/ReferralRedemption.js";

/** Free try-on images granted to each side on a successful referral. */
export const REFERRAL_REWARD_REFERRER = 1;
export const REFERRAL_REWARD_REFEREE = 1;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(len = 8) {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** Normalize user-entered referral codes. */
export function normalizeReferralCode(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
}

/** Assign a unique referral code to a user (idempotent). */
export async function ensureReferralCode(user) {
  if (user.referralCode) return user.referralCode;

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode(8);
    try {
      user.referralCode = code;
      await user.save();
      return code;
    } catch (err) {
      if (err?.code === 11000) {
        user.referralCode = undefined;
        continue;
      }
      throw err;
    }
  }
  throw new Error("Could not allocate referral code");
}

/**
 * Look up a referrer by code. Returns null if missing / inactive / not b2c.
 */
export async function findReferrerByCode(rawCode) {
  const code = normalizeReferralCode(rawCode);
  if (!code) return null;
  const referrer = await User.findOne({
    referralCode: code,
    role: "b2c",
    status: "active",
  });
  return referrer || null;
}

/**
 * After a new B2C user is created: if they provided a valid code, link them
 * and grant free try-ons to both parties. Invalid/self codes are ignored
 * (signup still succeeds).
 *
 * @returns {{ redeemed: boolean, referrerId?: string, rewardReferee?: number, rewardReferrer?: number, message?: string }}
 */
export async function redeemReferralOnSignup(newUser, rawCode) {
  const code = normalizeReferralCode(rawCode);
  if (!code) {
    return { redeemed: false, message: "No referral code provided" };
  }

  const referrer = await findReferrerByCode(code);
  if (!referrer) {
    return { redeemed: false, message: "Invalid referral code" };
  }
  if (String(referrer._id) === String(newUser._id)) {
    return { redeemed: false, message: "Cannot use your own code" };
  }

  // Already referred?
  if (newUser.referredBy) {
    return { redeemed: false, message: "Already referred" };
  }

  const existing = await ReferralRedemption.findOne({ referee: newUser._id });
  if (existing) {
    return { redeemed: false, message: "Already redeemed" };
  }

  newUser.referredBy = referrer._id;
  newUser.freeTryons = (newUser.freeTryons || 0) + REFERRAL_REWARD_REFEREE;
  await newUser.save();

  await User.updateOne(
    { _id: referrer._id },
    { $inc: { freeTryons: REFERRAL_REWARD_REFERRER } }
  );

  await ReferralRedemption.create({
    code,
    referrer: referrer._id,
    referee: newUser._id,
    rewardReferrer: REFERRAL_REWARD_REFERRER,
    rewardReferee: REFERRAL_REWARD_REFEREE,
  });

  return {
    redeemed: true,
    referrerId: String(referrer._id),
    rewardReferee: REFERRAL_REWARD_REFEREE,
    rewardReferrer: REFERRAL_REWARD_REFERRER,
  };
}

/** Atomically consume one free try-on. Returns new balance or null if none. */
export async function consumeFreeTryon(userId) {
  const user = await User.findOneAndUpdate(
    { _id: userId, freeTryons: { $gte: 1 } },
    { $inc: { freeTryons: -1 } },
    { new: true }
  );
  return user ? user.freeTryons : null;
}

export async function getReferralStats(userId) {
  const user = await User.findById(userId).select(
    "referralCode freeTryons referredBy role"
  );
  if (!user) return null;

  await ensureReferralCode(user);

  const [invites, redemption] = await Promise.all([
    ReferralRedemption.countDocuments({ referrer: userId }),
    user.referredBy
      ? ReferralRedemption.findOne({ referee: userId }).lean()
      : null,
  ]);

  return {
    referralCode: user.referralCode,
    freeTryons: user.freeTryons || 0,
    invites,
    rewardPerInvite: REFERRAL_REWARD_REFERRER,
    rewardOnJoin: REFERRAL_REWARD_REFEREE,
    wasReferred: Boolean(user.referredBy),
    referredAt: redemption?.createdAt || null,
  };
}
