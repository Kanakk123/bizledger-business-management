import express from "express";
import { authenticate, authorizePermission } from "../middleware/authMiddleware.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { invoiceController as controller } from "../controllers/invoiceController.js";
import { invoiceIdSchema, invoiceListSchema, invoiceMetadataSchema } from "../schemas/invoices.js";

const router = express.Router();
const read = [authenticate, authorizePermission("invoices:read")];
const write = [authenticate, authorizePermission("invoices:write")];
router.get("/summary", read, controller.summary);
router.get("/", read, validateQuery(invoiceListSchema), controller.invoices);
router.get("/:id/pdf", ...read, validateParams(invoiceIdSchema), controller.pdf);
router.get("/:id", ...read, validateParams(invoiceIdSchema), controller.invoice);
router.patch("/:id", ...write, validateParams(invoiceIdSchema), validateBody(invoiceMetadataSchema), controller.updateInvoice);
export default router;
