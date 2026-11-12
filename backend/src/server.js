/**
 * BizLedger API – entry point
 *
 * IMPORTANT: In ESM, static `import` statements are hoisted and evaluated
 * before ANY top-level code in this module runs. We therefore load dotenv
 * in a separate "env loader" module that is imported FIRST so that env vars
 * are populated by the time every other module initialises its top-level code.
 *
 * Import order matters:
 *   1. ./config/env.js  → loads dotenv synchronously (no side-effects yet)
 *   2. ./config/prisma.js → reads process.env.DB_* (safe, env already loaded)
 *   3. Everything else
 */

import "./config/env.js"; // ← MUST be the very first import

import express from "express";
import cors from "cors";
import { prisma } from "./config/prisma.js";
import authRoutes from "./routes/authRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import { createPartnerRouter } from "./routes/partnerRoutes.js";
import purchaseOrderRoutes from "./routes/purchaseOrderRoutes.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  credentials: true,
}));
app.use(requestLogger);

// Parse JSON – returns a 400 on malformed bodies via the error handler below
app.use(express.json({ strict: true, limit: "1mb" }));

// ── Routes ──────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ message: "Welcome to BizLedger API!" });
});

app.get("/api/health", async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      success: true,
      message: "Backend and MySQL connected successfully!",
    });
  } catch (error) {
    next(error);
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/products", productRoutes);
app.use("/api/suppliers", createPartnerRouter("supplier"));
app.use("/api/buyers", createPartnerRouter("buyer"));
app.use("/api/purchases", purchaseOrderRoutes);

// ── 404 ─────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ── Centralised error handler ────────────────────────────────────────────────
app.use(errorHandler);

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`BizLedger server running on port ${PORT}`);
});
