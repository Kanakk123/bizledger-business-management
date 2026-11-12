import test from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import { calculateSalesTotals, createSalesOrder, fulfillSalesOrder, returnSalesOrderItems, changeSalesOrderStatus } from "../src/services/salesOrderService.js";
import { salesFulfillmentSchema, salesOrderCreateSchema, salesOrderListSchema, salesReturnSchema } from "../src/schemas/salesOrders.js";

const input = {
  buyerId: 6, shippingCharges: "3.25", expectedDelivery: "2026-12-02", remarks: "Sales test",
  items: [
    { productId: 31, quantity: "2.500", unitPrice: "20.00", discountPercent: "10", taxRate: "18" },
    { productId: 32, quantity: "1", unitPrice: "5.00", discountPercent: "0", taxRate: "0" },
  ],
};

function clone(value) {
  if (Decimal.isDecimal(value)) return new Decimal(value.toString());
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}

function salesDb({ status = "CONFIRMED", failAudit = false, quantity = "10.000", stock = "6.000" } = {}) {
  let state = {
    order: { id: 8, orderNumber: "SO-8", status, buyerId: 6, items: [{ id: 81, productId: 31, productName: "Sale item", sku: "S-31", quantity: new Decimal(quantity), fulfilledQuantity: new Decimal("0"), returnedQuantity: new Decimal("0") }] },
    products: [{ id: 31, isActive: true, stockQuantity: new Decimal(stock) }], fulfillments: [], returns: [], inventory: [], audits: [], nextId: 1,
  };
  let queue = Promise.resolve();
  const db = {
    get state() { return state; },
    $transaction: async (callback) => {
      let release;
      const previous = queue;
      queue = new Promise((resolve) => { release = resolve; });
      await previous;
      const snapshot = clone(state);
      const tx = {
        $queryRaw: async () => [],
        salesOrder: { findUnique: async () => clone(state.order), update: async ({ data }) => { Object.assign(state.order, data); return clone(state.order); } },
        salesOrderItem: { update: async ({ where, data }) => { const item = state.order.items.find((row) => row.id === where.id); Object.assign(item, Object.fromEntries(Object.entries(data).map(([key, value]) => [key, key.endsWith("Quantity") ? new Decimal(value) : value]))); return clone(item); } },
        product: {
          findUnique: async ({ where }) => clone(state.products.find((row) => row.id === where.id) || null),
          updateMany: async ({ where, data }) => { const product = state.products.find((row) => row.id === where.id); if (!product?.isActive || product.stockQuantity.lt(where.stockQuantity.gte)) return { count: 0 }; product.stockQuantity = product.stockQuantity.minus(data.stockQuantity.decrement); return { count: 1 }; },
          update: async ({ where, data }) => { const product = state.products.find((row) => row.id === where.id); product.stockQuantity = product.stockQuantity.plus(data.stockQuantity.increment); return clone(product); },
        },
        salesFulfillment: {
          findUnique: async ({ where }) => clone(state.fulfillments.find((row) => row.idempotencyKey === where.idempotencyKey) || null),
          create: async ({ data }) => { const row = { id: state.nextId++, ...data, items: data.items.create.map((item) => ({ id: state.inventory.length + item.salesOrderItemId, ...item })) }; state.fulfillments.push(row); return clone(row); },
        },
        salesReturn: {
          findUnique: async ({ where }) => clone(state.returns.find((row) => row.idempotencyKey === where.idempotencyKey) || null),
          create: async ({ data }) => { const row = { id: state.nextId++, ...data, items: data.items.create.map((item) => ({ id: state.returns.length + item.salesOrderItemId, ...item })) }; state.returns.push(row); return clone(row); },
        },
        inventoryTransaction: { create: async ({ data }) => { const row = { id: state.inventory.length + 1, ...data }; state.inventory.push(row); return row; } },
        auditLog: { create: async ({ data }) => { if (failAudit) throw new Error("Injected audit failure"); const row = { id: state.audits.length + 1, ...data }; state.audits.push(row); return row; } },
      };
      try { return await callback(tx); } catch (error) { state = snapshot; throw error; } finally { release(); }
    },
  };
  return db;
}

test("sales order schema validates decimal items and filters", () => {
  assert.equal(salesOrderCreateSchema.safeParse(input).success, true);
  assert.equal(salesOrderCreateSchema.safeParse({ ...input, items: [{ ...input.items[0], quantity: "0" }] }).success, false);
  assert.equal(salesOrderCreateSchema.safeParse({ ...input, items: [input.items[0], input.items[0]] }).success, false);
  assert.equal(salesFulfillmentSchema.safeParse({ idempotencyKey: "fulfill-key-001", items: [{ salesOrderItemId: 81, quantity: "1.250" }] }).success, true);
  assert.equal(salesReturnSchema.safeParse({ idempotencyKey: "return-key-001", reason: "Damaged", items: [{ salesOrderItemId: 81, quantity: "1" }] }).success, true);
  assert.equal(salesOrderListSchema.safeParse({ dateFrom: "2026-12-10", dateTo: "2026-12-01" }).success, false);
});

test("multi-item total uses Decimal discounts, tax and shipping", () => {
  assert.deepEqual(calculateSalesTotals(input.items, input.shippingCharges), {
    subtotal: "55.00", discountTotal: "5.00", taxTotal: "8.10", shippingCharges: "3.25", totalAmount: "61.35",
  });
});

test("tax rate inputs are percentages and round correctly for 0, 5, 6 and 18 percent", () => {
  for (const [rate, expectedTax, expectedTotal] of [["0", "0.00", "4000.00"], ["5", "200.00", "4200.00"], ["6", "240.00", "4240.00"], ["18", "720.00", "4720.00"]]) {
    const result = calculateSalesTotals([{ quantity: "5", unitPrice: "800", discountPercent: "0", taxRate: rate }]);
    assert.equal(result.taxTotal, expectedTax);
    assert.equal(result.totalAmount, expectedTotal);
  }
  const fractionalPercentage = calculateSalesTotals([{ quantity: "5", unitPrice: "800", discountPercent: "0", taxRate: "0.06" }]);
  assert.equal(fractionalPercentage.taxTotal, "2.40");
  assert.equal(fractionalPercentage.totalAmount, "4002.40");
});

test("create snapshots active buyer/products and calculates totals on the server", async () => {
  const state = { order: null, audits: [] };
  const db = { $transaction: (callback) => callback({
    buyer: { findUnique: async () => ({ id: 6, status: "ACTIVE" }) },
    product: { findMany: async () => [
      { id: 31, name: "Widget", sku: "W-31", description: "Product snapshot", sellingPrice: new Decimal("15.00"), taxRate: new Decimal("5") },
      { id: 32, name: "Cable", sku: "C-32", description: null, sellingPrice: new Decimal("5.00"), taxRate: new Decimal("0") },
    ] },
    salesOrder: { create: async ({ data }) => { state.order = { id: 10, ...data, items: data.items.create }; return state.order; } },
    auditLog: { create: async ({ data }) => { state.audits.push(data); } },
  }) };
  const order = await createSalesOrder(input, 3, db);
  assert.ok(order.orderNumber.startsWith("SO-"));
  assert.equal(order.items[0].productDescription, "Product snapshot");
  assert.equal(order.items[0].unitPrice, "20.00");
  assert.equal(order.totalAmount, "61.35");
  assert.equal(state.audits[0].action, "SALES_ORDER_CREATED");
});

test("partial fulfillment deducts stock once, records ledger, and delivers when complete", async () => {
  const db = salesDb({ quantity: "5.000", stock: "8.000" });
  const firstPayload = { idempotencyKey: "fulfill-key-101", items: [{ salesOrderItemId: 81, quantity: "2.000" }] };
  const first = await fulfillSalesOrder(8, firstPayload, 4, db);
  assert.equal(first.orderStatus, "PROCESSING");
  assert.equal(db.state.products[0].stockQuantity.toFixed(3), "6.000");
  assert.equal(db.state.inventory[0].type, "SALE_FULFILLMENT");
  assert.equal(db.state.inventory[0].quantityChange, "-2.000");
  const retry = await fulfillSalesOrder(8, firstPayload, 4, db);
  assert.equal(retry.replayed, true);
  assert.equal(db.state.products[0].stockQuantity.toFixed(3), "6.000");
  const final = await fulfillSalesOrder(8, { idempotencyKey: "fulfill-key-102", items: [{ salesOrderItemId: 81, quantity: "3.000" }] }, 4, db);
  assert.equal(final.orderStatus, "DELIVERED");
  assert.equal(db.state.products[0].stockQuantity.toFixed(3), "3.000");
  assert.equal(db.state.fulfillments.length, 2);
  assert.equal(db.state.audits.filter((row) => row.action === "SALES_ORDER_FULFILLED").length, 2);
});

test("fulfillment prevents overselling and competing requests cannot over-deduct", async () => {
  const db = salesDb({ quantity: "5.000", stock: "6.000" });
  const requests = ["race-key-111", "race-key-112"].map((key) => fulfillSalesOrder(8, { idempotencyKey: key, items: [{ salesOrderItemId: 81, quantity: "4.000" }] }, 4, db));
  const result = await Promise.allSettled(requests);
  assert.equal(result.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(result.filter((row) => row.status === "rejected" && row.reason.status === 409).length, 1);
  assert.equal(db.state.products[0].stockQuantity.toFixed(3), "2.000");
  assert.equal(db.state.inventory.length, 1);
  await assert.rejects(() => fulfillSalesOrder(8, { idempotencyKey: "over-key-113", items: [{ salesOrderItemId: 81, quantity: "2.000" }] }, 4, db), { status: 409 });
  assert.equal(db.state.products[0].stockQuantity.toFixed(3), "2.000");
});

test("returns restore only fulfilled stock once and cannot exceed outstanding fulfilled quantity", async () => {
  const db = salesDb({ status: "DELIVERED", quantity: "5.000", stock: "1.000" });
  db.state.order.items[0].fulfilledQuantity = new Decimal("5.000");
  const payload = { idempotencyKey: "return-key-201", reason: "Damaged package", items: [{ salesOrderItemId: 81, quantity: "2.000" }] };
  const first = await returnSalesOrderItems(8, payload, 4, db);
  assert.equal(first.replayed, false);
  assert.equal(db.state.products[0].stockQuantity.toFixed(3), "3.000");
  assert.equal(db.state.inventory[0].type, "SALE_RETURN");
  const retry = await returnSalesOrderItems(8, payload, 4, db);
  assert.equal(retry.replayed, true);
  assert.equal(db.state.products[0].stockQuantity.toFixed(3), "3.000");
  await assert.rejects(() => returnSalesOrderItems(8, { idempotencyKey: "return-key-202", reason: "Extra", items: [{ salesOrderItemId: 81, quantity: "4.000" }] }, 4, db), { status: 409 });
  assert.equal(db.state.products[0].stockQuantity.toFixed(3), "3.000");
});

test("cancellation does not touch stock and is blocked after fulfillment", async () => {
  const fresh = salesDb({ status: "NEW" });
  await changeSalesOrderStatus(8, "CANCELLED", 4, fresh);
  assert.equal(fresh.state.order.status, "CANCELLED");
  assert.equal(fresh.state.products[0].stockQuantity.toFixed(3), "6.000");
  const fulfilled = salesDb({ status: "PROCESSING" });
  fulfilled.state.order.items[0].fulfilledQuantity = new Decimal("1.000");
  await assert.rejects(() => changeSalesOrderStatus(8, "CANCELLED", 4, fulfilled), { status: 409 });
  assert.equal(fulfilled.state.order.status, "PROCESSING");
});

test("fulfillment transaction rolls back all writes when audit logging fails", async () => {
  const db = salesDb({ failAudit: true, quantity: "5.000", stock: "8.000" });
  await assert.rejects(() => fulfillSalesOrder(8, { idempotencyKey: "rollback-key-301", items: [{ salesOrderItemId: 81, quantity: "2.000" }] }, 4, db), /Injected audit failure/);
  assert.equal(db.state.products[0].stockQuantity.toFixed(3), "8.000");
  assert.equal(db.state.order.items[0].fulfilledQuantity.toFixed(3), "0.000");
  assert.equal(db.state.fulfillments.length, 0);
  assert.equal(db.state.inventory.length, 0);
});
