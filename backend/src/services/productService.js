import Decimal from "decimal.js";
import { prisma } from "../config/prisma.js";
import { isCountableUnit } from "../utils/productUnits.js";

const STOCK_MAX = new Decimal("999999999.999");

export class ProductServiceError extends Error {
  constructor(message, status = 400) { super(message); this.name = "ProductServiceError"; this.status = status; }
}


const ensureActiveCategory = async (db, categoryId) => {
  if (categoryId == null) return;
  const category = await db.category.findFirst({ where: { id: categoryId, isActive: true }, select: { id: true } });
  if (!category) throw new ProductServiceError("Category does not exist or is archived", 422);
};

const audit = (tx, userId, action, entity, entityId, metadata) => tx.auditLog.create({
  data: { userId, action, entity, entityId: String(entityId), metadata },
});

const stockLedger = (tx, productId, quantityChange, notes) => tx.inventoryTransaction.create({
  data: { productId, type: "ADJUSTMENT", quantityChange, notes },
});

export async function createCategory(data, userId, db = prisma) {
  try {
    return await db.$transaction(async (tx) => {
      const dupes = await tx.category.findMany({ select: { id: true, name: true } });
      if (dupes.some((category) => category.name.trim().toLocaleLowerCase() === data.name.toLocaleLowerCase())) {
        throw new ProductServiceError("A category with this name already exists", 409);
      }
      const category = await tx.category.create({ data: { name: data.name, description: data.description ?? null } });
      await audit(tx, userId, "CATEGORY_CREATED", "Category", category.id, { name: category.name });
      return category;
    });
  } catch (error) { throw mapUniqueError(error, "A category with this name already exists"); }
}

export async function listCategories({ includeArchived = false } = {}, db = prisma) {
  return db.category.findMany({
    where: includeArchived ? {} : { isActive: true },
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true } } },
  });
}

export async function updateCategory(id, data, userId, db = prisma) {
  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.category.findUnique({ where: { id } });
      if (!current) throw new ProductServiceError("Category not found", 404);
      if (!current.isActive) throw new ProductServiceError("Archived categories cannot be edited", 409);
      if (data.name && data.name.toLocaleLowerCase() !== current.name.toLocaleLowerCase()) {
        const all = await tx.category.findMany({ where: { id: { not: id } }, select: { name: true } });
        if (all.some((category) => category.name.trim().toLocaleLowerCase() === data.name.toLocaleLowerCase())) {
          throw new ProductServiceError("A category with this name already exists", 409);
        }
      }
      const category = await tx.category.update({ where: { id }, data });
      await audit(tx, userId, "CATEGORY_UPDATED", "Category", id, { changedFields: Object.keys(data) });
      return category;
    });
  } catch (error) { throw mapUniqueError(error, "A category with this name already exists"); }
}

export async function archiveCategory(id, userId, db = prisma) {
  return db.$transaction(async (tx) => {
    const current = await tx.category.findUnique({ where: { id } });
    if (!current) throw new ProductServiceError("Category not found", 404);
    if (!current.isActive) return current;
    const category = await tx.category.update({ where: { id }, data: { isActive: false } });
    await audit(tx, userId, "CATEGORY_ARCHIVED", "Category", id, { name: current.name });
    return category;
  });
}

export async function listProducts(filters, db = prisma) {
  const where = {
    ...(filters.includeArchived ? {} : { isActive: true }),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.search ? { OR: [
      { name: { contains: filters.search } },
      { sku: { contains: filters.search } },
      { description: { contains: filters.search } },
    ] } : {}),
    ...(filters.lowStock ? { stockQuantity: { lte: prisma.product.fields.minStockLevel } } : {}),
  };
  const [items, total] = await Promise.all([
    db.product.findMany({ where, include: { category: true }, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }),
    db.product.count({ where }),
  ]);
  return { items, pagination: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) } };
}

export async function getProduct(id, db = prisma) {
  const product = await db.product.findUnique({
    where: { id },
    include: {
      category: true,
      inventoryTransactions: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 },
    },
  });
  if (!product) throw new ProductServiceError("Product not found", 404);
  return product;
}

export async function createProduct(data, userId, db = prisma) {
  if (isCountableUnit(data.unit) && !new Decimal(data.stockQuantity ?? 0).isInteger()) throw new ProductServiceError(`Fractional quantities are not allowed for products measured in ${data.unit}. Enter a whole number quantity.`, 422);
  try {
    return await db.$transaction(async (tx) => {
      await ensureActiveCategory(tx, data.categoryId);
      const { stockReason, ...productData } = data;
      const product = await tx.product.create({
        data: { ...productData, sku: data.sku.trim().toUpperCase(), stockQuantity: data.stockQuantity ?? "0.000" },
        include: { category: true },
      });
      if (!new Decimal(product.stockQuantity.toString()).isZero()) {
        await stockLedger(tx, product.id, product.stockQuantity, stockReason);
      }
      await audit(tx, userId, "PRODUCT_CREATED", "Product", product.id, { sku: product.sku });
      return product;
    });
  } catch (error) { throw mapUniqueError(error, "A product with this SKU already exists"); }
}

export async function updateProduct(id, data, userId, db = prisma) {
  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.product.findUnique({ where: { id }, select: { id: true, isActive: true, categoryId: true, unit: true, stockQuantity: true } });
      if (!current) throw new ProductServiceError("Product not found", 404);
      if (!current.isActive) throw new ProductServiceError("Archived products cannot be edited", 409);
      if (data.unit !== undefined && isCountableUnit(data.unit) && !new Decimal(current.stockQuantity.toString()).isInteger()) throw new ProductServiceError(`Cannot change the unit to ${data.unit} while stock includes fractional quantities. Adjust stock to a whole number first.`, 422);
      if (data.categoryId !== undefined && data.categoryId !== current.categoryId) await ensureActiveCategory(tx, data.categoryId);
      const product = await tx.product.update({ where: { id }, data, include: { category: true } });
      await audit(tx, userId, "PRODUCT_UPDATED", "Product", id, { changedFields: Object.keys(data) });
      return product;
    });
  } catch (error) { throw mapUniqueError(error, "A product with this SKU already exists"); }
}

export async function archiveProduct(id, userId, db = prisma) {
  return db.$transaction(async (tx) => {
    const current = await tx.product.findUnique({ where: { id } });
    if (!current) throw new ProductServiceError("Product not found", 404);
    if (!current.isActive) return current;
    const product = await tx.product.update({ where: { id }, data: { isActive: false }, include: { category: true } });
    await audit(tx, userId, "PRODUCT_ARCHIVED", "Product", id, { sku: current.sku });
    return product;
  });
}

export async function adjustStock(id, quantityChange, reason, userId, db = prisma) {
  return db.$transaction(async (tx) => {
    // Compare-and-set with bounded retries avoids lost updates when two users
    // adjust the same stock concurrently. Ledger and audit writes roll back
    // with the stock write if either insert fails.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await tx.product.findUnique({ where: { id }, select: { id: true, sku: true, unit: true, stockQuantity: true, isActive: true } });
      if (!current) throw new ProductServiceError("Product not found", 404);
      if (!current.isActive) throw new ProductServiceError("Archived products cannot have stock adjusted", 409);

      const before = new Decimal(current.stockQuantity.toString());
      const change = new Decimal(quantityChange);
      if (isCountableUnit(current.unit) && !change.isInteger()) throw new ProductServiceError(`Fractional adjustments are not allowed for products measured in ${current.unit}. Enter a whole number quantity.`, 422);
      const after = before.plus(change);
      if (after.isNegative()) throw new ProductServiceError("Insufficient stock for this adjustment", 409);
      if (after.gt(STOCK_MAX)) throw new ProductServiceError("Stock quantity exceeds the supported limit", 422);

      const changed = await tx.product.updateMany({
        where: { id, isActive: true, stockQuantity: current.stockQuantity },
        data: { stockQuantity: after.toFixed(3) },
      });
      if (changed.count !== 1) continue;

      await stockLedger(tx, id, change.toFixed(3), reason);
      await audit(tx, userId, "INVENTORY_ADJUSTED", "Product", id, {
        sku: current.sku, quantityChange: change.toFixed(3), previousStock: before.toFixed(3), newStock: after.toFixed(3), reason,
      });
      return tx.product.findUnique({ where: { id }, include: { category: true } });
    }
    throw new ProductServiceError("Stock changed concurrently. Please retry the adjustment.", 409);
  }, { isolationLevel: "ReadCommitted" });
}

function mapUniqueError(error, message) {
  if (error?.code === "P2002") throw new ProductServiceError(message, 409);
  throw error;
}
