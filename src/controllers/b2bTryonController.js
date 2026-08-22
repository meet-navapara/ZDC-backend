import { z } from "zod";
import { TryonJob } from "../models/TryonJob.js";
import { Product } from "../models/Product.js";
import { Category } from "../models/Category.js";
import { uploadImage } from "../services/storage.js";
import { consumeCredits, InsufficientCreditsError } from "../services/credits.js";
import { startProcessing } from "./tryonController.js";
import { env } from "../config/env.js";
import {
  resolveB2bTryOnFeature,
  resolveB2bHairColorPreset,
  resolveB2bBeardTemplateId,
  featureNeedsReferenceImage,
  isValidHairColorPreset,
} from "../services/perfectcorp/features.js";
import { listAllBeardStyleTemplates } from "../services/perfectcorp/client.js";
import { emailField, optionalText, objectIdField, LIMITS } from "../utils/validators.js";

const createSchema = z.object({
  productId: objectIdField,
  count: z.coerce.number().int().min(1).max(5).optional(),
  email: emailField.optional().or(z.literal("")),
  whatsapp: optionalText(LIMITS.phone),
});

async function resolvePerfectCorpJobSettings(feature, category) {
  if (feature === "haircolor") {
    const hairColorPreset = resolveB2bHairColorPreset(
      category,
      env.perfectcorp.hairColorPreset
    );
    if (!isValidHairColorPreset(hairColorPreset)) {
      const err = new Error(
        "Hair color category needs a valid preset. Set it in Catalog → category settings."
      );
      err.status = 400;
      throw err;
    }
    return { hairColorPreset, beardTemplateId: null };
  }

  if (feature === "beard") {
    let beardTemplateId = resolveB2bBeardTemplateId(
      category,
      env.perfectcorp.beardTemplateId
    );
    if (!beardTemplateId) {
      try {
        const raw = await listAllBeardStyleTemplates();
        beardTemplateId = raw[0]?.id || "";
      } catch (err) {
        console.warn("[perfectcorp] beard templates:", err.message);
      }
    }
    if (!beardTemplateId) {
      const err = new Error(
        "Beard category needs a style template. Set it in Catalog → category settings."
      );
      err.status = 400;
      throw err;
    }
    return { hairColorPreset: null, beardTemplateId };
  }

  return { hairColorPreset: null, beardTemplateId: null };
}

// B2B try-on: consumes credits instead of charging per image. A customer selfie
// is uploaded and rendered against a catalog product's image. The Perfect Corp
// API is chosen from the product's catalog category (tryOnFeature).
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

    let category = null;
    if (product.category) {
      category = await Category.findOne({
        _id: product.category,
        business: req.user.sub,
      });
    }

    const feature = resolveB2bTryOnFeature(
      category,
      env.perfectcorp.defaultFeature
    );
    const needsRef = featureNeedsReferenceImage(feature);
    const { hairColorPreset, beardTemplateId } =
      await resolvePerfectCorpJobSettings(feature, category);

    const source = req.files?.source?.[0];
    if (!source) {
      return res.status(400).json({ error: "A 'source' (customer selfie) image is required" });
    }

    const srcUp = await uploadImage(source.buffer, {
      folder: "zdc/b2b/source",
      originalName: source.originalname,
    });

    const refUrl = product.imageUrls[0];
    const targetImageUrls = needsRef
      ? Array.from({ length: count }, () => refUrl)
      : Array.from({ length: count }, () => srcUp.url);

    const job = await TryonJob.create({
      user: req.user.sub,
      channel: "b2b",
      pack: null,
      imageCount: count,
      amount: 0,
      creditsCost: count,
      product: product._id,
      sourceImageUrl: srcUp.url,
      targetImageUrl: needsRef ? refUrl : srcUp.url,
      targetImageUrls,
      perfectcorpFeature: feature,
      perfectcorpPreset: hairColorPreset,
      perfectcorpTemplateId: beardTemplateId,
      status: "processing",
      deliverTo: {
        email: data.email || null,
        whatsapp: data.whatsapp || null,
      },
    });

    try {
      const balance = await consumeCredits(req.user.sub, count, {
        note: `Try-on for "${product.name}" (${feature})`,
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
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
}
