import express from "express";
import { login, logout, me } from "../controllers/authController.js";
import { authenticate } from "../middleware/authMiddleware.js";
import { validateBody } from "../middleware/validate.js";
import { loginSchema } from "../schemas/auth.js";

const router = express.Router();

router.post("/login", validateBody(loginSchema), login);
router.get("/me", authenticate, me);
router.post("/logout", authenticate, logout);

export default router;
