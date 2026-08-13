import { Router } from "express";
import { getContentDoc } from "../services/siteContent.js";

const router = Router();

// Public, read-only site content used by the marketing landing page.
router.get("/", async (req, res, next) => {
  try {
    const doc = await getContentDoc();
    return res.json({ content: doc.toJSONSafe() });
  } catch (err) {
    return next(err);
  }
});

export default router;
