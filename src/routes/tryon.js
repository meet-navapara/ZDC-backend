import { Router } from "express";
import { upload } from "../middleware/upload.js";
import { optionalAuth } from "../middleware/auth.js";
import {
  createJob,
  getJob,
  listPricing,
} from "../controllers/tryonController.js";

const router = Router();

router.get("/pricing", listPricing);

router.post(
  "/",
  optionalAuth,
  upload.fields([
    { name: "source", maxCount: 1 },
    { name: "target", maxCount: 5 },
  ]),
  createJob
);

router.get("/:id", getJob);

export default router;
