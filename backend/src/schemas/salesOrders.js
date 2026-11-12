import { z } from "zod";
import Decimal from "decimal.js";

const decimal = (label, { max = "9999999999.99", decimals = 2, positive = false } = {}) => z.string().trim()
  .regex(new RegExp(`^\\d{1,10}(?:\\.\\d{1,${decimals}})?$`), `Enter a valid ${label} with up to ${decimals} decimal places.`)
  .refine((value) => {
    const parsed = new Decimal(value);
    return (positive ? parsed.gt(0) : parsed.gte(0)) && parsed.lte(max);
  }, `${label} must be ${positive ? "greater than zero" : "non-negative"} and within the supported limit.`);

const itemSchema = z.object({
  productId: z.coerce.number().int().positive(),
  quantity: decimal("quantity", { max: "999999999.999", decimals: 3, positive: true }),
  unitPrice: decimal("unit price", { positive: true }).optional(),
  discountPercent: decimal("discount percent", { max: "100" }).optional().default("0"),
  taxRate: decimal("tax rate", { max: "100" }).optional(),
}).strict();

const itemsSchema = z.array(itemSchema).min(1, "Add at least one product.").max(100).refine(
  (items) => new Set(items.map((item) => item.productId)).size === items.length,
  "A product can only appear once per sales order.",
);
const base = {
  buyerId: z.coerce.number().int().positive(),
  items: itemsSchema,
  shippingCharges: decimal("shipping charges").optional().default("0"),
  expectedDelivery: z.iso.date().nullable().optional(),
  remarks: z.string().trim().max(10000).nullable().optional(),
  deliveryInstructions: z.string().trim().max(10000).nullable().optional(),
};

export const salesOrderCreateSchema = z.object(base).strict();
export const salesOrderUpdateSchema = z.object({
  ...base,
  buyerId: base.buyerId.optional(),
  items: itemsSchema.optional(),
}).partial().strict().refine((data) => Object.keys(data).length > 0, "Provide at least one field to update.");

export const salesOrderIdSchema = z.object({ id: z.coerce.number().int().positive() }).strict();
export const salesOrderListSchema = z.object({
  search: z.string().trim().max(100).optional().default(""),
  status: z.enum(["NEW", "CONFIRMED", "PROCESSING", "DISPATCHED", "DELIVERED", "CANCELLED", "ALL"]).optional().default("ALL"),
  buyerId: z.coerce.number().int().positive().optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
}).strict().refine((data) => !data.dateFrom || !data.dateTo || data.dateFrom <= data.dateTo, {
  message: "Start date must be on or before end date.", path: ["dateTo"],
});

export const salesOrderStatusSchema = z.object({
  status: z.enum(["NEW", "CONFIRMED", "PROCESSING", "DISPATCHED", "DELIVERED", "CANCELLED"]),
}).strict();

const movement = z.object({
  idempotencyKey: z.string().trim().min(8).max(100),
  notes: z.string().trim().max(10000).nullable().optional(),
  items: z.array(z.object({
    salesOrderItemId: z.coerce.number().int().positive(),
    quantity: decimal("quantity", { max: "999999999.999", decimals: 3, positive: true }),
  }).strict()).min(1).max(100).refine((rows) => new Set(rows.map((row) => row.salesOrderItemId)).size === rows.length, "A sales order line can only be listed once per request."),
}).strict();

export const salesFulfillmentSchema = movement;
export const salesReturnSchema = movement.extend({ reason: z.string().trim().min(2).max(1000) }).strict();
