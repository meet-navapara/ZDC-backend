import { AuditLog } from "../models/AuditLog.js";
import { User } from "../models/User.js";

// Best-effort client IP from common proxy headers, falling back to the socket.
function clientIp(req) {
  const fwd = req.headers?.["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}

// Records an admin action. Fire-and-forget: never blocks or fails the request —
// audit logging must not break the operation it is describing.
export async function recordAudit(req, { action, targetType, targetId, targetLabel, meta } = {}) {
  try {
    const actorId = req.user?.sub || null;
    let actorEmail = req.account?.email || req.user?.email || null;
    if (!actorEmail && actorId) {
      const actor = await User.findById(actorId).select("email").lean();
      actorEmail = actor?.email || null;
    }
    await AuditLog.create({
      actor: actorId,
      actorEmail,
      action,
      targetType: targetType || null,
      targetId: targetId || null,
      targetLabel: targetLabel || null,
      meta: meta || {},
      ip: clientIp(req),
    });
  } catch (err) {
    console.error("[audit] failed to record:", err.message);
  }
}
