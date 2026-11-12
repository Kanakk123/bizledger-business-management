import test from "node:test";
import assert from "node:assert/strict";
import { archivePartner, createPartner, getPartner, listPartners, updatePartner } from "../src/services/partnerService.js";
import { buyerCreateSchema, partnerListQuerySchema, supplierCreateSchema, supplierUpdateSchema } from "../src/schemas/partners.js";
import { authorizePermission } from "../src/middleware/authMiddleware.js";

function memoryDb() {
  const state = { supplier: [], buyer: [], audits: [], next: { supplier: 1, buyer: 1 } };
  const db = {};
  for (const kind of ["supplier", "buyer"]) {
    db[kind] = {
      findMany: async ({ where = {}, include } = {}) => state[kind].filter((record) => {
        if (where.status && record.status !== where.status) return false;
        if (where.id?.not && record.id === where.id.not) return false;
        if (where.OR && !where.OR.some((filter) => Object.entries(filter).some(([field, condition]) => String(record[field] ?? "").toLowerCase().includes(condition.contains.toLowerCase())))) return false;
        return true;
      }).map((record) => ({ ...record, ...(include?._count ? { _count: { purchaseOrders: record.purchaseOrders?.length ?? 0, salesOrders: record.salesOrders?.length ?? 0 } } : {}) })),
      count: async ({ where = {} } = {}) => (await db[kind].findMany({ where })).length,
      findUnique: async ({ where, include }) => {
        const record = state[kind].find((item) => item.id === where.id);
        if (!record) return null;
        const relation = kind === "supplier" ? "purchaseOrders" : "salesOrders";
        return { ...record, ...(include?.[relation] ? { [relation]: record[relation] ?? [] } : {}) };
      },
      create: async ({ data }) => { const record = { id: state.next[kind]++, ...data, createdAt: new Date(), updatedAt: new Date() }; state[kind].push(record); return record; },
      update: async ({ where, data }) => {
        const record = state[kind].find((item) => item.id === where.id);
        if (!record) throw Object.assign(new Error("not found"), { code: "P2025" });
        Object.assign(record, data); return record;
      },
    };
  }
  const tx = { ...db, auditLog: { create: async ({ data }) => { const row = { id: state.audits.length + 1, ...data }; state.audits.push(row); return row; } } };
  Object.assign(db, tx);
  db.$transaction = async (run) => {
    const snapshot = structuredClone(state);
    try { return await run(tx); }
    catch (error) { Object.assign(state, snapshot); throw error; }
  };
  db.state = state;
  return db;
}

const validSupplier = (overrides = {}) => supplierCreateSchema.parse({ name: "Aster Supply", companyName: "Aster Industrial", email: "BUYING@ASTER.EXAMPLE", phone: "+91 98765 43210", taxRegistration: "22AAAAA0000A1Z5", address: "10 Market Road", city: "Pune", paymentTerms: "Net 30", ...overrides });
const validBuyer = (overrides = {}) => buyerCreateSchema.parse({ name: "Morgan Lee", companyName: "Northwind Stores", email: "morgan@example.com", phone: "98765 43210", billingAddress: "1 Billing Lane", shippingAddress: "2 Shipping Lane", city: "Mumbai", country: "India", ...overrides });

test("supplier and buyer validation normalizes optional fields and validates email, phone, and GSTIN", () => {
  const supplier = validSupplier({ email: "BUYING@ASTER.EXAMPLE", notes: "  " });
  assert.equal(supplier.email, "buying@aster.example");
  assert.equal(supplier.notes, null);
  assert.equal(supplier.taxRegistration, "22AAAAA0000A1Z5");
  assert.equal(supplierCreateSchema.safeParse({ name: "Supplier", email: "not-an-email" }).success, false);
  assert.equal(supplierCreateSchema.safeParse({ name: "Supplier", phone: "1234" }).success, false);
  assert.equal(supplierCreateSchema.safeParse({ name: "Supplier", taxRegistration: "NOT-A-GSTIN" }).success, false);
  assert.equal(buyerCreateSchema.safeParse({ name: "Buyer", billingAddress: "Billing", shippingAddress: "Shipping" }).success, true);
});

test("suppliers and buyers support create, list filters, edit, detail history, and soft archive", async () => {
  const db = memoryDb();
  const supplier = await createPartner("supplier", validSupplier(), 11, db);
  const buyer = await createPartner("buyer", validBuyer(), 11, db);
  db.state.supplier[0].purchaseOrders = [{ id: 71, orderNumber: "PO-71", totalAmount: "80.00", invoice: { invoiceNumber: "INV-P71", payments: [{ id: 91, amount: "20.00" }] } }];
  db.state.buyer[0].salesOrders = [{ id: 81, orderNumber: "SO-81", totalAmount: "50.00", invoice: { invoiceNumber: "INV-S81", payments: [] } }];

  assert.equal((await listPartners("supplier", partnerListQuerySchema.parse({ search: "aster" }), db)).pagination.total, 1);
  assert.equal((await listPartners("buyer", partnerListQuerySchema.parse({ status: "INACTIVE" }), db)).pagination.total, 0);
  const updatedSupplier = await updatePartner("supplier", supplier.id, supplierUpdateSchema.parse({ paymentTerms: "Net 45" }), 11, db);
  assert.equal(updatedSupplier.paymentTerms, "Net 45");
  assert.equal((await getPartner("supplier", supplier.id, db)).purchaseOrders[0].invoice.payments[0].amount, "20.00");
  assert.equal((await getPartner("buyer", buyer.id, db)).salesOrders[0].orderNumber, "SO-81");

  assert.equal((await archivePartner("supplier", supplier.id, 11, db)).status, "INACTIVE");
  assert.equal((await archivePartner("buyer", buyer.id, 11, db)).status, "INACTIVE");
  assert.equal((await listPartners("supplier", partnerListQuerySchema.parse({ status: "ACTIVE" }), db)).pagination.total, 0);
  const inactive = await listPartners("supplier", partnerListQuerySchema.parse({ status: "INACTIVE" }), db);
  assert.equal(inactive.items[0].id, supplier.id);
  assert.equal((await getPartner("supplier", supplier.id, db)).purchaseOrders.length, 1);
  assert.equal(db.state.audits.filter((entry) => entry.action.endsWith("_ARCHIVED")).length, 2);
});

test("duplicate identity is rejected but shared contacts and different companies are allowed", async () => {
  const db = memoryDb();
  await createPartner("supplier", validSupplier(), 11, db);
  await assert.rejects(() => createPartner("supplier", validSupplier({ email: "another-contact@example.com" }), 11, db), { status: 409 });
  const otherCompany = await createPartner("supplier", validSupplier({ companyName: "Different Industrial", email: "BUYING@ASTER.EXAMPLE" }), 11, db);
  const sharedContact = await createPartner("buyer", validBuyer({ name: "Another Buyer", companyName: "Another Company", email: "morgan@example.com" }), 11, db);
  assert.ok(otherCompany.id);
  assert.ok(sharedContact.id);
});

test("inactive records cannot be edited and unknown partner IDs return not found", async () => {
  const db = memoryDb();
  const supplier = await createPartner("supplier", validSupplier(), 11, db);
  await archivePartner("supplier", supplier.id, 11, db);
  await assert.rejects(() => updatePartner("supplier", supplier.id, { name: "Aster Supply Updated" }, 11, db), { status: 409 });
  await assert.rejects(() => getPartner("buyer", 999, db), { status: 404 });
});

test("STAFF can read suppliers and buyers but cannot write either resource", () => {
  for (const permission of ["suppliers:write", "buyers:write"]) {
    let status;
    authorizePermission(permission)({ user: { role: "STAFF" } }, { status(code) { status = code; return this; }, json() {} }, () => assert.fail("STAFF write unexpectedly passed"));
    assert.equal(status, 403);
  }
  for (const permission of ["suppliers:read", "buyers:read"]) {
    let passed = false;
    authorizePermission(permission)({ user: { role: "STAFF" } }, {}, () => { passed = true; });
    assert.equal(passed, true);
  }
});
