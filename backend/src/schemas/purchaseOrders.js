import { z } from "zod";
import Decimal from "decimal.js";

const decimal = (label, { min = "0", max = "9999999999.99", decimals = 2, exclusiveMin = false } = {}) => z.string()
  .trim()
  .regex(new RegExp(`^\\d{1,10}(?:\\.\\d{1,${decimals}})?$`), `Enter a valid ${label} with up to ${decimals} decimal places.`)
  .refine((value) => {
    const parsed = new Decimal(value);
    return (exclusiveMin ? parsed.gt(min) : parsed.gte(min)) && parsed.lte(max);
  }, `${label} must be ${exclusiveMin ? "greater than" : "at least"} ${min} and no more than ${max}.`);

const orderItem = z.object({
  productId: z.coerce.number().int().positive(),
  quantity: decimal("quantity", { max: "999999999.999", decimals: 3, exclusiveMin: true }),
  unitPrice: decimal("unit price", { exclusiveMin: true }).optional(),
  discountPercent: decimal("discount percent", { max: "100" }).optional().default("0"),
  taxRate: decimal("tax rate", { max: "100" }).optional(),
}).strict();

const uniqueProducts = (items) => new Set(items.map((item) => item.productId)).size === items.length;
const orderItems = z.array(orderItem).min(1, "Add at least one product.").max(100, "An order can contain at most 100 lines.").refine(uniqueProducts, "A product can only appear once per purchase order.");

const common = {
  supplierId: z.coerce.number().int().positive(),
  items: orderItems,
  additionalCharges: decimal("additional charges").optional().default("0"),
  expectedDelivery: z.iso.date().nullable().optional(),
  remarks: z.string().trim().max(10000).nullable().optional(),
  deliveryInstructions: z.string().trim().max(10000).nullable().optional(),
};

export const purchaseOrderCreateSchema = z.object(common).strict();
export const purchaseOrderUpdateSchema = z.object({
  ...common,
  supplierId: common.supplierId.optional(),
  items: orderItems.optional(),
}).partial().strict().refine((data) => Object.keys(data).length > 0, "Provide at least one field to update.");

export const purchaseOrderIdSchema = z.object({ id: z.coerce.number().int().positive() }).strict();

export const purchaseOrderListSchema = z.object({
  search: z.string().trim().max(100).optional().default(""),
  status: z.enum(["DRAFT", "SENT", "CONFIRMED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED", "ALL"]).optional().default("ALL"),
  supplierId: z.coerce.number().int().positive().optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
}).strict().refine((data) => !data.dateFrom || !data.dateTo || data.dateFrom <= data.dateTo, {
  message: "Start date must be on or before end date.", path: ["dateTo"],
});

export const purchaseOrderStatusSchema = z.object({
  status: z.enum(["DRAFT", "SENT", "CONFIRMED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"]),
}).strict();

export const goodsReceiptSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(100),
  notes: z.string().trim().max(10000).nullable().optional(),
  items: z.array(z.object({
    purchaseOrderItemId: z.coerce.number().int().positive(),
    quantity: decimal("received quantity", { max: "999999999.999", decimals: 3, exclusiveMin: true }),
  }).strict()).min(1).max(100).refine((items) => new Set(items.map((item) => item.purchaseOrderItemId)).size === items.length, "A line can only be received once per delivery."),
}).strict();
