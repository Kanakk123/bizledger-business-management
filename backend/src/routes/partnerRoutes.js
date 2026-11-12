import express from "express";
import { authenticate, authorizePermission } from "../middleware/authMiddleware.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { createPartnerController, partnerSchemas } from "../controllers/partnerController.js";

export const createPartnerRouter = (kind) => {
  const router = express.Router();
  const controller = createPartnerController(kind);
  const schemas = partnerSchemas[kind];
  if (!schemas) throw new TypeError("Unknown partner route");
  const resource = kind === "supplier" ? "suppliers" : "buyers";
  const canRead = [authenticate, authorizePermission(`${resource}:read`)];
  const canWrite = [authenticate, authorizePermission(`${resource}:write`)];

  router.get("/", ...canRead, validateQuery(schemas.list), controller.list);
  router.post("/", ...canWrite, validateBody(schemas.create), controller.create);
  router.get("/:id", ...canRead, validateParams(schemas.id), controller.get);
  router.patch("/:id", ...canWrite, validateParams(schemas.id), validateBody(schemas.update), controller.update);
  router.post("/:id/archive", ...canWrite, validateParams(schemas.id), controller.archive);
  return router;
};
