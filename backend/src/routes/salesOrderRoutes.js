import express from "express";
import { authenticate, authorizePermission } from "../middleware/authMiddleware.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { salesOrderController as controller, salesOrderSchemas as schemas } from "../controllers/salesOrderController.js";

const router = express.Router();
const read = [authenticate, authorizePermission("sales:read")];
const write = [authenticate, authorizePermission("sales:write")];

router.get("/", ...read, validateQuery(schemas.list), controller.list);
router.post("/", ...write, validateBody(schemas.create), controller.create);
router.get("/:id", ...read, validateParams(schemas.id), controller.get);
router.patch("/:id", ...write, validateParams(schemas.id), validateBody(schemas.update), controller.update);
router.patch("/:id/status", ...write, validateParams(schemas.id), validateBody(schemas.status), controller.status);
router.post("/:id/fulfillments", ...write, validateParams(schemas.id), validateBody(schemas.fulfillment), controller.fulfill);
router.post("/:id/returns", ...write, validateParams(schemas.id), validateBody(schemas.return), controller.return);
router.post("/:id/invoice", ...write, validateParams(schemas.id), controller.invoice);

export default router;
