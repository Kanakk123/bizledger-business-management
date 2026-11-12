import { z } from "zod";

const blankToNull = (value) => typeof value === "string" && value.trim() === "" ? null : value;
const optionalText = (max) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
const email = z.preprocess(blankToNull, z.email().max(150).transform((value) => value.toLowerCase()).nullable().optional());
const phone = z.preprocess(blankToNull, z.string().trim().max(25).nullable().optional()).refine((value) => {
  if (value == null) return true;
  const digits = value.replace(/\D/g, "");
  return /^\+?[0-9().\s-]+$/.test(value) && digits.length >= 7 && digits.length <= 15;
}, "Enter a phone number with 7–15 digits and standard phone punctuation.");
const taxRegistration = z.preprocess(blankToNull, z.string().trim().toUpperCase().regex(
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
  "Enter a valid 15-character GSTIN.",
).nullable().optional());

const shared = {
  name: z.string().trim().min(1).max(150),
  companyName: optionalText(150),
  email,
  phone,
  city: optionalText(100),
  state: optionalText(100),
  postalCode: optionalText(30),
  country: optionalText(100),
  taxRegistration,
  notes: optionalText(10000),
};

export const supplierCreateSchema = z.object({
  ...shared,
  address: optionalText(10000),
  paymentTerms: optionalText(100),
}).strict();

export const supplierUpdateSchema = supplierCreateSchema.partial().refine((value) => Object.keys(value).length > 0, "Provide at least one supplier field to update.");

export const buyerCreateSchema = z.object({
  ...shared,
  billingAddress: optionalText(10000),
  shippingAddress: optionalText(10000),
}).strict();

export const buyerUpdateSchema = buyerCreateSchema.partial().refine((value) => Object.keys(value).length > 0, "Provide at least one buyer field to update.");

export const partnerListQuerySchema = z.object({
  search: z.string().trim().max(150).optional().default(""),
  status: z.enum(["ACTIVE", "INACTIVE", "ALL"]).optional().default("ACTIVE"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
}).strict();

export const partnerIdSchema = z.object({ id: z.coerce.number().int().positive() }).strict();
