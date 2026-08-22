import bcrypt from "bcryptjs";
import { z } from "zod";
import { User } from "../models/User.js";
import { signToken } from "../utils/jwt.js";
import { ensureReferralCode, getReferralStats } from "../services/referral.js";
import {
  emailField,
  passwordField,
  loginPasswordField,
  optionalText,
  phoneField,
  currencyField,
  LIMITS,
} from "../utils/validators.js";

const registerSchema = z.object({
  email: emailField,
  password: passwordField,
  // Public register never accepts admin — use scripts/create-admin.mjs instead.
  role: z.enum(["b2c", "b2b"]).optional(),
  firstName: optionalText(LIMITS.name),
  lastName: optionalText(LIMITS.name),
  phone: phoneField,
});

const loginSchema = z.object({
  email: emailField,
  password: loginPasswordField,
  // Which login screen this request came from. Admins may only use "admin".
  portal: z.enum(["b2c", "b2b", "admin", "app"]).optional(),
});

export async function register(req, res, next) {
  try {
    const data = registerSchema.parse(req.body);

    const existing = await User.findOne({ email: data.email });
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await User.create({
      email: data.email,
      passwordHash,
      role: data.role || "b2c",
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
    });

    const token = signToken({ sub: user._id.toString(), role: user.role });
    return res.status(201).json({ token, user: user.toSafeJSON() });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}

export async function login(req, res, next) {
  try {
    const data = loginSchema.parse(req.body);

    const user = await User.findOne({ email: data.email });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(data.password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.status === "suspended") {
      return res.status(403).json({ error: "Account suspended" });
    }

    const portal = data.portal || "app";
    const allowed =
      (portal === "admin" && user.role === "admin") ||
      (portal === "app" && (user.role === "b2c" || user.role === "b2b")) ||
      (portal === "b2b" && user.role === "b2b") ||
      (portal === "b2c" && user.role === "b2c");
    if (!allowed) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = signToken({ sub: user._id.toString(), role: user.role });
    return res.json({ token, user: user.toSafeJSON() });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}

export async function me(req, res, next) {
  try {
    const user = await User.findById(req.user.sub);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    if (user.role === "b2c") {
      await ensureReferralCode(user);
    }
    return res.json({ user: user.toSafeJSON() });
  } catch (err) {
    return next(err);
  }
}

export async function getMyReferral(req, res, next) {
  try {
    const stats = await getReferralStats(req.user.sub);
    if (!stats) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.json({ referral: stats });
  } catch (err) {
    return next(err);
  }
}

const updateMeSchema = z.object({
  firstName: optionalText(LIMITS.name),
  lastName: optionalText(LIMITS.name),
  phone: phoneField,
  country: optionalText(LIMITS.country),
  currency: currencyField.optional().or(z.literal("")),
  currentPassword: loginPasswordField.optional().or(z.literal("")),
  newPassword: passwordField.optional().or(z.literal("")),
});

/** Update the signed-in user's personal profile (B2C and others). */
export async function updateMe(req, res, next) {
  try {
    const data = updateMeSchema.parse(req.body);
    const user = await User.findById(req.user.sub);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (data.firstName !== undefined) user.firstName = data.firstName || null;
    if (data.lastName !== undefined) user.lastName = data.lastName || null;
    if (data.phone !== undefined) user.phone = data.phone || null;
    if (user.role === "b2c") {
      if (data.country !== undefined) user.country = data.country || null;
      if (data.currency !== undefined) {
        user.currency = data.currency ? String(data.currency).toUpperCase() : null;
      }
    }

    if (data.newPassword) {
      if (!data.currentPassword) {
        return res.status(400).json({ error: "Current password is required" });
      }
      const ok = await bcrypt.compare(data.currentPassword, user.passwordHash);
      if (!ok) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }
      user.passwordHash = await bcrypt.hash(data.newPassword, 10);
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
