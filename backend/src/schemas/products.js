import Decimal from "decimal.js";
import { z } from "zod";

const decimal = (places, max) => z.union([z.string().trim(), z.number().finite()])
  .transform(String)
  .refine((value) => {
    try {
      const amount = new Decimal(value);
      return amount.isFinite() && amount.gte(0) && amount.lte(max) && amount.decimalPlaces() <= places;
    } catch { return false; }
  }, `Enter a non-negative number with at most ${places} decimal places.`)
  .transform((value) => new Decimal(value).toFixed(places));

const nullableText = (max) => z.string().trim().max(max).nullable().optional();
const categoryId = z.union([z.coerce.number().int().positive(), z.null()]).optional();

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: nullableText(5000),
}).strict();

export const categoryUpdateSchema = categoryCreateSchema.partial().refine((data) => Object.keys(data).length > 0, "Provide at least one category field to update.");

export const productCreateSchema = z.object({
  name: z.string().trim().min(1).max(150),
  sku: z.string().trim().min(1).max(60).transform((value) => value.toUpperCase()),
  description: nullableText(10000),
  categoryId,
  unit: z.string().trim().min(1).max(30),
  specifications: nullableText(10000),
  purchasePrice: decimal(2, "9999999999.99"),
  sellingPrice: decimal(2, "9999999999.99"),
  taxRate: decimal(2, "999.99").optional().default("0.00"),
  stockQuantity: decimal(3, "999999999.999").optional().default("0.000"),
  minStockLevel: decimal(3, "999999999.999").optional().default("0.000"),
  stockReason: z.string().trim().min(2).max(500).optional(),
  remarks: nullableText(10000),
}).strict().refine((value) => new Decimal(value.stockQuantity).isZero() || Boolean(value.stockReason), {
  path: ["stockReason"], message: "A reason is required when opening stock is greater than zero.",
});

export const productUpdateSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  sku: z.string().trim().min(1).max(60).transform((value) => value.toUpperCase()).optional(),
  description: nullableText(10000),
  categoryId,
  unit: z.string().trim().min(1).max(30).optional(),
  specifications: nullableText(10000),
  purchasePrice: decimal(2, "9999999999.99").optional(),
  sellingPrice: decimal(2, "9999999999.99").optional(),
  taxRate: decimal(2, "999.99").optional(),
  minStockLevel: decimal(3, "999999999.999").optional(),
  remarks: nullableText(10000),
}).strict().refine((data) => Object.keys(data).length > 0, "Provide at least one product field to update.");

export const stockAdjustmentSchema = z.object({
  quantityChange: z.union([z.string().trim(), z.number().finite()]).transform(String)
    .refine((value) => {
      try { const amount = new Decimal(value); return amount.isFinite() && !amount.isZero() && amount.abs().lte("999999999.999") && amount.decimalPlaces() <= 3; }
      catch { return false; }
    }, "Quantity change must be non-zero and have at most 3 decimal places.")
    .transform((value) => new Decimal(value).toFixed(3)),
  reason: z.string().trim().min(2).max(500),
}).strict();

export const productListQuerySchema = z.object({
  search: z.string().trim().max(150).optional().default(""),
  categoryId: z.coerce.number().int().positive().optional(),
  lowStock: z.enum(["true", "false"]).optional().default("false").transform((value) => value === "true"),
  includeArchived: z.enum(["true", "false"]).optional().default("false").transform((value) => value === "true"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
}).strict();
