import bcrypt from "bcryptjs";
import { z } from "zod";
import { User, STATUSES } from "../models/User.js";
import { Product, PRODUCT_STATUSES } from "../models/Product.js";
import { Category } from "../models/Category.js";
import { TryonJob } from "../models/TryonJob.js";
import { Payment, PAYMENT_STATUSES } from "../models/Payment.js";
import { CreditWallet } from "../models/CreditWallet.js";
import { CreditLedger } from "../models/CreditLedger.js";
import { getBalance } from "../services/credits.js";
import { getPricingSafe, updatePricing } from "../services/pricing.js";
import { getContentSafe, updateContent } from "../services/siteContent.js";
import { buildPlatformStats } from "../services/platformStats.js";
import { recordAudit } from "../services/audit.js";
import { refundPayment as refundIntasendPayment } from "../services/intasend/checkout.js";
import { AuditLog, AUDIT_ACTIONS } from "../models/AuditLog.js";
import {
  passwordField,
  slugField,
  boundedText,
  currencyField,
  LIMITS,
  MAX_PRICE,
  MAX_CREDITS,
  objectIdField,
} from "../utils/validators.js";

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// High-level platform snapshot for the admin home.
export async function getOverview(req, res, next) {
  try {
    const [
      totalUsers,
      b2c,
      b2b,
      admins,
      pendingB2B,
      suspended,
      totalTryons,
      tryonsToday,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ role: "b2c" }),
      User.countDocuments({ role: "b2b" }),
      User.countDocuments({ role: "admin" }),
      User.countDocuments({ role: "b2b", status: "pending" }),
      User.countDocuments({ status: "suspended" }),
      TryonJob.countDocuments({}),
      TryonJob.countDocuments({ createdAt: { $gte: startOfToday() } }),
    ]);

    return res.json({
      overview: {
        users: { total: totalUsers, b2c, b2b, admins, pendingB2B, suspended },
        tryons: { total: totalTryons, today: tryonsToday },
      },
    });
  } catch (err) {
    return next(err);
  }
}

// Paginated, filterable user list.
export async function listUsers(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "20", 10)));
    const { role, status } = req.query;
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 100) : "";

    const filter = {};
    if (role) filter.role = role;
    if (status) filter.status = status;
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ email: rx }, { firstName: rx }, { lastName: rx }, { "business.name": rx }];
    }

    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    return res.json({
      users: users.map((u) => u.toSafeJSON()),
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    return next(err);
  }
}

// Single user with extra context (credits + usage for B2B).
export async function getUser(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const detail = { user: user.toSafeJSON() };

    if (user.role === "b2b") {
      const [credits, products, categories, tryons] = await Promise.all([
        getBalance(user._id),
        Product.countDocuments({ business: user._id }),
        Category.countDocuments({ business: user._id }),
        TryonJob.countDocuments({ user: user._id, channel: "b2b" }),
      ]);
      detail.stats = { credits, products, categories, tryons };
    }

    return res.json(detail);
  } catch (err) {
    return next(err);
  }
}

const statusSchema = z.object({ status: z.enum(STATUSES) });

// Approve / reject / suspend / reactivate via a single status transition.
export async function updateUserStatus(req, res, next) {
  try {
    const { status } = statusSchema.parse(req.body);
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.role === "admin") {
      return res.status(400).json({ error: "Cannot change an admin account's status" });
    }

    const previous = user.status;
    user.status = status;
    await user.save();

    await recordAudit(req, {
      action: "user.status_changed",
      targetType: "user",
      targetId: user._id,
      targetLabel: user.business?.name || user.email,
      meta: { from: previous, to: status, role: user.role },
    });

    return res.json({ user: user.toSafeJSON() });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}

const passwordSchema = z.object({ password: passwordField });

export async function resetUserPassword(req, res, next) {
  try {
    const { password } = passwordSchema.parse(req.body);
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.passwordHash = await bcrypt.hash(password, 10);
    await user.save();

    await recordAudit(req, {
      action: "user.password_reset",
      targetType: "user",
      targetId: user._id,
      targetLabel: user.business?.name || user.email,
      meta: { role: user.role },
    });

    return res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}

// Full platform analytics (users, try-ons, revenue, credits, trends).
export async function getAnalytics(req, res, next) {
  try {
    const days = Math.min(90, Math.max(7, parseInt(req.query.days || "30", 10)));
    const stats = await buildPlatformStats({ seriesDays: days });
    return res.json({ stats });
  } catch (err) {
    return next(err);
  }
}

/* -------------------------------- Audit log ------------------------------- */

// Paginated, filterable audit trail of admin actions (most recent first).
export async function listAudit(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "25", 10)));
    const { action } = req.query;
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 100) : "";

    const filter = {};
    if (action && AUDIT_ACTIONS.includes(action)) filter.action = action;
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ actorEmail: rx }, { targetLabel: rx }];
    }

    const [total, logs] = await Promise.all([
      AuditLog.countDocuments(filter),
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    return res.json({
      logs: logs.map((l) => l.toJSONSafe()),
      actions: AUDIT_ACTIONS,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    return next(err);
  }
}

/* ------------------------------- Payments -------------------------------- */

const PAYMENT_PURPOSES = ["b2c_tryon", "b2b_credits"];
const PAYMENT_GATEWAYS = ["stub", "mpesa", "intasend", "referral"];

// Paginated, filterable payment ledger with a summary for the current filter.
// Powers the Super Admin "Payment monitoring" view. Data comes straight from
// the payments collection, so this works with the stub gateway today and with
// M-Pesa / Intasend once those callbacks start writing real records.
export async function listPayments(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "20", 10)));
    const { status, gateway, purpose } = req.query;
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 100) : "";
    const days = req.query.days ? Math.min(365, Math.max(1, parseInt(req.query.days, 10))) : 0;

    const filter = {};
    if (status && PAYMENT_STATUSES.includes(status)) filter.status = status;
    if (gateway && PAYMENT_GATEWAYS.includes(gateway)) filter.gateway = gateway;
    if (purpose && PAYMENT_PURPOSES.includes(purpose)) filter.purpose = purpose;
    if (days) {
      const from = new Date();
      from.setDate(from.getDate() - days);
      filter.createdAt = { $gte: from };
    }
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      // Match by payment reference, or by the user's email/business name.
      const users = await User.find({
        $or: [{ email: rx }, { "business.name": rx }],
      })
        .select("_id")
        .limit(200)
        .lean();
      filter.$or = [{ reference: rx }];
      if (users.length) filter.$or.push({ user: { $in: users.map((u) => u._id) } });
    }

    const [total, payments, summaryRows] = await Promise.all([
      Payment.countDocuments(filter),
      Payment.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("user", "email role business.name")
        .lean(),
      // Summary over the same filter (ignores pagination).
      Payment.aggregate([
        { $match: filter },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            amount: { $sum: "$amount" },
          },
        },
      ]),
    ]);

    const summary = {
      currency: "KES",
      paid: { count: 0, amount: 0 },
      pending: { count: 0, amount: 0 },
      failed: { count: 0, amount: 0 },
      cancelled: { count: 0, amount: 0 },
      refunded: { count: 0, amount: 0 },
    };
    for (const row of summaryRows) {
      if (summary[row._id]) {
        summary[row._id] = { count: row.count, amount: row.amount };
      }
    }

    const rows = payments.map((p) => ({
      id: String(p._id),
      amount: p.amount,
      currency: p.currency || "KES",
      status: p.status,
      gateway: p.gateway,
      purpose: p.purpose,
      reference: p.reference || null,
      createdAt: p.createdAt,
      user: p.user
        ? {
            id: String(p.user._id),
            email: p.user.email,
            role: p.user.role,
            businessName: p.user.business?.name || null,
          }
        : null,
    }));

    return res.json({
      payments: rows,
      summary,
      statuses: PAYMENT_STATUSES,
      gateways: PAYMENT_GATEWAYS,
      purposes: PAYMENT_PURPOSES,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    return next(err);
  }
}

export async function refundPayment(req, res, next) {
  try {
    const id = objectIdField.parse(req.params.id);
    const payment = await Payment.findById(id);
    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }
    if (payment.status === "refunded") {
      return res.json({ payment: { id: String(payment._id), status: payment.status } });
    }
    if (payment.status !== "paid") {
      return res.status(409).json({ error: "Only paid payments can be refunded" });
    }
    if (payment.gateway !== "intasend") {
      return res.status(400).json({ error: "Refunds via API are only supported for IntaSend" });
    }
    const invoiceId = payment.providerInvoiceId || payment.reference;
    if (!invoiceId) {
      return res.status(409).json({ error: "Missing IntaSend invoice id" });
    }
    await refundIntasendPayment({
      invoiceId,
      amount: payment.amount,
      reason: "Admin refund",
    });
    payment.status = "refunded";
    payment.meta = {
      ...(payment.meta && typeof payment.meta === "object" ? payment.meta : {}),
      refundedAt: new Date().toISOString(),
    };
    await payment.save();
    return res.json({
      payment: {
        id: String(payment._id),
        status: payment.status,
        gateway: payment.gateway,
        amount: payment.amount,
        currency: payment.currency,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}

/* ---------------------------- Catalogue oversight ------------------------- */

// Read-only view of every product uploaded by boutiques/salons, so the operator
// can monitor catalogue quality and volume — with clear uploader attribution.
export async function listCatalog(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "24", 10)));
    const { status, business } = req.query;
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 100) : "";

    const filter = {};
    if (status && PRODUCT_STATUSES.includes(status)) filter.status = status;
    if (business && /^[a-f\d]{24}$/i.test(business)) filter.business = business;

    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      // Also match products whose uploader business name / email / owner name fits.
      const matchedUsers = await User.find({
        role: "b2b",
        $or: [
          { email: rx },
          { firstName: rx },
          { lastName: rx },
          { "business.name": rx },
        ],
      })
        .select("_id")
        .lean();
      const uploaderIds = matchedUsers.map((u) => u._id);
      filter.$or = [
        { name: rx },
        { sku: rx },
        ...(uploaderIds.length ? [{ business: { $in: uploaderIds } }] : []),
      ];
    }

    const [total, products, active, archived, businessIds, uploaderAgg] =
      await Promise.all([
        Product.countDocuments(filter),
        Product.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .populate(
            "business",
            "email firstName lastName phone business.name business.category business.currency"
          )
          .populate("category", "name")
          .lean(),
        Product.countDocuments({ ...filter, status: "active" }),
        Product.countDocuments({ ...filter, status: "archived" }),
        Product.distinct("business", filter),
        Product.aggregate([
          { $match: filter },
          {
            $group: {
              _id: "$business",
              productCount: { $sum: 1 },
              activeCount: {
                $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
              },
              archivedCount: {
                $sum: { $cond: [{ $eq: ["$status", "archived"] }, 1, 0] },
              },
              lastUploadAt: { $max: "$createdAt" },
            },
          },
          { $sort: { productCount: -1 } },
          { $limit: 50 },
          {
            $lookup: {
              from: "users",
              localField: "_id",
              foreignField: "_id",
              as: "user",
            },
          },
          { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 0,
              id: { $toString: "$_id" },
              productCount: 1,
              activeCount: 1,
              archivedCount: 1,
              lastUploadAt: 1,
              email: "$user.email",
              firstName: "$user.firstName",
              lastName: "$user.lastName",
              businessName: "$user.business.name",
              category: "$user.business.category",
            },
          },
        ]),
      ]);

    function uploaderLabel(u) {
      if (!u) return null;
      const person = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
      return u.businessName || person || u.email || "Unknown";
    }

    const rows = products.map((p) => {
      const b = p.business;
      const person = b
        ? [b.firstName, b.lastName].filter(Boolean).join(" ").trim()
        : "";
      return {
        id: String(p._id),
        name: p.name,
        sku: p.sku || null,
        price: p.price,
        currency: p.currency || "KES",
        status: p.status,
        imageCount: Array.isArray(p.imageUrls) ? p.imageUrls.length : 0,
        thumbnail:
          Array.isArray(p.imageUrls) && p.imageUrls.length
            ? p.imageUrls[0]
            : null,
        category: p.category?.name || null,
        createdAt: p.createdAt,
        business: b
          ? {
              id: String(b._id),
              email: b.email,
              name: b.business?.name || null,
              ownerName: person || null,
              category: b.business?.category || null,
              currency: b.business?.currency || null,
              phone: b.phone || null,
            }
          : null,
      };
    });

    const uploaders = uploaderAgg.map((u) => ({
      id: u.id,
      email: u.email || null,
      name: uploaderLabel(u),
      ownerName: [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || null,
      businessName: u.businessName || null,
      category: u.category || null,
      productCount: u.productCount,
      activeCount: u.activeCount,
      archivedCount: u.archivedCount,
      lastUploadAt: u.lastUploadAt,
    }));

    return res.json({
      products: rows,
      uploaders,
      summary: {
        total,
        active,
        archived,
        businesses: businessIds.length,
      },
      statuses: PRODUCT_STATUSES,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    return next(err);
  }
}

/* ---------------------------- Site content -------------------------------- */

export async function getContent(req, res, next) {
  try {
    const content = await getContentSafe();
    return res.json({ content });
  } catch (err) {
    return next(err);
  }
}

const heroStatSchema = z.object({
  value: boundedText(24, { min: 1 }),
  label: boundedText(40, { min: 1 }),
});

const contentSchema = z.object({
  hero: z.object({
    badge: boundedText(120),
    titleLine1: boundedText(60),
    titleHighlight: boundedText(60),
    titleLine2: boundedText(60),
    subtitle: boundedText(400),
    primaryCta: boundedText(40, { min: 1 }),
    stats: z.array(heroStatSchema).max(3),
  }),
  testimonials: z
    .array(
      z.object({
        quote: boundedText(500, { min: 1 }),
        author: boundedText(120, { min: 1 }),
        role: boundedText(120),
      })
    )
    .max(12),
  pricingNote: boundedText(300),
});

export async function setContent(req, res, next) {
  try {
    const data = contentSchema.parse(req.body);
    const doc = await updateContent({
      hero: data.hero,
      testimonials: data.testimonials,
      pricingNote: data.pricingNote,
      updatedBy: req.user.sub,
    });

    await recordAudit(req, {
      action: "content.updated",
      targetType: "content",
      targetLabel: "Site content",
      meta: { testimonials: data.testimonials.length },
    });

    return res.json({ content: doc.toJSONSafe() });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}

/* --------------------------------- Pricing -------------------------------- */

export async function getPricing(req, res, next) {
  try {
    const pricing = await getPricingSafe();
    return res.json({ pricing });
  } catch (err) {
    return next(err);
  }
}

const pricingSchema = z.object({
  b2cPacks: z
    .array(
      z.object({
        id: slugField,
        label: boundedText(LIMITS.packLabel, { min: 1 }),
        images: z.number().int().min(1).max(100),
        amount: z.number().min(0).max(MAX_PRICE),
        currency: currencyField.default("KES"),
      })
    )
    .min(1, "At least one B2C pack is required")
    .max(20, "Too many packs"),
  creditPacks: z
    .array(
      z.object({
        id: slugField,
        label: boundedText(LIMITS.packLabel, { min: 1 }),
        credits: z.number().int().min(1).max(MAX_CREDITS),
        amount: z.number().min(0).max(MAX_PRICE),
        currency: currencyField.default("KES"),
      })
    )
    .min(1, "At least one credit pack is required")
    .max(20, "Too many packs"),
});

function hasDuplicateIds(arr) {
  const ids = arr.map((p) => p.id);
  return new Set(ids).size !== ids.length;
}

export async function setPricing(req, res, next) {
  try {
    const data = pricingSchema.parse(req.body);
    if (hasDuplicateIds(data.b2cPacks) || hasDuplicateIds(data.creditPacks)) {
      return res.status(400).json({ error: "Pack ids must be unique within each list" });
    }
    const doc = await updatePricing({
      b2cPacks: data.b2cPacks,
      creditPacks: data.creditPacks,
      updatedBy: req.user.sub,
    });

    await recordAudit(req, {
      action: "pricing.updated",
      targetType: "pricing",
      targetLabel: "Platform pricing",
      meta: {
        b2cPacks: data.b2cPacks.length,
        creditPacks: data.creditPacks.length,
      },
    });

    return res.json({ pricing: doc.toJSONSafe() });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}

// Deletes a user and their related data. Admins cannot be deleted here.
export async function deleteUser(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.role === "admin") {
      return res.status(400).json({ error: "Cannot delete an admin account" });
    }
    if (req.user.sub === user._id.toString()) {
      return res.status(400).json({ error: "Cannot delete your own account" });
    }

    const id = user._id;
    await Promise.all([
      TryonJob.deleteMany({ user: id }),
      Payment.deleteMany({ user: id }),
      CreditWallet.deleteMany({ business: id }),
      CreditLedger.deleteMany({ business: id }),
      Category.deleteMany({ business: id }),
      Product.deleteMany({ business: id }),
    ]);
    await User.deleteOne({ _id: id });

    await recordAudit(req, {
      action: "user.deleted",
      targetType: "user",
      targetId: id,
      targetLabel: user.business?.name || user.email,
      meta: { role: user.role, email: user.email },
    });

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}
