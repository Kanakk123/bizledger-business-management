import { z } from "zod";

const day = z.iso.date();
const range = {
  dateFrom: day.optional(), dateTo: day.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().trim().max(150).optional().default(""),
};
const dateRangeRefine = (data) => !data.dateFrom || !data.dateTo || data.dateFrom <= data.dateTo;
const rangeSchema = (schema) => schema.refine(dateRangeRefine, { path: ["dateTo"], message: "Start date must not be after end date." });

export const dashboardQuerySchema = rangeSchema(z.object({ dateFrom: day.optional(), dateTo: day.optional() }).strict());
export const analyticsQuerySchema = rangeSchema(z.object({
  dateFrom: day.optional(), dateTo: day.optional(), groupBy: z.enum(["daily", "weekly", "monthly"]).optional().default("daily"),
}).strict());
export const reportQuerySchema = rangeSchema(z.object({
  ...range,
  type: z.enum(["sales", "purchases", "inventory", "low-stock", "product-sales", "product-purchases", "supplier-transactions", "buyer-transactions", "receivables", "payables", "revenue-expenditure", "payments"]),
  status: z.enum(["ALL", "NEW", "CONFIRMED", "PROCESSING", "DISPATCHED", "DELIVERED", "CANCELLED", "DRAFT", "SENT", "PARTIALLY_RECEIVED", "RECEIVED", "UNPAID", "PARTIALLY_PAID", "PAID", "OVERDUE"]).optional().default("ALL"),
  supplierId: z.coerce.number().int().positive().optional(), buyerId: z.coerce.number().int().positive().optional(), productId: z.coerce.number().int().positive().optional(),
  sortBy: z.enum(["date", "name", "amount", "quantity"]).optional().default("date"), sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
}).strict());
