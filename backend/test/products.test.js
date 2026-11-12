import test from "node:test";
import assert from "node:assert/strict";
import {
  archiveCategory, archiveProduct, adjustStock, createCategory, createProduct,
  getProduct, listCategories, updateCategory, updateProduct,
} from "../src/services/productService.js";
import { categoryCreateSchema, productCreateSchema, productUpdateSchema, stockAdjustmentSchema } from "../src/schemas/products.js";
import { authenticate, authorizePermission } from "../src/middleware/authMiddleware.js";

function memoryDb() {
  const state = { categories: [], products: [], inventory: [], audits: [], nextCategory: 1, nextProduct: 1, failLedger: false };
  const db = {};
  const category = {
    findMany: async ({ where = {}, select, include } = {}) => state.categories.filter((row) => (where.id?.not ? row.id !== where.id.not : true) && (where.isActive === undefined || row.isActive === where.isActive)).map((row) => ({ ...row, ...(include ? { _count: { products: state.products.filter((p) => p.categoryId === row.id).length } } : {}), ...(select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : {}) })),
    findUnique: async ({ where }) => state.categories.find((row) => row.id === where.id) ?? null,
    findFirst: async ({ where }) => state.categories.find((row) => row.id === where.id && (!where.isActive || row.isActive)) ?? null,
    create: async ({ data }) => {
      const row = { id: state.nextCategory++, ...data, isActive: true, createdAt: new Date(), updatedAt: new Date() };
      state.categories.push(row); return row;
    },
    update: async ({ where, data }) => {
      const row = state.categories.find((item) => item.id === where.id);
      if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
      Object.assign(row, data); return row;
    },
  };
  const product = {
    findUnique: async ({ where, select, include }) => {
      const row = state.products.find((item) => item.id === where.id);
      if (!row) return null;
      if (select) return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
      return { ...row, ...(include?.category ? { category: state.categories.find((item) => item.id === row.categoryId) ?? null } : {}), ...(include?.inventoryTransactions ? { inventoryTransactions: state.inventory.filter((item) => item.productId === row.id).slice(-100).reverse() } : {}) };
    },
    create: async ({ data, include }) => {
      if (state.products.some((row) => row.sku.toLowerCase() === data.sku.toLowerCase())) throw Object.assign(new Error("unique"), { code: "P2002" });
      const row = { id: state.nextProduct++, ...data, stockQuantity: String(data.stockQuantity ?? "0.000"), minStockLevel: String(data.minStockLevel ?? "0.000"), isActive: true, createdAt: new Date(), updatedAt: new Date() };
      state.products.push(row);
      return { ...row, ...(include?.category ? { category: state.categories.find((item) => item.id === row.categoryId) ?? null } : {}) };
    },
    update: async ({ where, data, include }) => {
      const row = state.products.find((item) => item.id === where.id);
      if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
      if (data.sku && state.products.some((item) => item.id !== row.id && item.sku.toLowerCase() === data.sku.toLowerCase())) throw Object.assign(new Error("unique"), { code: "P2002" });
      Object.assign(row, data);
      return { ...row, ...(include?.category ? { category: state.categories.find((item) => item.id === row.categoryId) ?? null } : {}) };
    },
    updateMany: async ({ where, data }) => {
      const row = state.products.find((item) => item.id === where.id && item.isActive === where.isActive && item.stockQuantity === String(where.stockQuantity));
      if (!row) return { count: 0 };
      Object.assign(row, data); return { count: 1 };
    },
  };
  const tx = {
    category,
    product,
    inventoryTransaction: { create: async ({ data }) => {
      if (state.failLedger) throw new Error("ledger insert failed");
      const row = { id: state.inventory.length + 1, ...data, createdAt: new Date() }; state.inventory.push(row); return row;
    } },
    auditLog: { create: async ({ data }) => { const row = { id: state.audits.length + 1, ...data, createdAt: new Date() }; state.audits.push(row); return row; } },
  };
  Object.assign(db, tx);
  db.product.count = async () => state.products.length;
  db.product.findMany = async () => state.products;
  db.$transaction = async (fn) => {
    const snapshot = structuredClone(state);
    try { return await fn(tx); }
    catch (error) { Object.assign(state, snapshot); throw error; }
  };
  db.state = state;
  return db;
}

const validProduct = (overrides = {}) => productCreateSchema.parse({
  name: "Precision wrench", sku: " wrench-01 ", unit: "each", purchasePrice: "10.25", sellingPrice: "15.75", ...overrides,
});

test("product creation schema validates required fields, decimal precision and opening-stock reason", () => {
  assert.equal(validProduct().sku, "WRENCH-01");
  assert.equal(productCreateSchema.safeParse({ name: "x", sku: "x", unit: "each", purchasePrice: "1.001", sellingPrice: "2" }).success, false);
  assert.equal(productCreateSchema.safeParse({ name: "x", sku: "x", unit: "each", purchasePrice: "1", sellingPrice: "2", stockQuantity: "3" }).success, false);
  const parsed = validProduct({ unit: "kg", stockQuantity: "3.125", stockReason: "Opening inventory" });
  assert.equal(parsed.stockQuantity, "3.125");
  const base = { name: "Tax test", sku: "TAX-TEST", unit: "each", purchasePrice: "1", sellingPrice: "2" };
  assert.equal(productCreateSchema.safeParse({ ...base, taxRate: "100" }).success, true);
  assert.equal(productCreateSchema.safeParse({ ...base, taxRate: "100.01" }).success, false);
  assert.equal(productUpdateSchema.safeParse({ taxRate: "100.01" }).success, false);
  assert.equal(productCreateSchema.safeParse({ ...base, unit: "pieces", stockQuantity: "2.5", stockReason: "Opening stock" }).success, false);
});

test("duplicate SKU is rejected without creating another product", async () => {
  const db = memoryDb();
  await createProduct(validProduct(), 7, db);
  await assert.rejects(() => createProduct(validProduct({ sku: "WRENCH-01" }), 7, db), { status: 409, message: "A product with this SKU already exists" });
  assert.equal(db.state.products.length, 1);
});

test("products can be updated and archived while keeping inventory history", async () => {
  const db = memoryDb();
  const product = await createProduct(validProduct({ stockQuantity: "4", stockReason: "Opening stock" }), 7, db);
  const updated = await updateProduct(product.id, productUpdateSchema.parse({ name: "Wrench set" }), 7, db);
  assert.equal(updated.name, "Wrench set");
  const archived = await archiveProduct(product.id, 7, db);
  assert.equal(archived.isActive, false);
  const details = await getProduct(product.id, db);
  assert.equal(details.inventoryTransactions.length, 1);
  assert.equal(details.inventoryTransactions[0].quantityChange, "4.000");
  assert.equal(db.state.audits.some((row) => row.action === "PRODUCT_ARCHIVED"), true);
});

test("categories support create, list, update and archive without deletion", async () => {
  const db = memoryDb();
  const category = await createCategory(categoryCreateSchema.parse({ name: "  Tools " }), 7, db);
  assert.equal(category.name, "Tools");
  assert.equal((await listCategories({}, db)).length, 1);
  const updated = await updateCategory(category.id, { description: "Workshop tools" }, 7, db);
  assert.equal(updated.description, "Workshop tools");
  const archived = await archiveCategory(category.id, 7, db);
  assert.equal(archived.isActive, false);
  assert.equal((await listCategories({}, db)).length, 0);
  assert.equal((await listCategories({ includeArchived: true }, db)).length, 1);
  await assert.rejects(() => createProduct(validProduct({ categoryId: category.id }), 7, db), { status: 422 });
  await assert.rejects(() => createCategory(categoryCreateSchema.parse({ name: " tools " }), 7, db), { status: 409 });
});

test("stock adjustment and ledger commit together; negative stock is rejected", async () => {
  const db = memoryDb();
  const product = await createProduct(validProduct({ unit: "kg", stockQuantity: "5", stockReason: "Opening stock" }), 7, db);
  const after = await adjustStock(product.id, "-2.125", "Cycle count correction", 7, db);
  assert.equal(after.stockQuantity, "2.875");
  assert.equal(db.state.inventory.length, 2);
  assert.equal(db.state.inventory[1].quantityChange, "-2.125");
  assert.equal(db.state.audits.at(-1).metadata.newStock, "2.875");
  await assert.rejects(() => adjustStock(product.id, "-3", "Damaged stock", 7, db), { status: 409 });
  assert.equal(db.state.products[0].stockQuantity, "2.875");
  assert.equal(db.state.inventory.length, 2);

  db.state.failLedger = true;
  await assert.rejects(() => adjustStock(product.id, "1", "Found stock", 7, db), /ledger insert failed/);
  assert.equal(db.state.products[0].stockQuantity, "2.875");
  assert.equal(db.state.inventory.length, 2);
});

test("countable-unit adjustments reject fractions while measured units accept them", async () => {
  const db = memoryDb();
  const pieces = await createProduct(validProduct({ sku: "PIECES-01" }), 7, db);
  const measured = await createProduct(validProduct({ sku: "WEIGHT-01", unit: "kg" }), 7, db);
  await assert.rejects(() => adjustStock(pieces.id, "5.059", "Count correction", 7, db), { status: 422, message: /whole number quantity/ });
  const adjusted = await adjustStock(measured.id, "5.059", "Scale correction", 7, db);
  assert.equal(adjusted.stockQuantity, "5.059");
  assert.equal(db.state.inventory.length, 1);
  await assert.rejects(() => createProduct({ ...validProduct(), sku: "PIECES-02", stockQuantity: "2.5", stockReason: "Opening count" }, 7, db), { status: 422, message: /Fractional quantities/ });
});

test("unit cannot be changed to a countable unit while fractional stock remains", async () => {
  const db = memoryDb();
  const product = await createProduct(validProduct({ unit: "kg", stockQuantity: "1.5", stockReason: "Opening weight" }), 7, db);
  await assert.rejects(() => updateProduct(product.id, { unit: "pieces" }, 7, db), { status: 422, message: /whole number first/ });
});

test("concurrent stock adjustments are retried without losing either ledger entry", async () => {
  const db = memoryDb();
  const product = await createProduct(validProduct({ stockQuantity: "5", stockReason: "Opening stock" }), 7, db);
  await Promise.all([
    adjustStock(product.id, "1", "Counted one unit", 7, db),
    adjustStock(product.id, "2", "Received two units", 8, db),
  ]);
  assert.equal(db.state.products[0].stockQuantity, "8.000");
  assert.equal(db.state.inventory.length, 3);
  assert.equal(db.state.audits.filter((row) => row.action === "INVENTORY_ADJUSTED").length, 2);
});

test("missing session is rejected and staff cannot write products", () => {
  let unauthorizedStatus;
  authenticate({ headers: {} }, { status(code) { unauthorizedStatus = code; return this; }, json() {} }, () => assert.fail("unauthenticated request passed"));
  assert.equal(unauthorizedStatus, 401);

  let forbiddenStatus;
  authorizePermission("products:write")({ user: { role: "STAFF" } }, { status(code) { forbiddenStatus = code; return this; }, json() {} }, () => assert.fail("staff write passed"));
  assert.equal(forbiddenStatus, 403);
});
