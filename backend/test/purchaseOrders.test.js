import test from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import { calculatePurchaseTotals, createPurchaseOrder, receivePurchaseOrderItems, changePurchaseOrderStatus, PurchaseOrderError } from "../src/services/purchaseOrderService.js";
import { goodsReceiptSchema, purchaseOrderCreateSchema, purchaseOrderListSchema } from "../src/schemas/purchaseOrders.js";

const orderInput = {
  supplierId: 4,
  additionalCharges: "2.00",
  expectedDelivery: "2026-12-01",
  remarks: "Test order",
  items: [
    { productId: 10, quantity: "2.500", unitPrice: "10.00", discountPercent: "10", taxRate: "18" },
    { productId: 11, quantity: "1", unitPrice: "5.00", discountPercent: "0", taxRate: "0" },
  ],
};

function clone(value) {
  if (Decimal.isDecimal(value)) return new Decimal(value.toString());
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}

function receivingDb({ status = "CONFIRMED", failAudit = false, ordered = "10.000" } = {}) {
  let store = {
    order: { id: 7, orderNumber: "PO-7", status, supplierId: 4, items: [{ id: 71, productId: 22, productName: "Test product", sku: "T-22", orderedQuantity: new Decimal(ordered), receivedQuantity: new Decimal("0.000") }] },
    products: [{ id: 22, stockQuantity: new Decimal("3.000") }], receipts: [], receiptItems: [], inventory: [], audits: [], nextReceipt: 1,
  };
  let queue = Promise.resolve();
  const db = {
    get state() { return store; },
    $transaction: async (callback) => {
      let release;
      const previous = queue;
      queue = new Promise((resolve) => { release = resolve; });
      await previous;
      const snapshot = clone(store);
      const tx = {
        $queryRaw: async () => [],
        purchaseOrder: {
          findUnique: async () => clone(store.order),
          update: async ({ data }) => { Object.assign(store.order, data); return clone(store.order); },
        },
        purchaseOrderItem: {
          update: async ({ where, data }) => { const item = store.order.items.find((row) => row.id === where.id); Object.assign(item, data, { receivedQuantity: new Decimal(data.receivedQuantity) }); return clone(item); },
        },
        product: {
          findUnique: async ({ where }) => clone(store.products.find((row) => row.id === where.id) || null),
          update: async ({ where, data }) => { const product = store.products.find((row) => row.id === where.id); product.stockQuantity = product.stockQuantity.plus(data.stockQuantity.increment); return clone(product); },
        },
        goodsReceipt: {
          findUnique: async ({ where }) => clone(store.receipts.find((row) => row.idempotencyKey === where.idempotencyKey) || null),
          create: async ({ data }) => {
            const receipt = { id: store.nextReceipt++, receiptNumber: data.receiptNumber, idempotencyKey: data.idempotencyKey, purchaseOrderId: data.purchaseOrderId, receivedById: data.receivedById, notes: data.notes, items: data.items.create.map((item, index) => ({ id: store.receiptItems.length + index + 1, ...item })) };
            store.receipts.push(receipt); store.receiptItems.push(...receipt.items); return clone(receipt);
          },
        },
        inventoryTransaction: { create: async ({ data }) => { const row = { id: store.inventory.length + 1, ...data }; store.inventory.push(row); return row; } },
        auditLog: { create: async ({ data }) => { if (failAudit) throw new Error("Injected audit failure"); const row = { id: store.audits.length + 1, ...data }; store.audits.push(row); return row; } },
      };
      try { return await callback(tx); } catch (error) { store = snapshot; throw error; } finally { release(); }
    },
  };
  return db;
}

test("purchase order schemas validate decimal line items, unique products and search filters", () => {
  assert.equal(purchaseOrderCreateSchema.safeParse(orderInput).success, true);
  assert.equal(purchaseOrderCreateSchema.safeParse({ ...orderInput, items: [{ ...orderInput.items[0], quantity: "0" }] }).success, false);
  assert.equal(purchaseOrderCreateSchema.safeParse({ ...orderInput, items: [orderInput.items[0], orderInput.items[0]] }).success, false);
  assert.equal(purchaseOrderCreateSchema.safeParse({ ...orderInput, items: [{ ...orderInput.items[0], discountPercent: "101" }] }).success, false);
  assert.equal(goodsReceiptSchema.safeParse({ idempotencyKey: "request-key-123", items: [{ purchaseOrderItemId: 71, quantity: "1.250" }] }).success, true);
  assert.equal(goodsReceiptSchema.safeParse({ idempotencyKey: "short", items: [{ purchaseOrderItemId: 71, quantity: "1" }] }).success, false);
  assert.equal(purchaseOrderListSchema.safeParse({ dateFrom: "2026-12-02", dateTo: "2026-12-01" }).success, false);
});

test("multi-line purchase totals use decimal rounding for discounts, tax and charges", () => {
  assert.deepEqual(calculatePurchaseTotals(orderInput.items, orderInput.additionalCharges), {
    subtotal: "30.00", discountTotal: "2.50", taxTotal: "4.05", additionalCharges: "2.00", totalAmount: "33.55",
  });
});

test("create snapshots active supplier/product data and persists authoritative totals", async () => {
  const state = { order: null, audits: [] };
  const db = { $transaction: (callback) => callback({
    supplier: { findUnique: async () => ({ id: 4, status: "ACTIVE" }) },
    product: { findMany: async () => [
      { id: 10, name: "Widget", sku: "W-10", description: "Snapshot description", purchasePrice: new Decimal("8.00"), taxRate: new Decimal("5"), isActive: true },
      { id: 11, name: "Gadget", sku: "G-11", description: null, purchasePrice: new Decimal("5.00"), taxRate: new Decimal("0"), isActive: true },
    ] },
    purchaseOrder: { create: async ({ data }) => { state.order = { id: 9, ...data, items: data.items.create }; return state.order; } },
    auditLog: { create: async ({ data }) => { state.audits.push(data); } },
  }) };
  const created = await createPurchaseOrder(orderInput, 5, db);
  assert.equal(created.orderNumber.startsWith("PO-"), true);
  assert.equal(created.items[0].productDescription, "Snapshot description");
  assert.equal(created.items[0].unitPrice, "10.00");
  assert.equal(created.subtotal, "30.00");
  assert.equal(created.totalAmount, "33.55");
  assert.equal(state.audits[0].action, "PURCHASE_ORDER_CREATED");
});

test("partial receipts increase only received stock, preserve history and replay idempotently", async () => {
  const db = receivingDb();
  const payload = { idempotencyKey: "delivery-key-001", items: [{ purchaseOrderItemId: 71, quantity: "4.000" }], notes: "First delivery" };
  const first = await receivePurchaseOrderItems(7, payload, 5, db);
  assert.equal(first.orderStatus, "PARTIALLY_RECEIVED");
  assert.equal(db.state.products[0].stockQuantity.toFixed(3), "7.000");
  assert.equal(db.state.inventory.length, 1);
  assert.equal(db.state.inventory[0].type, "PURCHASE_RECEIPT");
  const replay = await receivePurchaseOrderItems(7, payload, 5, db);
  assert.equal(replay.replayed, true);
  assert.equal(db.state.products[0].stockQuantity.toFixed(3), "7.000");
  const final = await receivePurchaseOrderItems(7, { idempotencyKey: "delivery-key-002", items: [{ purchaseOrderItemId: 71, quantity: "6.000" }] }, 5, db);
  assert.equal(final.orderStatus, "RECEIVED");
  assert.equal(db.state.products[0].stockQuantity.toFixed(3), "13.000");
  assert.equal(db.state.receipts.length, 2);
  assert.equal(db.state.inventory.reduce((sum, row) => sum + Number(row.quantityChange), 0), 10);
  assert.equal(db.state.audits.filter((row) => row.action === "PURCHASE_ORDER_RECEIPT_RECORDED").length, 2);
});

test("over-receiving and receipts on cancelled orders do not change stock", async () => {
  const db = receivingDb({ ordered: "5.000" });
  await assert.rejects(() => receivePurchaseOrderItems(7, { idempotencyKey: "delivery-key-003", items: [{ purchaseOrderItemId: 71, quantity: "5.001" }] }, 5, db), { status: 409 });
  assert.equal(db.state.products[0].stockQuantity.toFixed(3), "3.000");
  assert.equal(db.state.inventory.length, 0);
  const cancelled = receivingDb({ status: "CANCELLED" });
  await assert.rejects(() => receivePurchaseOrderItems(7, { idempotencyKey: "delivery-key-004", items: [{ purchaseOrderItemId: 71, quantity: "1.000" }] }, 5, cancelled), { status: 409 });
  assert.equal(cancelled.state.products[0].stockQuantity.toFixed(3), "3.000");
});

test("concurrent receipt retries cannot double increment stock", async () => {
  const db = receivingDb({ ordered: "5.000" });
  const payload = { idempotencyKey: "delivery-key-005", items: [{ purchaseOrderItemId: 71, quantity: "4.000" }] };
  const results = await Promise.all([receivePurchaseOrderItems(7, payload, 5, db), receivePurchaseOrderItems(7, payload, 5, db)]);
  assert.equal(results.filter((result) => result.replayed).length, 1);
  assert.equal(db.state.products[0].stockQuantity.toFixed(3), "7.000");
  assert.equal(db.state.inventory.length, 1);
});

test("receipt transaction rolls back stock, receipt and ledger if audit logging fails", async () => {
  const db = receivingDb({ failAudit: true });
  await assert.rejects(() => receivePurchaseOrderItems(7, { idempotencyKey: "delivery-key-006", items: [{ purchaseOrderItemId: 71, quantity: "2.000" }] }, 5, db), /Injected audit failure/);
  assert.equal(db.state.products[0].stockQuantity.toFixed(3), "3.000");
  assert.equal(db.state.order.items[0].receivedQuantity.toFixed(3), "0.000");
  assert.equal(db.state.receipts.length, 0);
  assert.equal(db.state.inventory.length, 0);
});

test("status transitions reject invalid moves and preserve received stock from cancellation", async () => {
  const db = receivingDb({ status: "RECEIVED" });
  await assert.rejects(() => changePurchaseOrderStatus(7, "CANCELLED", 5, db), (error) => error instanceof PurchaseOrderError && error.status === 409);
  assert.equal(db.state.order.status, "RECEIVED");
});
