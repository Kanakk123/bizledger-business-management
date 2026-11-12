import express from "express";
import { authenticate, authorizePermission } from "../middleware/authMiddleware.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { productController, productSchemas as schemas } from "../controllers/productController.js";

const router = express.Router();
const signedIn = [authenticate, authorizePermission("products:read")];
const canWrite = [authenticate, authorizePermission("products:write")];

router.get("/low-stock", ...signedIn, validateQuery(schemas.productList), (req, res, next) => {
  req.validatedQuery = { ...req.validatedQuery, lowStock: true };
  return productController.list(req, res, next);
});
router.get("/", ...signedIn, validateQuery(schemas.productList), productController.list);
router.post("/", ...canWrite, validateBody(schemas.productCreate), productController.create);
router.get("/:id", ...signedIn, validateParams(schemas.id), productController.get);
router.patch("/:id", ...canWrite, validateParams(schemas.id), validateBody(schemas.productUpdate), productController.update);
router.post("/:id/archive", ...canWrite, validateParams(schemas.id), productController.archive);
router.post("/:id/adjustments", ...canWrite, validateParams(schemas.id), validateBody(schemas.stockAdjustment), productController.adjust);

export default router;
