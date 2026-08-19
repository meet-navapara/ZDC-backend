import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  payForJob,
  listMyPayments,
  listPaymentMethods,
  getPayment,
  cancelPayment,
  intasendWebhook,
} from "../controllers/paymentsController.js";

const router = Router();

router.post("/intasend/webhook", intasendWebhook);
router.get("/methods", requireAuth, listPaymentMethods);
router.get("/mine", requireAuth, listMyPayments);
router.get("/:id", requireAuth, getPayment);
router.post("/:id/cancel", requireAuth, cancelPayment);
router.post("/", requireAuth, payForJob);

export default router;
