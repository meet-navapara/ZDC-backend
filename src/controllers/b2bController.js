import bcrypt from "bcryptjs";
import { z } from "zod";
import { User, BUSINESS_CATEGORIES } from "../models/User.js";
import { Branch } from "../models/Branch.js";
import { signToken } from "../utils/jwt.js";
import { getOrCreateWallet, getBalance } from "../services/credits.js";
import { env } from "../config/env.js";
import { seedPrimaryBranch } from "./branchesController.js";
import {
  emailField,
  passwordField,
  optionalText,
  phoneField,
  urlField,
  boundedText,
  latField,
  lngField,
  LIMITS,
  MAX_BRANCH_COUNT,
} from "../utils/validators.js";

// Lenient address (used for profile updates — any subset may be edited).
const addressSchema = z
  .object({
    line1: optionalText(LIMITS.addressLine),
    city: optionalText(LIMITS.city),
    country: optionalText(LIMITS.country),
    lat: latField.optional(),
    lng: lngField.optional(),
  })
  .optional();

// Strict address (used at registration — all parts are required).
const requiredAddressSchema = z.object({
  line1: boundedText(LIMITS.addressLine, { min: 1 }),
  city: boundedText(LIMITS.city, { min: 1 }),
  country: boundedText(LIMITS.country, { min: 1 }),
  lat: latField.optional(),
  lng: lngField.optional(),
});

// Required phone (registration). Profile updates use the optional phoneField.
const requiredPhoneField = z
  .string()
  .trim()
  .min(1, "Phone is required")
  .max(LIMITS.phone)
  .regex(/^[+\d][\d\s()-]{3,}$/, "Enter a valid phone number");

const branchCountField = z.coerce
  .number()
  .int()
  .min(1, "At least 1 branch")
  .max(MAX_BRANCH_COUNT, `At most ${MAX_BRANCH_COUNT} branches`);

const registerSchema = z.object({
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
    address: requiredAddressSchema,
    branchCount: branchCountField.optional(),
  }),
});

export async function registerBusiness(req, res, next) {
  try {
    const data = registerSchema.parse(req.body);

    const existing = await User.findOne({ email: data.email });
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    // When approval is required, new businesses start as "pending" and can't
    // operate until a Super Admin approves them.
    const status = env.b2bAutoApprove ? "active" : "pending";
    const branchCount = data.business.branchCount ?? 1;
    const user = await User.create({
      role: "b2b",
      email: data.email,
      passwordHash,
      status,
      phone: data.phone,
      firstName: data.firstName,
      lastName: data.lastName,
      business: {
        name: data.business.name,
        category: data.business.category || "boutique",
        logoUrl: data.business.logoUrl || null,
        whatsapp: data.business.whatsapp || null,
        address: data.business.address || {},
        branchCount,
      },
    });

    // Provision an empty credit wallet up front.
    await getOrCreateWallet(user._id);
    // Seed the HQ / primary branch from the registration address.
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
    return next(err);
  }
}

const updateProfileSchema = z.object({
  phone: phoneField,
  firstName: optionalText(LIMITS.name),
  lastName: optionalText(LIMITS.name),
  business: z
    .object({
      name: boundedText(LIMITS.businessName, { min: 1 }).optional(),
      category: z.enum(BUSINESS_CATEGORIES).optional(),
      logoUrl: urlField,
      whatsapp: phoneField,
      address: addressSchema,
      branchCount: branchCountField.optional(),
    })
    .optional(),
});

export async function getProfile(req, res, next) {
  try {
    const user = await User.findById(req.user.sub);
    if (!user) return res.status(404).json({ error: "User not found" });
    const balance = await getBalance(user._id);
    return res.json({ user: user.toSafeJSON(), credits: balance });
  } catch (err) {
    return next(err);
  }
}

export async function updateProfile(req, res, next) {
  try {
    const data = updateProfileSchema.parse(req.body);
    const user = await User.findById(req.user.sub);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (data.phone !== undefined) user.phone = data.phone;
    if (data.firstName !== undefined) user.firstName = data.firstName;
    if (data.lastName !== undefined) user.lastName = data.lastName;

    if (data.business) {
      user.business = user.business || {};
      const b = data.business;
      if (b.name !== undefined) user.business.name = b.name;
      if (b.category !== undefined) user.business.category = b.category;
      if (b.logoUrl !== undefined) user.business.logoUrl = b.logoUrl || null;
      if (b.whatsapp !== undefined) user.business.whatsapp = b.whatsapp || null;
      if (b.address) {
        user.business.address = { ...user.business.address, ...b.address };
      }
      if (b.branchCount !== undefined) {
        // Don't allow lowering below how many branches already exist.
        const existing = await Branch.countDocuments({ business: user._id });
        if (b.branchCount < existing) {
          return res.status(400).json({
            error: `You already have ${existing} branch${existing === 1 ? "" : "es"}. Remove some before lowering the limit to ${b.branchCount}.`,
          });
        }
        user.business.branchCount = b.branchCount;
      }
    }

    await user.save();
    return res.json({ user: user.toSafeJSON() });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}
