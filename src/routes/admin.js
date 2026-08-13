import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  getOverview,
  listUsers,
  getUser,
  updateUserStatus,
  resetUserPassword,
  deleteUser,
  getPricing,
  setPricing,
  getAnalytics,
  listAudit,
  listPayments,
  listCatalog,
  getContent,
  setContent,
} from "../controllers/adminController.js";

const router = Router();

// Every admin route requires an authenticated admin.
const admin = [requireAuth, requireRole("admin")];

router.get("/overview", ...admin, getOverview);
router.get("/analytics", ...admin, getAnalytics);
router.get("/audit", ...admin, listAudit);
router.get("/payments", ...admin, listPayments);
router.get("/catalog", ...admin, listCatalog);

// Pricing control
router.get("/pricing", ...admin, getPricing);
router.put("/pricing", ...admin, setPricing);

// Site content control
router.get("/content", ...admin, getContent);
router.put("/content", ...admin, setContent);

router.get("/users", ...admin, listUsers);
router.get("/users/:id", ...admin, getUser);
router.patch("/users/:id/status", ...admin, updateUserStatus);
router.post("/users/:id/reset-password", ...admin, resetUserPassword);
router.delete("/users/:id", ...admin, deleteUser);

export default router;
