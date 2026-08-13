import { z } from "zod";
import { TryonJob } from "../models/TryonJob.js";
import { Product } from "../models/Product.js";
import { uploadImage } from "../services/storage.js";
import { consumeCredits, InsufficientCreditsError } from "../services/credits.js";
import { startProcessing } from "./tryonController.js";
import { emailField, optionalText, objectIdField, LIMITS } from "../utils/validators.js";

const createSchema = z.object({
  productId: objectIdField,
  count: z.coerce.number().int().min(1).max(5).optional(),
  email: emailField.optional().or(z.literal("")),
  whatsapp: optionalText(LIMITS.phone),
});

// B2B try-on: consumes credits instead of charging per image. A customer selfie
// is uploaded and rendered against a catalog product's image.
export async function createB2bJob(req, res, next) {
  try {
    const data = createSchema.parse(req.body);
    const count = data.count || 1;

    const product = await Product.findOne({
      _id: data.productId,
      business: req.user.sub,
    });
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }
    if (!product.imageUrls.length) {
      return res.status(400).json({ error: "Product has no image to try on" });
    }

    const source = req.files?.source?.[0];
    if (!source) {
      return res.status(400).json({ error: "A 'source' (customer selfie) image is required" });
    }

    // Upload the customer selfie to cloud storage (never stored locally).
    const srcUp = await uploadImage(source.buffer, {
      folder: "zdc/b2b/source",
      originalName: source.originalname,
    });

    // Create the job, then reserve credits linked to it. If credits are
    // insufficient, roll back by removing the freshly-created job.
    const job = await TryonJob.create({
      user: req.user.sub,
      channel: "b2b",
      pack: null,
      imageCount: count,
      amount: 0,
      creditsCost: count,
      product: product._id,
      sourceImageUrl: srcUp.url,
      targetImageUrl: product.imageUrls[0],
      status: "processing",
      deliverTo: {
        email: data.email || null,
        whatsapp: data.whatsapp || null,
      },
    });

    try {
      const balance = await consumeCredits(req.user.sub, count, {
        note: `Try-on for "${product.name}"`,
        job: job._id,
      });
      startProcessing(job._id.toString());
      return res.status(201).json({ job: job.toJSONSafe(), credits: balance });
    } catch (creditErr) {
      await TryonJob.deleteOne({ _id: job._id });
      if (creditErr instanceof InsufficientCreditsError) {
        return res.status(402).json({
          error: "Insufficient credits",
          balance: creditErr.balance,
          required: creditErr.requested,
        });
      }
      throw creditErr;
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}
