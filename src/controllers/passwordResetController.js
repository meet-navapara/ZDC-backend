import bcrypt from "bcryptjs";
import { z } from "zod";
import { User } from "../models/User.js";
import { issueSignupOtp, consumeSignupOtp } from "../services/otp.js";
import { sendPasswordResetEmail } from "../services/mail.js";
import { env } from "../config/env.js";
import { emailField, passwordField } from "../utils/validators.js";

const requestSchema = z.object({
  email: emailField,
});

const resetSchema = z.object({
  email: emailField,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code from your email"),
  password: passwordField,
});

/** Request a password-reset code (always returns generic success). */
export async function requestPasswordReset(req, res, next) {
  try {
    const { email } = requestSchema.parse(req.body);
    const user = await User.findOne({ email });

    let mockOtp = null;
    if (user && user.role !== "admin") {
      const challenge = await issueSignupOtp({
        email,
        purpose: "password_reset",
        payload: { userId: user._id.toString() },
        onSend: (code) => sendPasswordResetEmail(email, code),
      });
      mockOtp = challenge.devOtp || challenge.mockOtp || null;
    }

    const body = {
      ok: true,
      message: "If an account exists for that email, a reset code has been sent.",
    };
    if (env.otpMock && mockOtp) {
      body.mock = true;
      body.devOtp = mockOtp;
      body.mockOtp = mockOtp;
    }
    return res.json(body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}

/** Verify reset code and set a new password. */
export async function resetPasswordWithCode(req, res, next) {
  try {
    const data = resetSchema.parse(req.body);
    const payload = await consumeSignupOtp({
      email: data.email,
      purpose: "password_reset",
      code: data.code,
    });

    const user = await User.findById(payload.userId);
    if (!user) {
      return res.status(400).json({ error: "Account not found" });
    }
    if (user.email !== data.email) {
      return res.status(400).json({ error: "Invalid reset request" });
    }
    if (user.role === "admin") {
      return res.status(403).json({ error: "Contact support to reset admin passwords" });
    }

    user.passwordHash = await bcrypt.hash(data.password, 10);
    await user.save();

    return res.json({ ok: true, message: "Password updated. You can log in now." });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    if (err.status === 400 || err.status === 429) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
}
