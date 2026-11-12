import express from "express";
import { authenticate, authorizePermission } from "../middleware/authMiddleware.js";
import { validateQuery } from "../middleware/validate.js";
import { analyticsController as controller } from "../controllers/analyticsController.js";
import { analyticsQuerySchema, dashboardQuerySchema, reportQuerySchema } from "../schemas/analytics.js";

const router = express.Router();
const dashboardRead = [authenticate, authorizePermission("dashboard:read")];
const reportRead = [authenticate, authorizePermission("reports:read")];
router.get("/dashboard", ...dashboardRead, validateQuery(dashboardQuerySchema), controller.dashboard);
router.get("/analytics", ...reportRead, validateQuery(analyticsQuerySchema), controller.analytics);
router.get("/reports/export.csv", ...reportRead, validateQuery(reportQuerySchema), controller.exportCsv);
router.get("/reports", ...reportRead, validateQuery(reportQuerySchema), controller.reports);
export default router;
