import express from "express";
import { userController } from "../controllers/userController.js";
import { authenticate, authorizePermission } from "../middleware/authMiddleware.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { userCreateSchema, userStatusSchema } from "../schemas/users.js";
import { z } from "zod";

const router = express.Router();
const admin = [authenticate, authorizePermission("users:manage")];
const idSchema = z.object({ id: z.coerce.number().int().positive() });
router.get("/", ...admin, userController.list);
router.post("/", ...admin, validateBody(userCreateSchema), userController.create);
router.patch("/:id/status", ...admin, validateParams(idSchema), validateBody(userStatusSchema), userController.setActive);
export default router;
