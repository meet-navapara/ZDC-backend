import { z } from "zod";
import { Branch } from "../models/Branch.js";
import { User } from "../models/User.js";
import {
  boundedText,
  optionalText,
  phoneField,
  objectIdField,
  latField,
  lngField,
  LIMITS,
} from "../utils/validators.js";

const addressSchema = z
  .object({
    line1: optionalText(LIMITS.addressLine),
    city: optionalText(LIMITS.city),
    country: optionalText(LIMITS.country),
    lat: latField.optional(),
    lng: lngField.optional(),
  })
  .optional();

const createSchema = z.object({
  name: boundedText(LIMITS.branchName, { min: 1 }),
  phone: phoneField,
  address: addressSchema,
  isPrimary: z.boolean().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const updateSchema = createSchema.partial();

function toSafe(branch) {
  return branch.toJSONSafe();
}

export async function listBranches(req, res, next) {
  try {
    let branches = await Branch.find({ business: req.user.sub }).sort({
      isPrimary: -1,
      createdAt: 1,
    });

    // Backfill HQ branch for older accounts created before multi-branch existed.
    if (branches.length === 0 && req.account) {
      await seedPrimaryBranch(req.account);
      branches = await Branch.find({ business: req.user.sub }).sort({
        isPrimary: -1,
        createdAt: 1,
      });
    }

    return res.json({
      branches: branches.map(toSafe),
      count: branches.length,
    });
  } catch (err) {
    return next(err);
  }
}

export async function getBranch(req, res, next) {
  try {
    const id = objectIdField.parse(req.params.id);
    const branch = await Branch.findOne({ _id: id, business: req.user.sub });
    if (!branch) return res.status(404).json({ error: "Branch not found" });
    return res.json({ branch: toSafe(branch) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}

export async function createBranch(req, res, next) {
  try {
    const data = createSchema.parse(req.body);
    const businessId = req.user.sub;
    const count = await Branch.countDocuments({ business: businessId });

    const makePrimary = data.isPrimary === true || count === 0;
    if (makePrimary) {
      await Branch.updateMany(
        { business: businessId, isPrimary: true },
        { $set: { isPrimary: false } }
      );
    }

    const branch = await Branch.create({
      business: businessId,
      name: data.name,
      phone: data.phone || null,
      address: data.address || {},
      isPrimary: makePrimary,
      status: data.status || "active",
    });

    // Keep legacy branchCount in sync with actual locations (informational only).
    await User.findByIdAndUpdate(businessId, {
      $set: { "business.branchCount": count + 1 },
    });

    return res.status(201).json({ branch: toSafe(branch) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}

export async function updateBranch(req, res, next) {
  try {
    const id = objectIdField.parse(req.params.id);
    const data = updateSchema.parse(req.body);
    const branch = await Branch.findOne({ _id: id, business: req.user.sub });
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    if (data.name !== undefined) branch.name = data.name;
    if (data.phone !== undefined) branch.phone = data.phone || null;
    if (data.status !== undefined) branch.status = data.status;
    if (data.address) {
      branch.address = { ...(branch.address || {}), ...data.address };
    }

    if (data.isPrimary === true) {
      await Branch.updateMany(
        { business: req.user.sub, isPrimary: true, _id: { $ne: branch._id } },
        { $set: { isPrimary: false } }
      );
      branch.isPrimary = true;
    } else if (data.isPrimary === false && branch.isPrimary) {
      // Keep at least one primary if others exist; otherwise allow clearing.
      const others = await Branch.countDocuments({
        business: req.user.sub,
        _id: { $ne: branch._id },
      });
      if (others === 0) {
        return res.status(400).json({
          error: "At least one primary branch is required",
        });
      }
      branch.isPrimary = false;
    }

    await branch.save();
    return res.json({ branch: toSafe(branch) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}

export async function deleteBranch(req, res, next) {
  try {
    const id = objectIdField.parse(req.params.id);
    const branch = await Branch.findOne({ _id: id, business: req.user.sub });
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const remaining = await Branch.countDocuments({
      business: req.user.sub,
      _id: { $ne: branch._id },
    });
    if (remaining === 0) {
      return res.status(400).json({
        error: "You must keep at least one branch",
      });
    }

    const wasPrimary = branch.isPrimary;
    await branch.deleteOne();

    if (wasPrimary) {
      const nextPrimary = await Branch.findOne({ business: req.user.sub }).sort({
        createdAt: 1,
      });
      if (nextPrimary) {
        nextPrimary.isPrimary = true;
        await nextPrimary.save();
      }
    }

    await User.findByIdAndUpdate(req.user.sub, {
      $set: { "business.branchCount": remaining },
    });

    return res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}

/**
 * Seeds the HQ / primary branch from registration data.
 * Safe to call after User.create — does nothing if branches already exist.
 */
export async function seedPrimaryBranch(user) {
  if (!user?._id || user.role !== "b2b") return null;
  const existing = await Branch.countDocuments({ business: user._id });
  if (existing > 0) return null;

  const addr = user.business?.address || {};
  return Branch.create({
    business: user._id,
    name: user.business?.name
      ? `${user.business.name} — Main`
      : "Main branch",
    phone: user.phone || null,
    address: {
      line1: addr.line1 || null,
      city: addr.city || null,
      country: addr.country || null,
      lat: addr.lat ?? null,
      lng: addr.lng ?? null,
    },
    isPrimary: true,
    status: "active",
  });
}
