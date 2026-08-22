import { Router } from "express";
import { register, login, me, updateMe, getMyReferral } from "../controllers/authController.js";
import {
  requestB2cSignupOtp,
  verifyB2cSignupOtp,
} from "../controllers/otpController.js";
import {
  requestPasswordReset,
  resetPasswordWithCode,
} from "../controllers/passwordResetController.js";
import { requireAuth } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimit.js";

const router = Router();

router.post("/register/otp/request", authLimiter, requestB2cSignupOtp);
router.post("/register/otp/verify", authLimiter, verifyB2cSignupOtp);
router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.post("/forgot-password", authLimiter, requestPasswordReset);
router.post("/reset-password", authLimiter, resetPasswordWithCode);
router.get("/me", requireAuth, me);
router.patch("/me", requireAuth, updateMe);
router.get("/referral", requireAuth, getMyReferral);

export default router;
