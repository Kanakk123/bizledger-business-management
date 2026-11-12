import Decimal from "decimal.js";
import { prisma } from "../config/prisma.js";

const dec = (v) => new Decimal(v ?? 0);
const cents = (v) => dec(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const invoiceInclude = {
  items: { orderBy: { id: "asc" } }, payments: { orderBy: [{ paymentDate: "desc" }, { id: "desc" }] },
  purchaseOrder: { include: { supplier: true, items: true } }, salesOrder: { include: { buyer: true, items: true } },
};
export class InvoiceError extends Error {
  constructor(message, status = 400) { super(message); this.name = "InvoiceError"; this.status = status; }
}
const audit = (tx, userId, action, entity, id, metadata) => tx.auditLog.create({ data: { userId, action, entity, entityId: String(id), metadata } });

function present(invoice, now = new Date()) {
  const paid = cents(invoice.payments.reduce((sum, p) => sum.plus(p.amount.toString()), new Decimal(0)));
  const due = cents(dec(invoice.totalAmount).minus(paid));
  let status = paid.gte(invoice.totalAmount.toString()) ? "PAID" : paid.gt(0) ? "PARTIALLY_PAID" : "UNPAID";
  if (!due.isZero() && invoice.dueDate && new Date(invoice.dueDate) < new Date(now.toISOString().slice(0, 10))) status = "OVERDUE";
  return { ...invoice, paidAmount: paid.toFixed(2), outstandingAmount: due.toFixed(2), status };
}

export async function listInvoices(filters, db = prisma) {
  const invoiceDate = {};
  if (filters.dateFrom) invoiceDate.gte = new Date(`${filters.dateFrom}T00:00:00.000Z`);
  if (filters.dateTo) { invoiceDate.lt = new Date(`${filters.dateTo}T00:00:00.000Z`); invoiceDate.lt.setUTCDate(invoiceDate.lt.getUTCDate() + 1); }
  const where = {
    ...(filters.type !== "ALL" ? { type: filters.type } : {}),
    ...(filters.supplierId ? { purchaseOrder: { supplierId: filters.supplierId } } : {}),
    ...(filters.buyerId ? { salesOrder: { buyerId: filters.buyerId } } : {}),
    ...(Object.keys(invoiceDate).length ? { invoiceDate } : {}),
    ...(filters.search ? { OR: [{ invoiceNumber: { contains: filters.search } }, { purchaseOrder: { supplier: { name: { contains: filters.search } } } }, { purchaseOrder: { supplier: { companyName: { contains: filters.search } } } }, { salesOrder: { buyer: { name: { contains: filters.search } } } }, { salesOrder: { buyer: { companyName: { contains: filters.search } } } }] } : {}),
  };
  const rows = await db.invoice.findMany({ where, include: invoiceInclude, orderBy: [{ invoiceDate: "desc" }, { id: "desc" }] });
  const all = rows.map((r) => present(r)).filter((r) => filters.status === "ALL" || r.status === filters.status);
  const offset = (filters.page - 1) * filters.pageSize;
  return { items: all.slice(offset, offset + filters.pageSize), pagination: { page: filters.page, pageSize: filters.pageSize, total: all.length, totalPages: Math.ceil(all.length / filters.pageSize) } };
}

export async function getInvoice(id, db = prisma) {
  const invoice = await db.invoice.findUnique({ where: { id }, include: invoiceInclude });
  if (!invoice) throw new InvoiceError("Invoice not found", 404);
  return present(invoice);
}

export async function updateInvoiceMetadata(id, data, userId, db = prisma) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${id} FOR UPDATE`;
    const current = await tx.invoice.findUnique({ where: { id }, include: { payments: true } });
    if (!current) throw new InvoiceError("Invoice not found", 404);
    const updated = await tx.invoice.update({ where: { id }, data: { ...(data.dueDate !== undefined ? { dueDate: data.dueDate ? new Date(`${data.dueDate}T00:00:00.000Z`) : null } : {}), ...(data.notes !== undefined ? { notes: data.notes } : {}), ...(data.paymentTerms !== undefined ? { paymentTerms: data.paymentTerms } : {}) }, include: invoiceInclude });
    await audit(tx, userId, "INVOICE_METADATA_UPDATED", "Invoice", id, { changedFields: Object.keys(data) });
    return present(updated);
  }, { isolationLevel: "ReadCommitted" });
}

export async function createPayment(data, userId, db = prisma) {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${data.invoiceId} FOR UPDATE`;
      const invoice = await tx.invoice.findUnique({ where: { id: data.invoiceId }, include: { payments: true } });
      if (!invoice) throw new InvoiceError("Invoice not found", 404);
      const prior = await tx.payment.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
      if (prior) {
        const priorDate = new Date(prior.paymentDate).toISOString().slice(0, 10);
        if (prior.invoiceId !== invoice.id || cents(prior.amount).toFixed(2) !== cents(data.amount).toFixed(2) || prior.method !== data.method || (prior.transactionReference ?? null) !== (data.transactionReference ?? null) || (data.paymentDate && priorDate !== data.paymentDate)) throw new InvoiceError("This request key has already been used", 409);
        return { payment: prior, invoice: present({ ...invoice, payments: invoice.payments }), replayed: true };
      }
      const amount = cents(data.amount);
      const paid = cents(invoice.payments.reduce((sum, p) => sum.plus(p.amount.toString()), new Decimal(0)));
      const outstanding = cents(dec(invoice.totalAmount).minus(paid));
      if (amount.gt(outstanding)) throw new InvoiceError("Payment exceeds the outstanding balance", 409);
      const payment = await tx.payment.create({ data: { invoiceId: invoice.id, amount: amount.toFixed(2), method: data.method, paymentDate: data.paymentDate ? new Date(`${data.paymentDate}T00:00:00.000Z`) : new Date(), transactionReference: data.transactionReference ?? null, notes: data.notes ?? null, idempotencyKey: data.idempotencyKey, createdById: userId } });
      const payments = [...invoice.payments, payment];
      const balanceAfter = cents(outstanding.minus(amount));
      const overdue = !balanceAfter.isZero() && invoice.dueDate && new Date(invoice.dueDate).toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10);
      const nextStatus = balanceAfter.isZero() ? "PAID" : overdue ? "OVERDUE" : "PARTIALLY_PAID";
      await tx.invoice.update({ where: { id: invoice.id }, data: { paidAmount: cents(paid.plus(amount)).toFixed(2), status: nextStatus } });
      await audit(tx, userId, "PAYMENT_RECORDED", "Payment", payment.id, { invoiceId: invoice.id, amount: amount.toFixed(2), method: payment.method, status: nextStatus });
      await audit(tx, userId, "INVOICE_PAYMENT_STATUS_CHANGED", "Invoice", invoice.id, { status: nextStatus, outstandingAmount: cents(outstanding.minus(amount)).toFixed(2) });
      return { payment, invoice: present({ ...invoice, payments }), replayed: false };
    }, { isolationLevel: "ReadCommitted" });
  } catch (err) {
    if (err?.code === "P2002") {
      const payment = await db.payment.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
      if (payment?.invoiceId === data.invoiceId && cents(payment.amount).toFixed(2) === cents(data.amount).toFixed(2) && payment.method === data.method && (payment.transactionReference ?? null) === (data.transactionReference ?? null)) return { payment, invoice: await getInvoice(data.invoiceId, db), replayed: true };
    }
    throw err;
  }
}

export async function listPayments(filters, db = prisma) {
  const paymentDate = {};
  if (filters.dateFrom) paymentDate.gte = new Date(`${filters.dateFrom}T00:00:00.000Z`);
  if (filters.dateTo) { paymentDate.lt = new Date(`${filters.dateTo}T00:00:00.000Z`); paymentDate.lt.setUTCDate(paymentDate.lt.getUTCDate() + 1); }
  const invoiceWhere = { ...(filters.type && filters.type !== "ALL" ? { type: filters.type } : {}), ...(filters.supplierId ? { purchaseOrder: { supplierId: filters.supplierId } } : {}), ...(filters.buyerId ? { salesOrder: { buyerId: filters.buyerId } } : {}) };
  const where = { ...(filters.invoiceId ? { invoiceId: filters.invoiceId } : {}), ...(Object.keys(invoiceWhere).length ? { invoice: invoiceWhere } : {}), ...(Object.keys(paymentDate).length ? { paymentDate } : {}), ...(filters.search ? { OR: [{ transactionReference: { contains: filters.search } }, { invoice: { ...invoiceWhere, invoiceNumber: { contains: filters.search } } }] } : {}) };
  const [items, total] = await Promise.all([db.payment.findMany({ where, include: { invoice: { select: { id: true, invoiceNumber: true, type: true } }, createdBy: { select: { id: true, name: true } } }, orderBy: [{ paymentDate: "desc" }, { id: "desc" }], skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }), db.payment.count({ where })]);
  return { items, pagination: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) } };
}

export async function getPayment(id, db = prisma) {
  const payment = await db.payment.findUnique({ where: { id }, include: { invoice: { select: { id: true, invoiceNumber: true, type: true, totalAmount: true } }, createdBy: { select: { id: true, name: true } } } });
  if (!payment) throw new InvoiceError("Payment not found", 404);
  const auditHistory = await db.auditLog.findMany({ where: { entity: "Payment", entityId: String(id) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, action: true, metadata: true, createdAt: true, user: { select: { id: true, name: true } } } });
  return { ...payment, auditHistory };
}

export async function financialSummary(db = prisma) {
  const invoices = await db.invoice.findMany({ include: invoiceInclude });
  let receivable = new Decimal(0), payable = new Decimal(0), collected = new Decimal(0), paidOut = new Decimal(0), overdueReceivable = new Decimal(0), overduePayable = new Decimal(0);
  const outstandingByPartner = new Map();
  const unpaid = [], partial = [], overdue = [];
  for (const raw of invoices) {
    const row = present(raw), balance = new Decimal(row.outstandingAmount), received = row.payments.reduce((s, p) => s.plus(p.amount.toString()), new Decimal(0));
    const partner = raw.type === "SALES" ? raw.salesOrder?.buyer : raw.purchaseOrder?.supplier;
    if (raw.type === "SALES") { receivable = receivable.plus(balance); collected = collected.plus(received); if (row.status === "OVERDUE") overdueReceivable = overdueReceivable.plus(balance); }
    else { payable = payable.plus(balance); paidOut = paidOut.plus(received); if (row.status === "OVERDUE") overduePayable = overduePayable.plus(balance); }
    if (balance.gt(0)) { const key = `${raw.type}:${partner?.id ?? "unknown"}`; const entry = outstandingByPartner.get(key) ?? { type: raw.type, partnerId: partner?.id ?? null, partnerName: raw.partnerName ?? partner?.name ?? "Unknown", amount: new Decimal(0) }; entry.amount = entry.amount.plus(balance); outstandingByPartner.set(key, entry); }
    if (row.status === "UNPAID") unpaid.push(row.id); if (row.status === "PARTIALLY_PAID") partial.push(row.id); if (row.status === "OVERDUE") overdue.push(row.id);
  }
  const format = (v) => cents(v).toFixed(2);
  return { accountsReceivable: format(receivable), accountsPayable: format(payable), totalCollected: format(collected), totalPaidToSuppliers: format(paidOut), overdueReceivables: format(overdueReceivable), overduePayables: format(overduePayable), unpaidCount: unpaid.length, partiallyPaidCount: partial.length, overdueCount: overdue.length, supplierOutstanding: [...outstandingByPartner.values()].filter((x) => x.type === "PURCHASE").map((x) => ({ ...x, amount: format(x.amount) })), buyerOutstanding: [...outstandingByPartner.values()].filter((x) => x.type === "SALES").map((x) => ({ ...x, amount: format(x.amount) })) };
}

const pdfText = (value) => String(value ?? "").normalize("NFKD").replace(/[^\x20-\x7E]/g, "?").replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
export async function invoicePdf(id, db = prisma) {
  const inv = await getInvoice(id, db);
  const partner = inv.type === "SALES" ? inv.salesOrder?.buyer : inv.purchaseOrder?.supplier;
  const fmtMoney = (value) => cents(value).toFixed(2);
  const lines = ["BizLedger", `${inv.type} INVOICE  ${inv.invoiceNumber}`, `Issue date: ${inv.invoiceDate.toISOString().slice(0, 10)}  Due: ${inv.dueDate?.toISOString().slice(0, 10) ?? "-"}`, `Bill to: ${inv.partnerName ?? partner?.name ?? ""}  ${inv.partnerCompany ?? partner?.companyName ?? ""}`, `Address: ${inv.partnerAddress ?? partner?.billingAddress ?? partner?.address ?? ""}`, `Tax registration: ${inv.partnerTaxId ?? partner?.taxRegistration ?? "-"}`, "", "Items:", ...inv.items.map((it) => `${it.productName} [${it.sku}] ${it.description ?? ""}  ${it.quantity} x ${fmtMoney(it.unitPrice)}  discount ${fmtMoney(it.discountAmount)}  tax ${fmtMoney(it.taxAmount)}  total ${fmtMoney(it.lineTotal)}`), "", `Subtotal: ${fmtMoney(inv.subtotal)}`, `Discount: ${fmtMoney(inv.discountTotal)}`, `Tax: ${fmtMoney(inv.taxTotal)}`, `Additional charges: ${fmtMoney(inv.additionalCharges)}`, `Grand total: ${fmtMoney(inv.totalAmount)}`, `Paid: ${fmtMoney(inv.paidAmount)}  Outstanding: ${fmtMoney(inv.outstandingAmount)}`, `Payment terms: ${inv.paymentTerms ?? "-"}`, `Notes: ${inv.notes ?? "-"}`, `Status: ${inv.status}`];
  const wrappedLines = lines.flatMap((line) => line.match(/.{1,95}/g) ?? [""]);
  const pageLines = Array.from({ length: Math.ceil(wrappedLines.length / 45) }, (_, i) => wrappedLines.slice(i * 45, (i + 1) * 45));
  const kids = pageLines.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${kids}] /Count ${pageLines.length} >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  for (const [i, page] of pageLines.entries()) {
    const pageNumber = 4 + i * 2, streamNumber = pageNumber + 1;
    const stream = `BT\n/F1 10 Tf\n50 790 Td\n${page.map((line, lineIndex) => `${lineIndex ? "0 -16 Td\n" : ""}(${pdfText(line)}) Tj\n`).join("")}ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamNumber} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`);
  }
  let pdf = "%PDF-1.4\n", offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf, "ascii")); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf, "ascii"); pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return { buffer: Buffer.from(pdf, "ascii"), invoice: inv };
}
