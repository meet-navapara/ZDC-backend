import { Router } from "express";
import { upload } from "../middleware/upload.js";
import { requireAuth, requireRole, requireActiveAccount } from "../middleware/auth.js";
import {
  registerBusiness,
  getProfile,
  updateProfile,
} from "../controllers/b2bController.js";
import {
  listCreditPacks,
  getWallet,
  getLedger,
  purchaseCredits,
} from "../controllers/creditsController.js";
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
} from "../controllers/catalogController.js";
import {
  listBranches,
  getBranch,
  createBranch,
  updateBranch,
  deleteBranch,
} from "../controllers/branchesController.js";
import { createB2bJob } from "../controllers/b2bTryonController.js";
import { getStats, exportReport } from "../controllers/b2bStatsController.js";
import { authLimiter } from "../middleware/rateLimit.js";

const router = Router();

// Public
router.post("/register", authLimiter, registerBusiness);
router.get("/credits/packs", listCreditPacks);

// Everything below requires an active B2B account (suspended/pending blocked).
const b2b = [requireAuth, requireRole("b2b"), requireActiveAccount];

// Profile
router.get("/me", ...b2b, getProfile);
router.patch("/me", ...b2b, updateProfile);

// Analytics / KPIs
router.get("/stats", ...b2b, getStats);
router.get("/stats/export.xlsx", ...b2b, exportReport);

// Credits
router.get("/credits", ...b2b, getWallet);
router.get("/credits/ledger", ...b2b, getLedger);
router.post("/credits/purchase", ...b2b, purchaseCredits);

// Branches (multi-location)
router.get("/branches", ...b2b, listBranches);
router.get("/branches/:id", ...b2b, getBranch);
router.post("/branches", ...b2b, createBranch);
router.patch("/branches/:id", ...b2b, updateBranch);
router.delete("/branches/:id", ...b2b, deleteBranch);

// Catalogue — categories
router.get("/categories", ...b2b, listCategories);
router.post("/categories", ...b2b, createCategory);
router.patch("/categories/:id", ...b2b, updateCategory);
router.delete("/categories/:id", ...b2b, deleteCategory);

// Catalogue — products (support up to 5 images per upload)
router.get("/products", ...b2b, listProducts);
router.get("/products/:id", ...b2b, getProduct);
router.post("/products", ...b2b, upload.array("images", 5), createProduct);
router.patch("/products/:id", ...b2b, upload.array("images", 5), updateProduct);
router.delete("/products/:id", ...b2b, deleteProduct);

// B2B try-on (consumes credits)
router.post("/tryon", ...b2b, upload.fields([{ name: "source", maxCount: 1 }]), createB2bJob);

export default router;
