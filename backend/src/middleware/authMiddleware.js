/**
 * Authentication & authorization middleware.
 *
 * authenticate – verifies the JWT, then fetches the user from the DB to
 *   confirm the account still exists and is active. Attaches the DB user
 *   (without passwordHash) to req.user so that downstream handlers always see
 *   the current role / status – not stale data embedded in the token.
 *
 * authorize  – role-based guard. Must come after authenticate.
 */

import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma.js";
import { AUTH_COOKIE } from "../utils/authCookie.js";

const cookieToken = (header = "") => {
  const pair = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${AUTH_COOKIE}=`));
  if (!pair) return null;
  try { return decodeURIComponent(pair.slice(AUTH_COOKIE.length + 1)); } catch { return null; }
};

export const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : cookieToken(req.headers.cookie);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  let decoded;
  try {
    if (!process.env.JWT_SECRET) throw new Error("JWT secret is not configured");
    decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"], issuer: "bizledger-api", audience: "bizledger-web",
    });
    if (!Number.isInteger(Number(decoded.sub))) throw new Error("Invalid subject");
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }

  // Always look up the current user from the DB so the role/active status is
  // never stale (token claims are NOT trusted for authorisation decisions).
  try {
    const user = await prisma.user.findUnique({
      where: { id: Number(decoded.sub) },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Account not found or deactivated",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Role-based access control.
 * @param  {...string} allowedRoles – e.g. authorize("ADMIN", "MANAGER")
 */
export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    // req.user is set by authenticate; never trust client-sent roles
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action",
      });
    }

    next();
  };
};

const READ_PERMISSIONS = ["dashboard:read", "products:read", "suppliers:read", "buyers:read", "purchases:read", "sales:read", "invoices:read", "payments:read", "reports:read"];
const BUSINESS_PERMISSIONS = [...READ_PERMISSIONS, "products:write", "suppliers:write", "buyers:write", "purchases:write", "sales:write", "invoices:write", "payments:write"];

export const ROLE_PERMISSIONS = Object.freeze({
  ADMIN: Object.freeze([...BUSINESS_PERMISSIONS, "users:manage", "settings:manage"]),
  MANAGER: Object.freeze(BUSINESS_PERMISSIONS),
  STAFF: Object.freeze(READ_PERMISSIONS),
});

export const authorizePermission = (permission) => (req, res, next) => {
  if (!req.user || !ROLE_PERMISSIONS[req.user.role]?.includes(permission)) {
    return res.status(403).json({ success: false, message: "You do not have permission to perform this action" });
  }
  return next();
};
