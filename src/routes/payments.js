import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  payForJob,
  listMyPayments,
  listPaymentMethods,
  getPayment,
  cancelPayment,
} from "../controllers/paymentsController.js";
import { mpesaStkCallback } from "../controllers/mpesaController.js";
import {
  razorpayVerify,
  razorpayWebhook,
} from "../controllers/razorpayController.js";

const router = Router();

// Provider callbacks / webhooks — public (no JWT).
router.post("/mpesa/callback", mpesaStkCallback);
router.post("/razorpay/webhook", razorpayWebhook);

router.post("/razorpay/verify", requireAuth, razorpayVerify);
router.get("/methods", requireAuth, listPaymentMethods);
router.get("/mine", requireAuth, listMyPayments);
router.get("/:id", requireAuth, getPayment);
router.post("/:id/cancel", requireAuth, cancelPayment);
router.post("/", requireAuth, payForJob);

export default router;
