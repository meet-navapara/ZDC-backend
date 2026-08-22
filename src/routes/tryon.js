import { Router } from "express";
import { upload } from "../middleware/upload.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import {
  createJob,
  getJob,
  listPricing,
  listMyJobs,
  getMyStats,
  listPerfectCorpOptions,
  proxyPerfectCorpThumbnail,
} from "../controllers/tryonController.js";

const router = Router();

router.get("/pricing", optionalAuth, listPricing);
router.get("/perfectcorp/options", listPerfectCorpOptions);
router.get("/perfectcorp/thumbnail", proxyPerfectCorpThumbnail);

// Consumer dashboard — must be registered before /:id
router.get("/mine/stats", requireAuth, getMyStats);
router.get("/mine", requireAuth, listMyJobs);

router.post(
  "/",
  requireAuth,
  upload.fields([
    { name: "source", maxCount: 1 },
    { name: "target", maxCount: 5 },
  ]),
  createJob
);

router.get("/:id", optionalAuth, getJob);

export default router;
