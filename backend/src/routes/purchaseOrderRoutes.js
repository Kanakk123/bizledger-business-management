import express from "express";
import { authenticate, authorizePermission } from "../middleware/authMiddleware.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { purchaseOrderController as controller, purchaseOrderSchemas as schemas } from "../controllers/purchaseOrderController.js";

const router = express.Router();
const read = [authenticate, authorizePermission("purchases:read")];
const write = [authenticate, authorizePermission("purchases:write")];

router.get("/", ...read, validateQuery(schemas.list), controller.list);
router.post("/", ...write, validateBody(schemas.create), controller.create);
router.get("/:id", ...read, validateParams(schemas.id), controller.get);
router.patch("/:id", ...write, validateParams(schemas.id), validateBody(schemas.update), controller.update);
router.patch("/:id/status", ...write, validateParams(schemas.id), validateBody(schemas.status), controller.status);
router.post("/:id/receipts", ...write, validateParams(schemas.id), validateBody(schemas.receipt), controller.receive);
router.post("/:id/invoice", ...write, validateParams(schemas.id), controller.invoice);

export default router;
