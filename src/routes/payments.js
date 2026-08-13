import { Router } from "express";
import { optionalAuth } from "../middleware/auth.js";
import { payForJob } from "../controllers/paymentsController.js";

const router = Router();

router.post("/", optionalAuth, payForJob);

export default router;
