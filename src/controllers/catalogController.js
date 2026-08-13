import { z } from "zod";
import { Category, MAX_CATEGORIES_PER_BUSINESS } from "../models/Category.js";
import { Product, PRODUCT_STATUSES } from "../models/Product.js";
import { uploadImage } from "../services/storage.js";
import {
  boundedText,
  optionalText,
  currencyField,
  objectIdField,
  LIMITS,
  MAX_PRICE,
} from "../utils/validators.js";

/* ----------------------------- Categories ----------------------------- */

const categorySchema = z.object({
  name: boundedText(LIMITS.categoryName, { min: 1 }),
  description: optionalText(LIMITS.shortDescription),
  order: z.number().int().min(0).max(9999).optional(),
});

export async function listCategories(req, res, next) {
  try {
    const categories = await Category.find({ business: req.user.sub }).sort({
      order: 1,
      createdAt: 1,
    });
    return res.json({ categories: categories.map((c) => c.toJSONSafe()) });
  } catch (err) {
    return next(err);
  }
}

export async function createCategory(req, res, next) {
  try {
    const data = categorySchema.parse(req.body);
    const count = await Category.countDocuments({ business: req.user.sub });
    if (count >= MAX_CATEGORIES_PER_BUSINESS) {
      return res.status(409).json({
        error: `Category limit reached (max ${MAX_CATEGORIES_PER_BUSINESS})`,
      });
    }
    const category = await Category.create({
      business: req.user.sub,
      name: data.name,
      description: data.description || null,
      order: data.order ?? count,
    });
    return res.status(201).json({ category: category.toJSONSafe() });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}

export async function updateCategory(req, res, next) {
  try {
    const data = categorySchema.partial().parse(req.body);
    const category = await Category.findOne({
      _id: req.params.id,
      business: req.user.sub,
    });
    if (!category) return res.status(404).json({ error: "Category not found" });

    if (data.name !== undefined) category.name = data.name;
    if (data.description !== undefined) category.description = data.description || null;
    if (data.order !== undefined) category.order = data.order;
    await category.save();
    return res.json({ category: category.toJSONSafe() });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}

export async function deleteCategory(req, res, next) {
  try {
    const category = await Category.findOneAndDelete({
      _id: req.params.id,
      business: req.user.sub,
    });
    if (!category) return res.status(404).json({ error: "Category not found" });
    // Detach products from the deleted category (keep the products).
    await Product.updateMany(
      { business: req.user.sub, category: category._id },
      { $set: { category: null } }
    );
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

/* ------------------------------ Products ------------------------------ */

const productSchema = z.object({
  name: boundedText(LIMITS.productName, { min: 1 }),
  sku: optionalText(LIMITS.sku),
  description: optionalText(LIMITS.description),
  price: z.coerce.number().min(0).max(MAX_PRICE).optional(),
  currency: currencyField.optional(),
  categoryId: objectIdField.optional().or(z.literal("")),
  status: z.enum(PRODUCT_STATUSES).optional(),
});

export async function listProducts(req, res, next) {
  try {
    const filter = { business: req.user.sub };
    if (req.query.categoryId) filter.category = req.query.categoryId;
    if (req.query.status) filter.status = req.query.status;
    const products = await Product.find(filter).sort({ createdAt: -1 });
    return res.json({ products: products.map((p) => p.toJSONSafe()) });
  } catch (err) {
    return next(err);
  }
}

export async function getProduct(req, res, next) {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      business: req.user.sub,
    });
    if (!product) return res.status(404).json({ error: "Product not found" });
    return res.json({ product: product.toJSONSafe() });
  } catch (err) {
    return next(err);
  }
}

async function uploadProductImages(files) {
  if (!files || files.length === 0) return [];
  const uploads = await Promise.all(
    files.map((f) =>
      uploadImage(f.buffer, {
        folder: "zdc/catalog",
        originalName: f.originalname,
      })
    )
  );
  return uploads.map((u) => u.url);
}

export async function createProduct(req, res, next) {
  try {
    const data = productSchema.parse(req.body);

    // Validate category ownership if provided.
    let categoryId = null;
    if (data.categoryId) {
      const cat = await Category.findOne({
        _id: data.categoryId,
        business: req.user.sub,
      });
      if (!cat) return res.status(400).json({ error: "Invalid category" });
      categoryId = cat._id;
    }

    const imageUrls = await uploadProductImages(req.files);

    const product = await Product.create({
      business: req.user.sub,
      category: categoryId,
      name: data.name,
      sku: data.sku || null,
      description: data.description || null,
      price: data.price ?? 0,
      currency: data.currency || "KES",
      imageUrls,
      status: data.status || "active",
    });
    return res.status(201).json({ product: product.toJSONSafe() });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}

export async function updateProduct(req, res, next) {
  try {
    const data = productSchema.partial().parse(req.body);
    const product = await Product.findOne({
      _id: req.params.id,
      business: req.user.sub,
    });
    if (!product) return res.status(404).json({ error: "Product not found" });

    if (data.categoryId !== undefined) {
      if (data.categoryId) {
        const cat = await Category.findOne({
          _id: data.categoryId,
          business: req.user.sub,
        });
        if (!cat) return res.status(400).json({ error: "Invalid category" });
        product.category = cat._id;
      } else {
        product.category = null;
      }
    }
    if (data.name !== undefined) product.name = data.name;
    if (data.sku !== undefined) product.sku = data.sku || null;
    if (data.description !== undefined) product.description = data.description || null;
    if (data.price !== undefined) product.price = data.price;
    if (data.currency !== undefined) product.currency = data.currency;
    if (data.status !== undefined) product.status = data.status;

    // Optionally replace the kept image set (for removal/reorder). Sent as a
    // JSON string of URLs because the request is multipart/form-data.
    if (typeof req.body.imageUrls === "string") {
      try {
        const kept = JSON.parse(req.body.imageUrls);
        if (Array.isArray(kept)) {
          product.imageUrls = kept.filter((u) => typeof u === "string");
        }
      } catch {
        // ignore malformed value and keep existing images
      }
    }

    // Append any newly uploaded images.
    const newImages = await uploadProductImages(req.files);
    if (newImages.length) product.imageUrls = [...product.imageUrls, ...newImages];

    await product.save();
    return res.json({ product: product.toJSONSafe() });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}

export async function deleteProduct(req, res, next) {
  try {
    const product = await Product.findOneAndDelete({
      _id: req.params.id,
      business: req.user.sub,
    });
    if (!product) return res.status(404).json({ error: "Product not found" });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}
