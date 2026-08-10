import { Router } from "express";
import mongoose from "mongoose";

const router = Router();

router.get("/", (req, res) => {
  const dbState = mongoose.connection.readyState; // 1 = connected
  res.json({
    status: "ok",
    service: "zdc-backend",
    db: dbState === 1 ? "connected" : "disconnected",
    time: new Date().toISOString(),
  });
});

export default router;
