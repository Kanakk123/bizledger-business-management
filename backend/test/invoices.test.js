import test from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import { createPayment, invoicePdf, InvoiceError } from "../src/services/invoiceService.js";
import { invoiceListSchema, paymentCreateSchema } from "../src/schemas/invoices.js";

function database({ total = "100.00", dueDate = null, failAudit = false } = {}) {
  const store = { invoice: { id: 1, invoiceNumber: "SINV-1", type: "SALES", status: "UNPAID", totalAmount: new Decimal(total), paidAmount: new Decimal("0"), dueDate, payments: [] }, payments: [], audits: [], nextId: 1 };
  let queue = Promise.resolve();
  const db = { store, $transaction: async (callback) => {
    let unlock; const previous = queue; queue = new Promise((resolve) => { unlock = resolve; }); await previous;
    const beforeInvoice = { ...store.invoice, payments: [...store.invoice.payments] }, beforePayments = [...store.payments], beforeAudits = [...store.audits], beforeNextId = store.nextId;
    try { return await callback(tx); } catch (error) { Object.assign(store.invoice, beforeInvoice); store.payments = beforePayments; store.audits = beforeAudits; store.nextId = beforeNextId; throw error; } finally { unlock(); }
  } };
  const tx = {
    $queryRaw: async () => [],
    invoice: { findUnique: async () => ({ ...store.invoice, payments: [...store.payments] }), update: async ({ data }) => Object.assign(store.invoice, { ...data, ...(data.paidAmount ? { paidAmount: new Decimal(data.paidAmount) } : {}) }) },
    payment: {
      findUnique: async ({ where }) => store.payments.find((p) => p.idempotencyKey === where.idempotencyKey) || null,
      create: async ({ data }) => { const p = { id: store.nextId++, ...data, amount: new Decimal(data.amount), paymentDate: data.paymentDate }; store.payments.push(p); return p; },
    },
    auditLog: { create: async ({ data }) => { if (failAudit) throw new Error("audit failure"); store.audits.push(data); return data; } },
  };
  Object.assign(db, { invoice: { findUnique: async () => store.invoice }, payment: tx.payment, tx });
  const transact = db.$transaction; db.$transaction = async (callback) => transact(() => callback(tx));
  return db;
}

const paymentInput = (overrides = {}) => paymentCreateSchema.parse({ invoiceId: 1, amount: "40.00", method: "UPI", idempotencyKey: "request-key-0001", ...overrides });

test("invoice and payment schemas validate strict amounts, IDs and filters", () => {
  assert.equal(paymentInput({ amount: "0.01" }).amount, "0.01");
  assert.equal(paymentCreateSchema.safeParse({ ...paymentInput(), amount: "0.001" }).success, false);
  assert.equal(paymentCreateSchema.safeParse({ ...paymentInput(), amount: "-1" }).success, false);
  assert.equal(invoiceListSchema.safeParse({ dateFrom: "2026-12-30", dateTo: "2026-12-01" }).success, false);
});

test("payments record partial and full amounts, update invoice balance and audit atomically", async () => {
  const db = database();
  const first = await createPayment(paymentInput(), 9, db);
  assert.equal(first.invoice.paidAmount, "40.00"); assert.equal(first.invoice.outstandingAmount, "60.00"); assert.equal(first.invoice.status, "PARTIALLY_PAID");
  const second = await createPayment(paymentInput({ amount: "60.00", idempotencyKey: "request-key-0002" }), 9, db);
  assert.equal(second.invoice.outstandingAmount, "0.00"); assert.equal(second.invoice.status, "PAID");
  assert.equal(db.store.audits.length, 4);
});

test("payment idempotency prevents duplicate records and excessive payment is rejected", async () => {
  const db = database();
  await createPayment(paymentInput(), 9, db);
  const replay = await createPayment(paymentInput(), 9, db);
  assert.equal(replay.replayed, true); assert.equal(db.store.payments.length, 1);
  await assert.rejects(createPayment(paymentInput({ method: "CASH" }), 9, db), (e) => e instanceof InvoiceError && e.status === 409);
  await assert.rejects(createPayment(paymentInput({ amount: "60.01", idempotencyKey: "request-key-0002" }), 9, db), (e) => e instanceof InvoiceError && e.status === 409);
});

test("serialized concurrent payments cannot exceed invoice total", async () => {
  const db = database();
  const results = await Promise.allSettled([
    createPayment(paymentInput({ amount: "70", idempotencyKey: "request-key-0001" }), 9, db),
    createPayment(paymentInput({ amount: "70", idempotencyKey: "request-key-0002" }), 9, db),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.status, 409);
  assert.equal(db.store.invoice.paidAmount.toString(), "70");
});

test("audit failure rolls back payment and invoice balance", async () => {
  const db = database({ failAudit: true });
  await assert.rejects(createPayment(paymentInput(), 9, db));
  assert.equal(db.store.payments.length, 0); assert.equal(db.store.invoice.paidAmount.toString(), "0");
});

test("PDF uses persisted invoice values and paginates longer invoices", async () => {
  const invoice = {
    id: 1, invoiceNumber: "SINV-TEST", type: "SALES", invoiceDate: new Date("2026-11-12T00:00:00Z"), dueDate: null,
    partnerName: "Snapshot Buyer", partnerCompany: "Snapshot Co", partnerAddress: "1 Test Road", partnerTaxId: "GST-TEST",
    subtotal: new Decimal("60.00"), discountTotal: new Decimal("0"), taxTotal: new Decimal("0"), additionalCharges: new Decimal("0"),
    totalAmount: new Decimal("60.00"), notes: "Persisted note", paymentTerms: "Net 30", payments: [],
    items: Array.from({ length: 60 }, (_, i) => ({ id: i + 1, productName: `Product ${i}`, sku: `SKU-${i}`, description: "Persisted description", quantity: new Decimal("1.000"), unitPrice: new Decimal("1.00"), discountAmount: new Decimal("0"), taxAmount: new Decimal("0"), lineTotal: new Decimal("1.00") })),
    salesOrder: { buyer: { name: "Current Buyer" } }, purchaseOrder: null,
  };
  const { buffer } = await invoicePdf(1, { invoice: { findUnique: async () => invoice } });
  const pdf = buffer.toString("ascii");
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.match(pdf, /\/Count 2/);
  assert.match(pdf, /Snapshot Buyer/);
  assert.match(pdf, /Persisted description/);
  assert.match(pdf, /60\.00/);
  assert.match(pdf, /Net 30/);
});
