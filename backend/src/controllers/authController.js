/**
 * Auth controller
 *
 * POST /api/auth/login  – authenticate with email + password, receive JWT
 * GET  /api/auth/me     – return the authenticated user's safe profile
 */

import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma.js";
import { comparePassword } from "../utils/password.js";
import { AUTH_COOKIE, authCookieOptions } from "../utils/authCookie.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Safe user projection – never includes passwordHash */
const safeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  createdAt: user.createdAt,
});

// ── Controllers ──────────────────────────────────────────────────────────────

/**
 * POST /api/auth/login
 */
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.validatedBody;

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // Use identical messages for "not found" and "wrong password" to avoid
    // user-enumeration attacks.
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const passwordMatches = await comparePassword(password, user.passwordHash);

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is not configured");
    }

    const token = jwt.sign(
      { sub: String(user.id) },
      process.env.JWT_SECRET,
      { expiresIn: "1d", algorithm: "HS256", issuer: "bizledger-api", audience: "bizledger-web" }
    );
    res.cookie(AUTH_COOKIE, token, authCookieOptions());

    return res.status(200).json({
      success: true,
      message: "Login successful",
      user: safeUser(user),
    });
  } catch (error) {
    next(error);
  }
};

export const logout = (_req, res) => {
  res.clearCookie(AUTH_COOKIE, authCookieOptions());
  return res.status(200).json({ success: true, message: "Logged out" });
};

/**
 * GET /api/auth/me
 * Protected – requires authenticate middleware.
 * req.user is populated by authMiddleware with a fresh DB lookup.
 */
export const me = (req, res) => {
  // req.user already set by authenticate middleware (no passwordHash)
  return res.status(200).json({
    success: true,
    user: safeUser(req.user),
  });
};
