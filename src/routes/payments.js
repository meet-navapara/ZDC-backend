import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { payForJob, listMyPayments } from "../controllers/paymentsController.js";

const router = Router();

router.get("/mine", requireAuth, listMyPayments);
router.post("/", requireAuth, payForJob);

export default router;
