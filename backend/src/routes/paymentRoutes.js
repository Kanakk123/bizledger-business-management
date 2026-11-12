import express from "express";
import { authenticate, authorizePermission } from "../middleware/authMiddleware.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { invoiceController as controller } from "../controllers/invoiceController.js";
import { invoiceIdSchema, paymentCreateSchema, paymentListSchema } from "../schemas/invoices.js";

const router = express.Router();
router.get("/", authenticate, authorizePermission("payments:read"), validateQuery(paymentListSchema), controller.payments);
router.post("/", authenticate, authorizePermission("payments:write"), validateBody(paymentCreateSchema), controller.createPayment);
router.get("/:id", authenticate, authorizePermission("payments:read"), validateParams(invoiceIdSchema), controller.payment);
export default router;
