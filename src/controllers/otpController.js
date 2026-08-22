import { z } from "zod";
import bcrypt from "bcryptjs";
import { User, BUSINESS_CATEGORIES } from "../models/User.js";
import { signToken } from "../utils/jwt.js";
import { getOrCreateWallet } from "../services/credits.js";
import { env } from "../config/env.js";
import { seedPrimaryBranch } from "./branchesController.js";
import { issueSignupOtp, consumeSignupOtp } from "../services/otp.js";
import {
  ensureReferralCode,
  normalizeReferralCode,
  redeemReferralOnSignup,
} from "../services/referral.js";
import {
  emailField,
  passwordField,
  optionalText,
  phoneField,
  urlField,
  boundedText,
  latField,
  lngField,
  currencyField,
  LIMITS,
} from "../utils/validators.js";

const requiredAddressSchema = z.object({
  line1: boundedText(LIMITS.addressLine, { min: 1 }),
  city: boundedText(LIMITS.city, { min: 1 }),
  country: boundedText(LIMITS.country, { min: 1 }),
  lat: latField.optional(),
  lng: lngField.optional(),
});

const requiredPhoneField = z
  .string()
  .trim()
  .min(1, "Phone is required")
  .max(LIMITS.phone)
  .regex(/^[+\d][\d\s()-]{3,}$/, "Enter a valid phone number");

const b2cRequestSchema = z.object({
  email: emailField,
  password: passwordField,
  firstName: optionalText(LIMITS.name),
  lastName: optionalText(LIMITS.name),
  phone: phoneField,
  country: optionalText(LIMITS.country),
  currency: currencyField.optional().or(z.literal("")),
  referralCode: z
    .string()
    .trim()
    .max(16)
    .optional()
    .or(z.literal("")),
});

const b2bRequestSchema = z.object({
  email: emailField,
  password: passwordField,
  phone: requiredPhoneField,
  firstName: optionalText(LIMITS.name),
  lastName: optionalText(LIMITS.name),
  business: z.object({
    name: boundedText(LIMITS.businessName, { min: 1 }),
    category: z.enum(BUSINESS_CATEGORIES).optional(),
    logoUrl: urlField,
    whatsapp: requiredPhoneField,
    currency: currencyField.optional(),
    address: requiredAddressSchema,
  }),
});

const verifySchema = z.object({
  email: emailField,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code from your email"),
});

async function assertEmailAvailable(email) {
  const existing = await User.findOne({ email });
  if (existing) {
    const err = new Error("Email already registered");
    err.status = 409;
    throw err;
  }
}

export async function requestB2cSignupOtp(req, res, next) {
  try {
    const data = b2cRequestSchema.parse(req.body);
    await assertEmailAvailable(data.email);

    const passwordHash = await bcrypt.hash(data.password, 10);
    const referralCode = normalizeReferralCode(data.referralCode || "");
    const challenge = await issueSignupOtp({
      email: data.email,
      purpose: "signup_b2c",
      payload: {
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        country: data.country,
        currency: data.currency,
        role: "b2c",
        referralCode: referralCode || null,
      },
    });

    return res.json({
      ok: true,
      message: challenge.mock
        ? `Mock OTP ready — use code ${challenge.mockOtp || challenge.devOtp}.`
        : challenge.mailConfigured
          ? "Verification code sent to your email."
          : "Verification code ready (check server logs if email is not configured).",
      ...challenge,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
}

export async function verifyB2cSignupOtp(req, res, next) {
  try {
    const data = verifySchema.parse(req.body);
    await assertEmailAvailable(data.email);

    const payload = await consumeSignupOtp({
      email: data.email,
      purpose: "signup_b2c",
      code: data.code,
    });

    const user = await User.create({
      email: payload.email,
      passwordHash: payload.passwordHash,
      role: "b2c",
      firstName: payload.firstName,
      lastName: payload.lastName,
      phone: payload.phone,
      country: payload.country || null,
      currency: payload.currency || null,
      emailVerified: true,
      status: "active",
      freeTryons: 0,
    });

    await ensureReferralCode(user);

    let referral = { redeemed: false };
    if (payload.referralCode) {
      referral = await redeemReferralOnSignup(user, payload.referralCode);
    }

    const fresh = await User.findById(user._id);
    const token = signToken({ sub: user._id.toString(), role: user.role });
    return res.status(201).json({
      token,
      user: fresh.toSafeJSON(),
      referral,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err?.code === 11000) {
      return res.status(409).json({ error: "Email already registered" });
    }
    return next(err);
  }
}

export async function requestB2bSignupOtp(req, res, next) {
  try {
    const data = b2bRequestSchema.parse(req.body);
    await assertEmailAvailable(data.email);

    const passwordHash = await bcrypt.hash(data.password, 10);
    const challenge = await issueSignupOtp({
      email: data.email,
      purpose: "signup_b2b",
      payload: {
        email: data.email,
        passwordHash,
        phone: data.phone,
        firstName: data.firstName,
        lastName: data.lastName,
        business: data.business,
      },
    });

    return res.json({
      ok: true,
      message: challenge.mock
        ? `Mock OTP ready — use code ${challenge.mockOtp || challenge.devOtp}.`
        : challenge.mailConfigured
          ? "Verification code sent to your email."
          : "Verification code ready (check server logs if email is not configured).",
      ...challenge,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
}

export async function verifyB2bSignupOtp(req, res, next) {
  try {
    const data = verifySchema.parse(req.body);
    await assertEmailAvailable(data.email);

    const payload = await consumeSignupOtp({
      email: data.email,
      purpose: "signup_b2b",
      code: data.code,
    });

    const status = env.b2bAutoApprove ? "active" : "pending";
    const user = await User.create({
      role: "b2b",
      email: payload.email,
      passwordHash: payload.passwordHash,
      status,
      phone: payload.phone,
      firstName: payload.firstName,
      lastName: payload.lastName,
      emailVerified: true,
      business: {
        name: payload.business.name,
        category: payload.business.category || "boutique",
        logoUrl: payload.business.logoUrl || null,
        whatsapp: payload.business.whatsapp || null,
        currency: payload.business.currency || "KES",
        address: payload.business.address || {},
      },
    });

    await getOrCreateWallet(user._id);
    await seedPrimaryBranch(user);

    const token = signToken({ sub: user._id.toString(), role: user.role });
    return res.status(201).json({
      token,
      user: user.toSafeJSON(),
      pendingApproval: status === "pending",
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err?.code === 11000) {
      return res.status(409).json({ error: "Email already registered" });
    }
    return next(err);
  }
}
