import test from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import { getReport, toCsv } from "../src/services/analyticsService.js";
import { analyticsQuerySchema, dashboardQuerySchema, reportQuerySchema } from "../src/schemas/analytics.js";

test("analytics and report filters validate date windows, grouping and report categories", () => {
  assert.equal(analyticsQuerySchema.parse({ groupBy: "weekly" }).groupBy, "weekly");
  assert.equal(analyticsQuerySchema.safeParse({ groupBy: "yearly" }).success, false);
  assert.equal(dashboardQuerySchema.safeParse({ dateFrom: "2026-12-30", dateTo: "2026-12-01" }).success, false);
  assert.equal(reportQuerySchema.safeParse({ type: "unknown" }).success, false);
});

test("sales report preserves canceled rows but excludes them from financial summary and paginates", async () => {
  const rows = [
    { id: 1, orderNumber: "SO-1", status: "DELIVERED", orderDate: new Date("2026-11-10T12:00:00Z"), totalAmount: new Decimal("500"), buyerId: 1, buyer: { name: "Buyer One", companyName: null }, items: [{ quantity: new Decimal("5"), returnedQuantity: new Decimal("1"), lineTotal: new Decimal("500") }] },
    { id: 2, orderNumber: "SO-CANCEL", status: "CANCELLED", orderDate: new Date("2026-11-11T12:00:00Z"), totalAmount: new Decimal("999"), buyerId: 2, buyer: { name: "Buyer Two", companyName: null }, items: [] },
    { id: 3, orderNumber: "SO-PENDING", status: "CONFIRMED", orderDate: new Date("2026-11-09T12:00:00Z"), totalAmount: new Decimal("800"), buyerId: 3, buyer: { name: "Buyer Three", companyName: null }, items: [] },
  ];
  const db = { salesOrder: { findMany: async ({ where }) => rows.filter((r) => r.orderDate >= where.orderDate.gte && r.orderDate < where.orderDate.lt) } };
  const filters = reportQuerySchema.parse({ type: "sales", dateFrom: "2026-11-01", dateTo: "2026-11-30", page: 1, pageSize: 1, status: "ALL", search: "", sortBy: "date", sortOrder: "desc" });
  const report = await getReport(filters, db);
  assert.equal(report.summary.count, 3);
  assert.equal(report.summary.amount, "400.00");
  assert.equal(report.items.length, 1);
  assert.equal(report.pagination.total, 3);
  assert.equal(report.items[0].status, "CANCELLED");
});

test("low-stock report uses current stock and CSV neutralizes formula injection", async () => {
  const db = { product: { findMany: async () => [
    { id: 1, name: "=2+2", sku: "A", unit: "each", stockQuantity: new Decimal("0"), minStockLevel: new Decimal("1"), updatedAt: new Date("2026-11-12T00:00:00Z") },
    { id: 2, name: "Normal", sku: "B", unit: "each", stockQuantity: new Decimal("4"), minStockLevel: new Decimal("3"), updatedAt: new Date("2026-11-12T00:00:00Z") },
  ] } };
  const filters = reportQuerySchema.parse({ type: "low-stock", search: "", status: "ALL", page: 1, pageSize: 20, sortBy: "date", sortOrder: "desc" });
  const report = await getReport(filters, db);
  assert.equal(report.summary.count, 1);
  assert.equal(report.items[0].status, "OUT_OF_STOCK");
  const csv = toCsv({ items: [{ name: "=2+2", note: "@malicious", ordinary: "safe" }] });
  assert.match(csv, /"'=2\+2"/); // Formula leaders are apostrophe-prefixed within a quoted CSV cell.
  assert.match(csv, /'@malicious/);
});

test("partner transaction reports separate order value from actual payments", async () => {
  const now = new Date();
  const supplier = { id: 5, name: "North Supply", companyName: null };
  const db = {
    purchaseOrder: { findMany: async () => [{ id: 9, orderNumber: "PO-9", status: "RECEIVED", orderDate: now, totalAmount: new Decimal("100.00"), supplierId: 5, supplier, items: [] }] },
    payment: { findMany: async () => [{ id: 14, paymentDate: now, amount: new Decimal("25.00"), method: "UPI", transactionReference: "P-14", invoice: { invoiceNumber: "PINV-9", partnerName: supplier.name, purchaseOrder: { supplier }, salesOrder: null } }] },
  };
  const today = now.toISOString().slice(0, 10);
  const filters = reportQuerySchema.parse({ type: "supplier-transactions", supplierId: 5, dateFrom: today, dateTo: today });
  const report = await getReport(filters, db);
  assert.equal(report.summary.count, 2);
  assert.equal(report.summary.amount, "100.00");
  assert.equal(report.summary.paymentAmount, "25.00");
  assert.deepEqual(report.items.map((x) => x.transactionKind).sort(), ["ORDER", "PAYMENT"]);
});

test("payment reports derive fully paid and overdue status from payment records", async () => {
  const now = new Date();
  const paidInvoice = { id: 1, invoiceNumber: "PAID-1", type: "SALES", partnerName: "Buyer", totalAmount: new Decimal("100"), dueDate: new Date("2020-01-01"), payments: [{ amount: new Decimal("100") }], status: "OVERDUE", salesOrder: { buyer: { name: "Buyer" } }, purchaseOrder: null };
  const overdueInvoice = { id: 2, invoiceNumber: "OVERDUE-2", type: "PURCHASE", partnerName: "Supplier", totalAmount: new Decimal("100"), dueDate: new Date("2020-01-01"), payments: [{ amount: new Decimal("25") }], status: "PARTIALLY_PAID", salesOrder: null, purchaseOrder: { supplier: { name: "Supplier" } } };
  const db = { payment: { findMany: async () => [
    { id: 1, invoiceId: 1, paymentDate: now, amount: new Decimal("100"), method: "CASH", transactionReference: null, invoice: paidInvoice },
    { id: 2, invoiceId: 2, paymentDate: now, amount: new Decimal("25"), method: "UPI", transactionReference: null, invoice: overdueInvoice },
  ] } };
  const today = now.toISOString().slice(0, 10);
  const filters = reportQuerySchema.parse({ type: "payments", status: "OVERDUE", dateFrom: today, dateTo: today });
  const report = await getReport(filters, db);
  assert.equal(report.pagination.total, 1);
  assert.equal(report.items[0].status, "OVERDUE");
  assert.equal(report.items[0].invoiceId, 2);
  assert.equal(report.summary.amount, "25.00");
});
