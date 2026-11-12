import Decimal from "decimal.js";
import { prisma } from "../config/prisma.js";

const D = (v) => new Decimal(v ?? 0);
const money = (v) => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const fmt = (v) => money(v).toFixed(2);
const qtyFmt = (v) => D(v).toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3);
const dayKey = (date) => new Date(date).toISOString().slice(0, 10);
const todayKey = () => dayKey(new Date());

function rangeFor(filters, defaultDays = 90) {
  const to = filters.dateTo ?? todayKey();
  const fromDate = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00.000Z`) : new Date(`${to}T00:00:00.000Z`);
  if (!filters.dateFrom) fromDate.setUTCDate(fromDate.getUTCDate() - (defaultDays - 1));
  const until = new Date(`${to}T00:00:00.000Z`); until.setUTCDate(until.getUTCDate() + 1);
  return { gte: fromDate, lt: until, from: dayKey(fromDate), to };
}
const inWindow = (key, range) => key >= range.from && key <= range.to;
const amountForReturn = (line) => D(line.quantity).isZero() ? new Decimal(0) : money(D(line.lineTotal).mul(line.returnedQuantity ?? 0).div(line.quantity));
const actualOrderValue = (order) => money(D(order.totalAmount).minus((order.items ?? []).reduce((s, i) => s.plus(amountForReturn(i)), new Decimal(0))));

function partnerName(order, type) {
  const partner = type === "SALES" ? order?.buyer : order?.supplier;
  return partner?.companyName || partner?.name || "Unknown";
}

function bucketKey(date, groupBy) {
  const d = new Date(date);
  if (groupBy === "monthly") return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  if (groupBy === "weekly") {
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    return dayKey(monday);
  }
  return dayKey(d);
}

function makeBuckets(range, groupBy, rows) {
  const sums = new Map();
  for (const row of rows) {
    const key = bucketKey(row.date, groupBy);
    const value = sums.get(key) ?? { sales: new Decimal(0), purchases: new Decimal(0), collections: new Decimal(0), supplierPayments: new Decimal(0) };
    value[row.metric] = value[row.metric].plus(row.amount);
    sums.set(key, value);
  }
  const buckets = new Map();
  const current = new Date(`${range.from}T00:00:00Z`);
  const end = new Date(`${range.to}T00:00:00Z`);
  if (groupBy === "monthly") current.setUTCDate(1);
  if (groupBy === "weekly") current.setUTCDate(current.getUTCDate() - ((current.getUTCDay() + 6) % 7));
  while (current <= end) {
    const key = bucketKey(current, groupBy);
    if (!buckets.has(key)) buckets.set(key, sums.get(key) ?? { sales: new Decimal(0), purchases: new Decimal(0), collections: new Decimal(0), supplierPayments: new Decimal(0) });
    if (groupBy === "daily") current.setUTCDate(current.getUTCDate() + 1);
    else if (groupBy === "weekly") current.setUTCDate(current.getUTCDate() + 7);
    else current.setUTCMonth(current.getUTCMonth() + 1);
  }
  return [...buckets.entries()].map(([date, x]) => ({ date, salesRevenue: fmt(x.sales), purchaseExpenditure: fmt(x.purchases), collectionsReceived: fmt(x.collections), supplierPaymentsMade: fmt(x.supplierPayments) }));
}

async function invoiceBalances(db = prisma) {
  if (typeof db.$queryRaw !== "function") {
    const rows = await db.invoice.findMany({ select: { id: true, type: true, totalAmount: true, dueDate: true, payments: { select: { amount: true } } } });
    let receivable = new Decimal(0), payable = new Decimal(0), overdueReceivable = new Decimal(0), overduePayable = new Decimal(0);
    const today = todayKey();
    for (const invoice of rows) {
      const paid = invoice.payments.reduce((s, p) => s.plus(D(p.amount)), new Decimal(0));
      const balance = Decimal.max(new Decimal(0), money(D(invoice.totalAmount).minus(paid)));
      const key = invoice.type === "SALES" ? "receivable" : "payable";
      if (key === "receivable") receivable = receivable.plus(balance); else payable = payable.plus(balance);
      if (balance.gt(0) && invoice.dueDate && dayKey(invoice.dueDate) < today) {
        if (key === "receivable") overdueReceivable = overdueReceivable.plus(balance); else overduePayable = overduePayable.plus(balance);
      }
    }
    return { receivable, payable, overdueReceivable, overduePayable };
  }
  const todayStart = new Date(`${todayKey()}T00:00:00.000Z`);
  const rows = await db.$queryRaw`
    SELECT i.type AS type,
      COALESCE(SUM(GREATEST(i.total_amount - COALESCE(p.total_paid, 0), 0)), 0) AS outstanding,
      COALESCE(SUM(CASE WHEN i.due_date < ${todayStart} AND i.total_amount > COALESCE(p.total_paid, 0)
        THEN GREATEST(i.total_amount - COALESCE(p.total_paid, 0), 0) ELSE 0 END), 0) AS overdue
    FROM invoices AS i
    LEFT JOIN (SELECT invoice_id, SUM(amount) AS total_paid FROM payments GROUP BY invoice_id) AS p ON p.invoice_id = i.id
    GROUP BY i.type`;
  let receivable = new Decimal(0), payable = new Decimal(0), overdueReceivable = new Decimal(0), overduePayable = new Decimal(0);
  for (const row of rows) {
    if (row.type === "SALES") { receivable = receivable.plus(D(row.outstanding)); overdueReceivable = overdueReceivable.plus(D(row.overdue)); }
    else { payable = payable.plus(D(row.outstanding)); overduePayable = overduePayable.plus(D(row.overdue)); }
  }
  return { receivable, payable, overdueReceivable, overduePayable };
}

async function lowStockRows(db = prisma, filters = {}) {
  if (typeof db.$queryRaw === "function") {
    return db.$queryRaw`
      SELECT id, name, sku, unit, stock_quantity AS stockQuantity, min_stock_level AS minStockLevel, updated_at AS updatedAt
      FROM products
      WHERE is_active = TRUE AND stock_quantity <= min_stock_level
        AND id = COALESCE(${filters.productId ?? null}, id)
        AND (name LIKE CONCAT('%', ${filters.search ?? ""}, '%') OR sku LIKE CONCAT('%', ${filters.search ?? ""}, '%'))
      ORDER BY stock_quantity ASC, name ASC
      LIMIT ${filters.limit ?? 1000000}`;
  }
  const rows = await db.product.findMany({ where: { isActive: true }, orderBy: [{ stockQuantity: "asc" }, { name: "asc" }] });
  const search = filters.search?.toLocaleLowerCase() ?? "";
  const filtered = rows.filter((p) => D(p.stockQuantity).lte(p.minStockLevel) && (!filters.productId || p.id === filters.productId) && (!search || `${p.name} ${p.sku}`.toLocaleLowerCase().includes(search)));
  return filters.limit ? filtered.slice(0, filters.limit) : filtered;
}

async function operationalData(range, db = prisma) {
  const dateFilter = { gte: range.gte, lt: range.lt };
  const [sales, purchases, salesInvoices, purchaseInvoices, salesPayments, purchasePayments, productAgg, lowStock, stockCounts, recentSales, recentPurchases, recentPayments, activities] = await Promise.all([
    db.salesOrder.findMany({ where: { orderDate: dateFilter, status: { in: ["DELIVERED"] } }, include: { buyer: { select: { id: true, name: true, companyName: true } }, items: { select: { productId: true, productName: true, sku: true, quantity: true, returnedQuantity: true, lineTotal: true } } } }),
    db.purchaseOrder.findMany({ where: { orderDate: dateFilter, status: "RECEIVED" }, include: { supplier: { select: { id: true, name: true, companyName: true } }, items: { select: { productId: true, productName: true, sku: true, orderedQuantity: true, receivedQuantity: true, lineTotal: true } } } }),
    db.invoice.findMany({ where: { type: "SALES", invoiceDate: dateFilter, salesOrder: { status: "DELIVERED" } }, include: { salesOrder: { include: { buyer: { select: { id: true, name: true, companyName: true } }, items: { select: { productId: true, quantity: true, returnedQuantity: true, lineTotal: true } } } }, items: true } }),
    db.invoice.findMany({ where: { type: "PURCHASE", invoiceDate: dateFilter, purchaseOrder: { status: "RECEIVED" } }, select: { totalAmount: true, invoiceDate: true } }),
    db.payment.findMany({ where: { paymentDate: dateFilter, invoice: { type: "SALES" } }, select: { amount: true, paymentDate: true } }),
    db.payment.findMany({ where: { paymentDate: dateFilter, invoice: { type: "PURCHASE" } }, select: { amount: true, paymentDate: true } }),
    db.product.aggregate({ where: { isActive: true }, _count: { _all: true }, _sum: { stockQuantity: true } }),
    lowStockRows(db, { limit: 10 }),
    db.$queryRaw`SELECT COUNT(*) AS lowCount, COALESCE(SUM(stock_quantity = 0), 0) AS zeroCount FROM products WHERE is_active = TRUE AND stock_quantity <= min_stock_level`,
    db.salesOrder.findMany({ where: { orderDate: dateFilter }, include: { buyer: { select: { name: true, companyName: true } } }, orderBy: [{ orderDate: "desc" }, { id: "desc" }], take: 5 }),
    db.purchaseOrder.findMany({ where: { orderDate: dateFilter }, include: { supplier: { select: { name: true, companyName: true } } }, orderBy: [{ orderDate: "desc" }, { id: "desc" }], take: 5 }),
    db.payment.findMany({ where: { paymentDate: dateFilter }, include: { invoice: { select: { invoiceNumber: true, type: true, partnerName: true } } }, orderBy: [{ paymentDate: "desc" }, { id: "desc" }], take: 8 }),
    db.auditLog.findMany({ where: { entity: { in: ["PurchaseOrder", "SalesOrder"] }, createdAt: dateFilter }, include: { user: { select: { name: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 8 }),
  ]);
  const balances = await invoiceBalances(db);
  const revenue = salesInvoices.reduce((s, inv) => s.plus(D(inv.totalAmount).minus(inv.salesOrder.items.reduce((a, item) => a.plus(amountForReturn(item)), new Decimal(0)))), new Decimal(0));
  const expenditure = purchaseInvoices.reduce((s, inv) => s.plus(inv.totalAmount), new Decimal(0));
  const paymentsCollected = salesPayments.reduce((s, p) => s.plus(p.amount), new Decimal(0));
  const suppliersPaid = purchasePayments.reduce((s, p) => s.plus(p.amount), new Decimal(0));
  const activityRows = [
    ...recentSales.map((o) => ({ id: `s-${o.id}`, type: "Sales order", reference: o.orderNumber, partner: partnerName(o, "SALES"), status: o.status, date: o.orderDate, amount: fmt(o.totalAmount) })),
    ...recentPurchases.map((o) => ({ id: `p-${o.id}`, type: "Purchase order", reference: o.orderNumber, partner: partnerName(o, "PURCHASE"), status: o.status, date: o.orderDate, amount: fmt(o.totalAmount) })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);
  const trendRows = [
    ...salesInvoices.map((i) => ({ date: i.invoiceDate, metric: "sales", amount: D(i.totalAmount).minus(i.salesOrder.items.reduce((a, item) => a.plus(amountForReturn(item)), new Decimal(0))) })),
    ...purchaseInvoices.map((i) => ({ date: i.invoiceDate, metric: "purchases", amount: D(i.totalAmount) })),
    ...salesPayments.map((p) => ({ date: p.paymentDate, metric: "collections", amount: D(p.amount) })),
    ...purchasePayments.map((p) => ({ date: p.paymentDate, metric: "supplierPayments", amount: D(p.amount) })),
  ];
  const top = new Map();
  for (const order of sales) for (const item of order.items) {
    const row = top.get(item.productId) ?? { productId: item.productId, name: item.productName, sku: item.sku, quantity: new Decimal(0), revenue: new Decimal(0) };
    row.quantity = row.quantity.plus(D(item.quantity).minus(item.returnedQuantity));
    row.revenue = row.revenue.plus(D(item.lineTotal).minus(amountForReturn(item)));
    top.set(item.productId, row);
  }
  return {
    range: { dateFrom: range.from, dateTo: range.to },
    overview: {
      activeProducts: productAgg._count._all, inventoryUnits: qtyFmt(productAgg._sum.stockQuantity),
      totalPurchases: fmt(purchases.reduce((s, o) => s.plus(o.totalAmount), new Decimal(0))),
      totalSales: fmt(sales.reduce((s, o) => s.plus(actualOrderValue(o)), new Decimal(0))),
      pendingPurchaseOrders: await db.purchaseOrder.count({ where: { orderDate: dateFilter, status: { in: ["DRAFT", "SENT", "CONFIRMED", "PARTIALLY_RECEIVED"] } } }),
      pendingSalesOrders: await db.salesOrder.count({ where: { orderDate: dateFilter, status: { in: ["NEW", "CONFIRMED", "PROCESSING", "DISPATCHED"] } } }),
      salesRevenue: fmt(revenue), purchaseExpenditure: fmt(expenditure), receivables: fmt(balances.receivable), payables: fmt(balances.payable),
      collectionsReceived: fmt(paymentsCollected), supplierPaymentsMade: fmt(suppliersPaid), lowStockProducts: Number(stockCounts[0]?.lowCount ?? 0),
      overdueReceivables: fmt(balances.overdueReceivable), overduePayables: fmt(balances.overduePayable),
    },
    recentTransactions: activityRows,
    recentPayments: recentPayments.map((p) => ({ id: p.id, invoiceNumber: p.invoice.invoiceNumber, type: p.invoice.type, partner: p.invoice.partnerName, date: p.paymentDate, method: p.method, amount: fmt(p.amount) })),
    recentOrderActivities: activities,
    lowStockAlerts: lowStock.slice(0, 10).map((p) => ({ id: p.id, name: p.name, sku: p.sku, unit: p.unit, stockQuantity: qtyFmt(p.stockQuantity), minStockLevel: qtyFmt(p.minStockLevel) })),
    trends: makeBuckets(range, "daily", trendRows),
    topSellingProducts: [...top.values()].sort((a, b) => b.quantity.comparedTo(a.quantity)).slice(0, 5).map((p) => ({ productId: p.productId, name: p.name, sku: p.sku, quantity: qtyFmt(p.quantity), revenue: fmt(p.revenue) })),
    inventoryOverview: { zeroStockProducts: Number(stockCounts[0]?.zeroCount ?? 0), belowThresholdProducts: Number(stockCounts[0]?.lowCount ?? 0), totalUnits: qtyFmt(productAgg._sum.stockQuantity) },
  };
}

export async function getDashboard(filters, db = prisma) {
  const range = rangeFor(filters, 30);
  return operationalData(range, db);
}

export async function getAnalytics(filters, db = prisma) {
  const range = rangeFor(filters, 90);
  const dateFilter = { gte: range.gte, lt: range.lt };
  const [salesInvoices, purchaseInvoices, salesPayments, purchasePayments, salesItems, purchaseItems, movements, salesOrders, purchaseOrders, invoices, payments] = await Promise.all([
    db.invoice.findMany({
      where: { type: "SALES", invoiceDate: dateFilter, salesOrder: { status: "DELIVERED" } },
      include: { salesOrder: { include: { items: { select: { quantity: true, returnedQuantity: true, lineTotal: true } } } } },
    }),
    db.invoice.findMany({ where: { type: "PURCHASE", invoiceDate: dateFilter, purchaseOrder: { status: "RECEIVED" } }, select: { totalAmount: true, invoiceDate: true } }),
    db.payment.findMany({ where: { paymentDate: dateFilter, invoice: { type: "SALES" } }, select: { amount: true, paymentDate: true } }),
    db.payment.findMany({ where: { paymentDate: dateFilter, invoice: { type: "PURCHASE" } }, select: { amount: true, paymentDate: true } }),
    db.salesOrderItem.findMany({ where: { salesOrder: { orderDate: dateFilter, status: "DELIVERED" } }, include: { salesOrder: { select: { orderNumber: true, orderDate: true, buyer: { select: { id: true, name: true, companyName: true } } } } } }),
    db.purchaseOrderItem.findMany({ where: { purchaseOrder: { orderDate: dateFilter, status: { in: ["RECEIVED", "PARTIALLY_RECEIVED"] } } }, include: { purchaseOrder: { select: { orderNumber: true, orderDate: true, supplier: { select: { id: true, name: true, companyName: true } } } } } }),
    db.inventoryTransaction.findMany({ where: { createdAt: dateFilter }, include: { product: { select: { id: true, name: true, sku: true, unit: true } } } }),
    db.salesOrder.findMany({ where: { orderDate: dateFilter, status: "DELIVERED" }, include: { buyer: { select: { id: true, name: true, companyName: true } }, items: { select: { quantity: true, returnedQuantity: true, lineTotal: true } } } }),
    db.purchaseOrder.findMany({ where: { orderDate: dateFilter, status: "RECEIVED" }, include: { supplier: { select: { id: true, name: true, companyName: true } } } }),
    db.invoice.findMany({ where: { invoiceDate: dateFilter }, select: { id: true, type: true, totalAmount: true, payments: { select: { amount: true } } } }),
    db.payment.findMany({ where: { paymentDate: dateFilter }, select: { amount: true, invoice: { select: { type: true } } } }),
  ]);
  const trendRows = [
    ...salesInvoices.map((x) => ({ date: x.invoiceDate, metric: "sales", amount: D(x.totalAmount).minus(x.salesOrder.items.reduce((s, i) => s.plus(amountForReturn(i)), new Decimal(0))) })),
    ...purchaseInvoices.map((x) => ({ date: x.invoiceDate, metric: "purchases", amount: D(x.totalAmount) })),
    ...salesPayments.map((x) => ({ date: x.paymentDate, metric: "collections", amount: D(x.amount) })),
    ...purchasePayments.map((x) => ({ date: x.paymentDate, metric: "supplierPayments", amount: D(x.amount) })),
  ];
  const productSales = new Map(), productPurchases = new Map();
  for (const row of salesItems) {
    const x = productSales.get(row.productId) ?? { productId: row.productId, productName: row.productName, sku: row.sku, quantity: new Decimal(0), revenue: new Decimal(0) };
    x.quantity = x.quantity.plus(D(row.quantity).minus(row.returnedQuantity)); x.revenue = x.revenue.plus(D(row.lineTotal).minus(amountForReturn(row))); productSales.set(row.productId, x);
  }
  for (const row of purchaseItems) {
    const x = productPurchases.get(row.productId) ?? { productId: row.productId, productName: row.productName, sku: row.sku, quantity: new Decimal(0), expenditure: new Decimal(0) };
    const received = D(row.receivedQuantity); x.quantity = x.quantity.plus(received); x.expenditure = x.expenditure.plus(D(row.orderedQuantity).isZero() ? 0 : D(row.lineTotal).mul(received).div(row.orderedQuantity)); productPurchases.set(row.productId, x);
  }
  const byPartner = (orders, type) => {
    const map = new Map();
    for (const o of orders) { const p = type === "SALES" ? o.buyer : o.supplier; const id = p.id; const v = map.get(id) ?? { partnerId: id, partnerName: p.companyName || p.name, orderCount: 0, amount: new Decimal(0) }; v.orderCount++; v.amount = v.amount.plus(type === "SALES" ? actualOrderValue(o) : D(o.totalAmount)); map.set(id, v); }
    return [...map.values()].map((x) => ({ ...x, amount: fmt(x.amount) }));
  };
  const currentBalances = await invoiceBalances(db);
  return {
    range: { dateFrom: range.from, dateTo: range.to, groupBy: filters.groupBy ?? "daily" },
    trends: makeBuckets(range, filters.groupBy ?? "daily", trendRows),
    productSales: [...productSales.values()].map((x) => ({ ...x, quantity: qtyFmt(x.quantity), revenue: fmt(x.revenue) })).sort((a, b) => D(b.revenue).comparedTo(a.revenue)),
    productPurchases: [...productPurchases.values()].map((x) => ({ ...x, quantity: qtyFmt(x.quantity), expenditure: fmt(x.expenditure) })).sort((a, b) => D(b.expenditure).comparedTo(a.expenditure)),
    inventoryMovement: movements.map((x) => ({ id: x.id, date: x.createdAt, productId: x.productId, productName: x.product.name, sku: x.product.sku, type: x.type, quantityChange: qtyFmt(x.quantityChange), referenceType: x.referenceType, referenceId: x.referenceId })),
    lowStock: (await lowStockRows(db)).map((p) => ({ ...p, stockQuantity: qtyFmt(p.stockQuantity), minStockLevel: qtyFmt(p.minStockLevel) })),
    supplierTransactions: byPartner(purchaseOrders, "PURCHASE"), buyerTransactions: byPartner(salesOrders, "SALES"),
    financialSummary: { receivables: fmt(currentBalances.receivable), payables: fmt(currentBalances.payable), issuedInvoiceCount: invoices.length, recordedPaymentCount: payments.length },
  };
}

function dateWhere(dateField, range) { return { [dateField]: { gte: range.gte, lt: range.lt } }; }
function statusAmount(row, type) {
  if (type === "sales" || type === "supplier-transactions" || type === "buyer-transactions") return type === "sales" ? actualOrderValue(row) : D(row.totalAmount);
  if (type === "purchases") return D(row.totalAmount);
  if (type === "product-sales") return D(row.lineTotal).minus(amountForReturn(row));
  if (type === "product-purchases") return D(row.orderedQuantity).isZero() ? new Decimal(0) : D(row.lineTotal).mul(row.receivedQuantity).div(row.orderedQuantity);
  if (type === "payments") return D(row.amount);
  if (type === "receivables" || type === "payables") return Decimal.max(new Decimal(0), money(D(row.totalAmount).minus(row.payments.reduce((s, p) => s.plus(D(p.amount)), new Decimal(0)))));
  return new Decimal(0);
}
function invoiceStatus(invoice) {
  const paid = invoice.payments.reduce((s, p) => s.plus(D(p.amount)), new Decimal(0));
  const balance = Decimal.max(new Decimal(0), money(D(invoice.totalAmount).minus(paid)));
  if (balance.isZero()) return "PAID";
  if (invoice.dueDate && dayKey(invoice.dueDate) < todayKey()) return "OVERDUE";
  return paid.gt(0) ? "PARTIALLY_PAID" : "UNPAID";
}

export async function getReport(filters, db = prisma, { all = false } = {}) {
  const range = rangeFor(filters, 365), q = filters.search.toLocaleLowerCase(), sortOrder = filters.sortOrder === "asc" ? 1 : -1;
  const statusFilter = filters.status !== "ALL";
  const records = [];
  const push = (rows, mapper = (x) => x) => records.push(...rows.map(mapper));
  const search = (values) => !q || values.some((x) => String(x ?? "").toLocaleLowerCase().includes(q));
  const statuses = (status) => !statusFilter || status === filters.status;
  const hasRange = (date) => inWindow(dayKey(date), range);
  const includeOrder = { items: true };
  switch (filters.type) {
    case "sales": {
      const rows = await db.salesOrder.findMany({ where: { orderDate: dateWhere("orderDate", range).orderDate, ...(filters.buyerId ? { buyerId: filters.buyerId } : {}) }, include: { buyer: true, items: includeOrder.items } });
      push(rows.filter((o) => statuses(o.status) && search([o.orderNumber, o.buyer.name, o.buyer.companyName])), (o) => ({ id: o.id, date: o.orderDate, reference: o.orderNumber, status: o.status, partnerId: o.buyerId, partner: partnerName(o, "SALES"), amount: fmt(actualOrderValue(o)), itemCount: o.items.length })); break;
    }
    case "purchases": {
      const rows = await db.purchaseOrder.findMany({ where: { orderDate: dateWhere("orderDate", range).orderDate, ...(filters.supplierId ? { supplierId: filters.supplierId } : {}) }, include: { supplier: true, items: includeOrder.items } });
      push(rows.filter((o) => statuses(o.status) && search([o.orderNumber, o.supplier.name, o.supplier.companyName])), (o) => ({ id: o.id, date: o.orderDate, reference: o.orderNumber, status: o.status, partnerId: o.supplierId, partner: partnerName(o, "PURCHASE"), amount: fmt(o.totalAmount), itemCount: o.items.length })); break;
    }
    case "supplier-transactions": case "buyer-transactions": {
      const isBuyer = filters.type === "buyer-transactions";
      const [orders, payments] = await Promise.all([
        isBuyer
          ? db.salesOrder.findMany({ where: { orderDate: dateWhere("orderDate", range).orderDate, ...(filters.buyerId ? { buyerId: filters.buyerId } : {}) }, include: { buyer: true, items: true } })
          : db.purchaseOrder.findMany({ where: { orderDate: dateWhere("orderDate", range).orderDate, ...(filters.supplierId ? { supplierId: filters.supplierId } : {}) }, include: { supplier: true, items: true } }),
        db.payment.findMany({ where: { paymentDate: dateWhere("paymentDate", range).paymentDate, invoice: isBuyer ? { type: "SALES", ...(filters.buyerId ? { salesOrder: { buyerId: filters.buyerId } } : {}) } : { type: "PURCHASE", ...(filters.supplierId ? { purchaseOrder: { supplierId: filters.supplierId } } : {}) } }, include: { invoice: { include: { salesOrder: { include: { buyer: true } }, purchaseOrder: { include: { supplier: true } } } } } }),
      ]);
      const orderRows = orders.filter((o) => statuses(o.status) && search([o.orderNumber, isBuyer ? o.buyer.name : o.supplier.name, isBuyer ? o.buyer.companyName : o.supplier.companyName])).map((o) => ({ id: `order-${o.id}`, date: o.orderDate, reference: o.orderNumber, transactionKind: "ORDER", status: o.status, partnerId: isBuyer ? o.buyerId : o.supplierId, partner: partnerName(o, isBuyer ? "SALES" : "PURCHASE"), amount: fmt(isBuyer ? actualOrderValue(o) : o.totalAmount) }));
      const paymentRows = payments.filter((p) => search([p.invoice.invoiceNumber, p.transactionReference, p.invoice.partnerName, isBuyer ? p.invoice.salesOrder?.buyer?.name : p.invoice.purchaseOrder?.supplier?.name])).map((p) => ({ id: `payment-${p.id}`, date: p.paymentDate, reference: p.invoice.invoiceNumber, transactionKind: "PAYMENT", status: "RECORDED", partnerId: isBuyer ? p.invoice.salesOrder?.buyerId : p.invoice.purchaseOrder?.supplierId, partner: p.invoice.partnerName || partnerName(isBuyer ? p.invoice.salesOrder : p.invoice.purchaseOrder, p.invoice.type), method: p.method, transactionReference: p.transactionReference, amount: fmt(p.amount) }));
      records.push(...orderRows, ...paymentRows); break;
    }
    case "inventory": {
      const rows = await db.inventoryTransaction.findMany({ where: dateWhere("createdAt", range), include: { product: { select: { id: true, name: true, sku: true, unit: true } } } });
      push(rows.filter((x) => (!filters.productId || x.productId === filters.productId) && search([x.product.name, x.product.sku, x.type, x.referenceType])), (x) => ({ id: x.id, date: x.createdAt, productId: x.productId, productName: x.product.name, sku: x.product.sku, type: x.type, quantity: qtyFmt(x.quantityChange), referenceType: x.referenceType, referenceId: x.referenceId, notes: x.notes })); break;
    }
    case "low-stock": {
      const rows = await lowStockRows(db, { productId: filters.productId, search: filters.search });
      push(rows, (x) => ({ id: x.id, productId: x.id, date: x.updatedAt, productName: x.name, sku: x.sku, unit: x.unit, quantity: qtyFmt(x.stockQuantity), minStockLevel: qtyFmt(x.minStockLevel), status: D(x.stockQuantity).isZero() ? "OUT_OF_STOCK" : "LOW_STOCK" })); break;
    }
    case "product-sales": case "product-purchases": {
      const isSales = filters.type === "product-sales";
      const rows = isSales
        ? await db.salesOrderItem.findMany({ where: { salesOrder: { orderDate: dateWhere("orderDate", range).orderDate, status: "DELIVERED", ...(filters.buyerId ? { buyerId: filters.buyerId } : {}) }, ...(filters.productId ? { productId: filters.productId } : {}) }, include: { salesOrder: { include: { buyer: true } } } })
        : await db.purchaseOrderItem.findMany({ where: { purchaseOrder: { orderDate: dateWhere("orderDate", range).orderDate, status: { in: ["RECEIVED", "PARTIALLY_RECEIVED"] }, ...(filters.supplierId ? { supplierId: filters.supplierId } : {}) }, ...(filters.productId ? { productId: filters.productId } : {}) }, include: { purchaseOrder: { include: { supplier: true } } } });
      push(rows.filter((x) => hasRange(isSales ? x.salesOrder.orderDate : x.purchaseOrder.orderDate) && search([x.productName, x.sku])), (x) => ({ id: x.id, date: isSales ? x.salesOrder.orderDate : x.purchaseOrder.orderDate, reference: isSales ? x.salesOrder.orderNumber : x.purchaseOrder.orderNumber, productId: x.productId, productName: x.productName, sku: x.sku, partner: partnerName(isSales ? x.salesOrder : x.purchaseOrder, isSales ? "SALES" : "PURCHASE"), quantity: qtyFmt(isSales ? D(x.quantity).minus(x.returnedQuantity) : x.receivedQuantity), amount: fmt(isSales ? D(x.lineTotal).minus(amountForReturn(x)) : statusAmount(x, "product-purchases")) })); break;
    }
    case "receivables": case "payables": {
      const isSales = filters.type === "receivables";
      const rows = await db.invoice.findMany({ where: { type: isSales ? "SALES" : "PURCHASE", ...dateWhere("invoiceDate", range), ...(filters.buyerId ? { salesOrder: { buyerId: filters.buyerId } } : {}), ...(filters.supplierId ? { purchaseOrder: { supplierId: filters.supplierId } } : {}) }, include: { payments: true, salesOrder: { include: { buyer: true } }, purchaseOrder: { include: { supplier: true } } } });
      push(rows.map((x) => ({ ...x, balance: statusAmount(x, filters.type), status: (() => { const bal = statusAmount(x, filters.type); if (bal.isZero()) return "PAID"; if (x.dueDate && dayKey(x.dueDate) < todayKey()) return "OVERDUE"; return x.payments.length ? "PARTIALLY_PAID" : "UNPAID"; })() })).filter((x) => statuses(x.status) && search([x.invoiceNumber, x.partnerName])), (x) => ({ id: x.id, date: x.invoiceDate, reference: x.invoiceNumber, partnerId: isSales ? x.salesOrder?.buyerId : x.purchaseOrder?.supplierId, partner: x.partnerName || partnerName(isSales ? x.salesOrder : x.purchaseOrder, isSales ? "SALES" : "PURCHASE"), total: fmt(x.totalAmount), paid: fmt(D(x.totalAmount).minus(x.balance)), amount: fmt(x.balance), status: x.status, dueDate: x.dueDate })); break;
    }
    case "payments": {
      const rows = await db.payment.findMany({ where: dateWhere("paymentDate", range), include: { invoice: { include: { payments: true, salesOrder: { include: { buyer: true } }, purchaseOrder: { include: { supplier: true } } } } } });
      push(rows.filter((x) => (!filters.status || filters.status === "ALL" || invoiceStatus(x.invoice) === filters.status) && (!filters.buyerId || x.invoice.salesOrder?.buyerId === filters.buyerId) && (!filters.supplierId || x.invoice.purchaseOrder?.supplierId === filters.supplierId) && search([x.invoice.invoiceNumber, x.transactionReference, x.invoice.partnerName])), (x) => ({ id: x.id, date: x.paymentDate, reference: x.invoice.invoiceNumber, invoiceId: x.invoiceId, type: x.invoice.type, partner: x.invoice.partnerName || partnerName(x.invoice.type === "SALES" ? x.invoice.salesOrder : x.invoice.purchaseOrder, x.invoice.type), method: x.method, transactionReference: x.transactionReference, amount: fmt(x.amount), status: invoiceStatus(x.invoice) })); break;
    }
    case "revenue-expenditure": {
      const [sales, purchases] = await Promise.all([
        db.invoice.findMany({
          where: { type: "SALES", ...dateWhere("invoiceDate", range), salesOrder: { status: "DELIVERED" } },
          include: { salesOrder: { include: { items: { select: { quantity: true, returnedQuantity: true, lineTotal: true } } } } },
        }),
        db.invoice.findMany({ where: { type: "PURCHASE", ...dateWhere("invoiceDate", range), purchaseOrder: { status: "RECEIVED" } } }),
      ]);
      push([...sales.map((x) => ({ ...x, reportType: "SALES", reportAmount: D(x.totalAmount).minus(x.salesOrder.items.reduce((s, i) => s.plus(amountForReturn(i)), new Decimal(0))) })), ...purchases.map((x) => ({ ...x, reportType: "PURCHASE", reportAmount: D(x.totalAmount) }))].filter((x) => search([x.invoiceNumber, x.reportType])), (x) => ({ id: x.id, date: x.invoiceDate, reference: x.invoiceNumber, type: x.reportType, amount: fmt(x.reportAmount) })); break;
    }
  }
  const sortVal = (x) => filters.sortBy === "name" ? x.productName || x.partner || x.reference || "" : filters.sortBy === "amount" ? D(x.amount ?? 0) : filters.sortBy === "quantity" ? D(x.quantity ?? 0) : new Date(x.date ?? 0).getTime();
  records.sort((a, b) => { const av = sortVal(a), bv = sortVal(b); const compare = Decimal.isDecimal(av) ? av.comparedTo(bv) : typeof av === "number" ? av - bv : String(av).localeCompare(String(bv)); return compare * sortOrder || a.id - b.id; });
  const summary = records.reduce((s, x) => {
    const isPayment = x.transactionKind === "PAYMENT" || filters.type === "payments";
    const salesOrderReport = ["sales", "buyer-transactions"].includes(filters.type);
    const purchaseOrderReport = ["purchases", "supplier-transactions"].includes(filters.type);
    const excludedOrder = x.status === "CANCELLED" || (salesOrderReport && x.transactionKind !== "PAYMENT" && x.status !== "DELIVERED") || (purchaseOrderReport && x.transactionKind !== "PAYMENT" && x.status !== "RECEIVED");
    return { count: s.count + 1, amount: s.amount.plus(excludedOrder || (filters.type.includes("transactions") && isPayment) ? 0 : D(x.amount ?? 0)), paymentAmount: s.paymentAmount.plus(isPayment ? D(x.amount ?? 0) : 0), paymentCount: s.paymentCount + (isPayment ? 1 : 0), quantity: s.quantity.plus(excludedOrder ? 0 : D(x.quantity ?? 0)) };
  }, { count: 0, amount: new Decimal(0), paymentAmount: new Decimal(0), paymentCount: 0, quantity: new Decimal(0) });
  const offset = (filters.page - 1) * filters.pageSize;
  return { type: filters.type, range: { dateFrom: range.from, dateTo: range.to }, summary: { count: summary.count, amount: fmt(summary.amount), paymentAmount: fmt(summary.paymentAmount), paymentCount: summary.paymentCount, quantity: qtyFmt(summary.quantity) }, items: all ? records : records.slice(offset, offset + filters.pageSize), pagination: { page: filters.page, pageSize: filters.pageSize, total: records.length, totalPages: Math.ceil(records.length / filters.pageSize) } };
}

const safeCell = (value) => {
  let text = value instanceof Date ? value.toISOString() : value == null ? "" : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
export function toCsv(report) {
  const headers = [...new Set(report.items.flatMap((row) => Object.keys(row)))];
  if (!headers.length) return "";
  return [headers.map(safeCell).join(","), ...report.items.map((row) => headers.map((key) => safeCell(row[key])).join(","))].join("\r\n");
}
