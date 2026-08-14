import { Router } from "express";
import { getContentSafe } from "../services/siteContent.js";

const router = Router();

// Public, read-only site content used by the marketing landing page.
router.get("/", async (req, res, next) => {
  try {
    const content = await getContentSafe();
    return res.json({ content });
  } catch (err) {
    return next(err);
  }
});

export default router;
