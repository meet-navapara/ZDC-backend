import { verifyToken } from "../utils/jwt.js";
import { User } from "../models/User.js";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  try {
    req.user = verifyToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    return next();
  };
}

// Loads the account and blocks it if not active (suspended/pending). Enforces
// admin approval/suspension immediately, even on existing tokens. Attaches the
// loaded document as req.account for downstream handlers.
export async function requireActiveAccount(req, res, next) {
  try {
    const user = await User.findById(req.user?.sub);
    if (!user) return res.status(401).json({ error: "Account not found" });
    if (user.status === "suspended") {
      return res.status(403).json({ error: "Account suspended. Contact support." });
    }
    if (user.status === "pending") {
      return res.status(403).json({ error: "Account pending approval." });
    }
    req.account = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

// Attaches req.user if a valid token is present, but does not require it.
export function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme === "Bearer" && token) {
    try {
      req.user = verifyToken(token);
    } catch {
      // ignore invalid token for optional auth
    }
  }
  return next();
}
