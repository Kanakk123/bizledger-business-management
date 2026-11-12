import { z } from "zod";
import Decimal from "decimal.js";

const id = z.coerce.number().int().positive();
const page = { page: z.coerce.number().int().min(1).optional().default(1), pageSize: z.coerce.number().int().min(1).max(100).optional().default(20) };
const date = z.iso.date();
export const invoiceIdSchema = z.object({ id }).strict();
export const invoiceMetadataSchema = z.object({ dueDate: date.nullable().optional(), notes: z.string().trim().max(10000).nullable().optional(), paymentTerms: z.string().trim().max(100).nullable().optional() }).strict().refine((v) => Object.keys(v).length > 0, "Provide at least one field to update.");
export const invoiceListSchema = z.object({
  ...page, search: z.string().trim().max(100).optional().default(""), type: z.enum(["PURCHASE", "SALES", "ALL"]).optional().default("ALL"),
  status: z.enum(["UNPAID", "PARTIALLY_PAID", "PAID", "OVERDUE", "ALL"]).optional().default("ALL"),
  supplierId: id.optional(), buyerId: id.optional(), dateFrom: date.optional(), dateTo: date.optional(),
}).strict().refine((v) => !v.dateFrom || !v.dateTo || v.dateFrom <= v.dateTo, { path: ["dateTo"], message: "Start date must not be after end date." });
export const paymentCreateSchema = z.object({
  invoiceId: id,
  amount: z.string().trim().regex(/^\d{1,10}(?:\.\d{1,2})?$/, "Enter a valid amount with up to two decimal places.").refine((v) => new Decimal(v).gt(0) && new Decimal(v).lte("9999999999.99"), "Amount must be positive and within the supported limit."),
  paymentDate: date.optional(), method: z.enum(["CASH", "BANK_TRANSFER", "UPI", "CARD", "CHEQUE", "OTHER"]),
  transactionReference: z.string().trim().max(150).nullable().optional(), notes: z.string().trim().max(10000).nullable().optional(),
  idempotencyKey: z.string().trim().min(8).max(100),
}).strict();
export const paymentListSchema = z.object({ ...page, search: z.string().trim().max(100).optional().default(""), type: z.enum(["PURCHASE", "SALES", "ALL"]).optional().default("ALL"), invoiceId: id.optional(), supplierId: id.optional(), buyerId: id.optional(), dateFrom: date.optional(), dateTo: date.optional() }).strict();
