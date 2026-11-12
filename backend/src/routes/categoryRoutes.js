import express from "express";
import { authenticate, authorizePermission } from "../middleware/authMiddleware.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { categoryController, productSchemas as schemas } from "../controllers/productController.js";

const router = express.Router();
const signedIn = [authenticate, authorizePermission("products:read")];
const canWrite = [authenticate, authorizePermission("products:write")];

router.get("/", ...signedIn, validateQuery(schemas.categoryList), categoryController.list);
router.post("/", ...canWrite, validateBody(schemas.categoryCreate), categoryController.create);
router.patch("/:id", ...canWrite, validateParams(schemas.id), validateBody(schemas.categoryUpdate), categoryController.update);
router.post("/:id/archive", ...canWrite, validateParams(schemas.id), categoryController.archive);

export default router;
