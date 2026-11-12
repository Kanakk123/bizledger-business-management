import { z } from "zod";
import {
  archiveCategory, archiveProduct, adjustStock, createCategory, createProduct,
  getProduct, listCategories, listProducts, updateCategory, updateProduct,
} from "../services/productService.js";
import { categoryCreateSchema, categoryUpdateSchema, productCreateSchema, productListQuerySchema, productUpdateSchema, stockAdjustmentSchema } from "../schemas/products.js";

const idSchema = z.object({ id: z.coerce.number().int().positive() });
const categoryListSchema = z.object({ includeArchived: z.enum(["true", "false"]).optional().default("false").transform((value) => value === "true") }).strict();
const created = (res, data) => res.status(201).json({ success: true, data });

export const categoryController = {
  create: async (req, res) => created(res, await createCategory(req.validatedBody, req.user.id)),
  list: async (req, res) => res.json({ success: true, data: await listCategories(req.validatedQuery) }),
  update: async (req, res) => res.json({ success: true, data: await updateCategory(req.validatedParams.id, req.validatedBody, req.user.id) }),
  archive: async (req, res) => res.json({ success: true, data: await archiveCategory(req.validatedParams.id, req.user.id) }),
};

export const productController = {
  create: async (req, res) => created(res, await createProduct(req.validatedBody, req.user.id)),
  list: async (req, res) => {
    const result = await listProducts(req.validatedQuery);
    return res.json({ success: true, ...result });
  },
  get: async (req, res) => res.json({ success: true, data: await getProduct(req.validatedParams.id) }),
  update: async (req, res) => res.json({ success: true, data: await updateProduct(req.validatedParams.id, req.validatedBody, req.user.id) }),
  archive: async (req, res) => res.json({ success: true, data: await archiveProduct(req.validatedParams.id, req.user.id) }),
  adjust: async (req, res) => res.json({ success: true, data: await adjustStock(req.validatedParams.id, req.validatedBody.quantityChange, req.validatedBody.reason, req.user.id) }),
};

export const productSchemas = { id: idSchema, categoryList: categoryListSchema, productList: productListQuerySchema, categoryCreate: categoryCreateSchema, categoryUpdate: categoryUpdateSchema, productCreate: productCreateSchema, productUpdate: productUpdateSchema, stockAdjustment: stockAdjustmentSchema };
