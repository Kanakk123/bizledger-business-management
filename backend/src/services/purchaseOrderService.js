import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { prisma } from "../config/prisma.js";

const money = (value) => new Decimal(value ?? "0").toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const quantity = (value) => new Decimal(value).toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
const MAX_MONEY = new Decimal("9999999999.99");
const MAX_STOCK = new Decimal("999999999.999");
const stamp = (prefix) => `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;

export class PurchaseOrderError extends Error {
  constructor(message, status = 400) { super(message); this.name = "PurchaseOrderError"; this.status = status; }
}

const orderInclude = {
  supplier: true,
  items: { orderBy: { id: "asc" }, include: { product: { select: { id: true, isActive: true, unit: true } } } },
  receipts: { orderBy: [{ receivedAt: "desc" }, { id: "desc" }], include: { items: { include: { purchaseOrderItem: { select: { productName: true, sku: true } } } }, receivedBy: { select: { id: true, name: true } } } },
  invoice: { include: { items: true, payments: { orderBy: { paymentDate: "desc" } } } },
};

function calculateLine(line) {
  const qty = quantity(line.quantity ?? line.orderedQuantity);
  const unitPrice = money(line.unitPrice);
  const base = money(qty.mul(unitPrice));
  const discountPercent = new Decimal(line.discountPercent ?? "0");
  const discountAmount = money(base.mul(discountPercent).div(100));
  const taxRate = new Decimal(line.taxRate ?? "0");
  const taxAmount = money(base.minus(discountAmount).mul(taxRate).div(100));
  const lineTotal = money(base.minus(discountAmount).plus(taxAmount));
  if (base.gt(MAX_MONEY) || discountAmount.gt(MAX_MONEY) || taxAmount.gt(MAX_MONEY) || lineTotal.gt(MAX_MONEY)) throw new PurchaseOrderError("A line total exceeds the supported monetary limit", 422);
  return {
    qty, unitPrice, base, discountPercent, discountAmount, taxRate, taxAmount,
    lineTotal,
  };
}

export function calculatePurchaseTotals(items, additionalCharges = "0") {
  const totals = { subtotal: new Decimal(0), discountTotal: new Decimal(0), taxTotal: new Decimal(0), totalAmount: new Decimal(0) };
  for (const item of items) {
    const line = calculateLine(item);
    totals.subtotal = totals.subtotal.plus(line.base);
    totals.discountTotal = totals.discountTotal.plus(line.discountAmount);
    totals.taxTotal = totals.taxTotal.plus(line.taxAmount);
    totals.totalAmount = totals.totalAmount.plus(line.lineTotal);
  }
  totals.additionalCharges = money(additionalCharges);
  totals.totalAmount = money(totals.totalAmount.plus(totals.additionalCharges));
  for (const value of Object.values(totals)) if (value.gt(MAX_MONEY)) throw new PurchaseOrderError("Purchase order total exceeds the supported monetary limit", 422);
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, money(value).toFixed(2)]));
}

const audit = (tx, userId, action, orderId, metadata) => tx.auditLog.create({
  data: { userId, action, entity: "PurchaseOrder", entityId: String(orderId), metadata },
});

async function activeSupplier(tx, supplierId) {
  const supplier = await tx.supplier.findUnique({ where: { id: supplierId }, select: { id: true, status: true } });
  if (!supplier || supplier.status !== "ACTIVE") throw new PurchaseOrderError("Supplier does not exist or is archived", 422);
}

async function snapshotLines(tx, inputLines) {
  const products = await tx.product.findMany({ where: { id: { in: inputLines.map((line) => line.productId) }, isActive: true } });
  const byId = new Map(products.map((product) => [product.id, product]));
  return inputLines.map((line) => {
    const product = byId.get(line.productId);
    if (!product) throw new PurchaseOrderError(`Product ${line.productId} does not exist or is archived`, 422);
    const price = line.unitPrice ?? product.purchasePrice.toString();
    if (new Decimal(price).lte(0)) throw new PurchaseOrderError("Unit prices must be greater than zero", 422);
    const tax = line.taxRate ?? product.taxRate.toString();
    if (new Decimal(tax).lt(0) || new Decimal(tax).gt(100)) throw new PurchaseOrderError(`Tax rate for ${product.name} must be between 0 and 100 percent`, 422);
    const computed = calculateLine({ quantity: line.quantity, unitPrice: price, discountPercent: line.discountPercent, taxRate: tax });
    return {
      productId: product.id, productName: product.name, sku: product.sku,
      productDescription: product.description, orderedQuantity: computed.qty.toFixed(3),
      unitPrice: computed.unitPrice.toFixed(2), discountPercent: computed.discountPercent.toFixed(2),
      taxRate: computed.taxRate.toFixed(2), lineTotal: computed.lineTotal.toFixed(2),
    };
  });
}

export async function createPurchaseOrder(data, userId, db = prisma) {
  return db.$transaction(async (tx) => {
    await activeSupplier(tx, data.supplierId);
    const lines = await snapshotLines(tx, data.items);
    const totals = calculatePurchaseTotals(lines, data.additionalCharges);
    const order = await tx.purchaseOrder.create({
      data: {
        orderNumber: stamp("PO"), supplierId: data.supplierId, expectedDelivery: data.expectedDelivery ? new Date(`${data.expectedDelivery}T00:00:00.000Z`) : null,
        remarks: data.remarks ?? null, deliveryInstructions: data.deliveryInstructions ?? null,
        ...totals, items: { create: lines },
      }, include: orderInclude,
    });
    await audit(tx, userId, "PURCHASE_ORDER_CREATED", order.id, { orderNumber: order.orderNumber, supplierId: order.supplierId, totalAmount: order.totalAmount.toString() });
    return order;
  }, { isolationLevel: "ReadCommitted" });
}

export async function listPurchaseOrders(filters, db = prisma) {
  const orderDate = {};
  if (filters.dateFrom) orderDate.gte = new Date(`${filters.dateFrom}T00:00:00.000Z`);
  if (filters.dateTo) {
    orderDate.lt = new Date(`${filters.dateTo}T00:00:00.000Z`);
    orderDate.lt.setUTCDate(orderDate.lt.getUTCDate() + 1);
  }
  const where = {
    ...(filters.status !== "ALL" ? { status: filters.status } : {}),
    ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
    ...(Object.keys(orderDate).length ? { orderDate } : {}),
    ...(filters.search ? { OR: [
      { orderNumber: { contains: filters.search } },
      { supplier: { name: { contains: filters.search } } },
      { supplier: { companyName: { contains: filters.search } } },
    ] } : {}),
  };
  const [items, total] = await Promise.all([
    db.purchaseOrder.findMany({ where, include: { supplier: true, _count: { select: { items: true, receipts: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }),
    db.purchaseOrder.count({ where }),
  ]);
  return { items, pagination: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) } };
}

export async function getPurchaseOrder(id, db = prisma) {
  const order = await db.purchaseOrder.findUnique({ where: { id }, include: orderInclude });
  if (!order) throw new PurchaseOrderError("Purchase order not found", 404);
  return order;
}

export async function updatePurchaseOrder(id, data, userId, db = prisma) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${id} FOR UPDATE`;
    const current = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!current) throw new PurchaseOrderError("Purchase order not found", 404);
    if (current.status !== "DRAFT") throw new PurchaseOrderError("Only draft purchase orders can be edited", 409);
    const supplierId = data.supplierId ?? current.supplierId;
    await activeSupplier(tx, supplierId);
    let lines = current.items.map((item) => ({
      productId: item.productId, productName: item.productName, sku: item.sku, productDescription: item.productDescription,
      quantity: item.orderedQuantity.toString(), orderedQuantity: item.orderedQuantity.toString(), unitPrice: item.unitPrice.toString(),
      discountPercent: item.discountPercent.toString(), taxRate: item.taxRate.toString(),
    }));
    if (data.items) lines = await snapshotLines(tx, data.items);
    const charges = data.additionalCharges ?? current.additionalCharges.toString();
    const totals = calculatePurchaseTotals(lines, charges);
    const updateData = {
      ...(data.supplierId !== undefined ? { supplierId } : {}),
      ...(data.expectedDelivery !== undefined ? { expectedDelivery: data.expectedDelivery ? new Date(`${data.expectedDelivery}T00:00:00.000Z`) : null } : {}),
      ...(data.remarks !== undefined ? { remarks: data.remarks } : {}),
      ...(data.deliveryInstructions !== undefined ? { deliveryInstructions: data.deliveryInstructions } : {}),
      additionalCharges: charges, ...totals,
    };
    if (data.items) {
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      updateData.items = { create: lines };
    }
    const updated = await tx.purchaseOrder.update({ where: { id }, data: updateData, include: orderInclude });
    await audit(tx, userId, "PURCHASE_ORDER_UPDATED", id, { changedFields: Object.keys(data) });
    return updated;
  }, { isolationLevel: "ReadCommitted" });
}

const transitions = {
  DRAFT: ["SENT", "CANCELLED"],
  SENT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["CANCELLED"],
  PARTIALLY_RECEIVED: ["CANCELLED"],
  RECEIVED: [],
  CANCELLED: [],
};

export async function changePurchaseOrderStatus(id, status, userId, db = prisma) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${id} FOR UPDATE`;
    const current = await tx.purchaseOrder.findUnique({ where: { id }, include: orderInclude });
    if (!current) throw new PurchaseOrderError("Purchase order not found", 404);
    if (current.status === status) return current;
    if (status === "CANCELLED" && current.status === "RECEIVED") throw new PurchaseOrderError("Received purchase orders cannot be cancelled without a stock reversal", 409);
    if (!transitions[current.status]?.includes(status)) throw new PurchaseOrderError(`Cannot change a purchase order from ${current.status} to ${status}`, 409);
    const updated = await tx.purchaseOrder.update({ where: { id }, data: { status }, include: orderInclude });
    await audit(tx, userId, "PURCHASE_ORDER_STATUS_CHANGED", id, { from: current.status, to: status });
    return updated;
  }, { isolationLevel: "ReadCommitted" });
}

export async function receivePurchaseOrderItems(id, data, userId, db = prisma) {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${id} FOR UPDATE`;
      const current = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
      if (!current) throw new PurchaseOrderError("Purchase order not found", 404);
      const previous = await tx.goodsReceipt.findUnique({ where: { idempotencyKey: data.idempotencyKey }, include: { items: true } });
      if (previous) {
        if (previous.purchaseOrderId !== id) throw new PurchaseOrderError("This receipt request key has already been used", 409);
        return { receipt: previous, replayed: true, orderStatus: current.status };
      }
      if (!["CONFIRMED", "PARTIALLY_RECEIVED"].includes(current.status)) throw new PurchaseOrderError("Goods can only be received for confirmed orders", 409);
      const orderLines = new Map(current.items.map((item) => [item.id, item]));
      const receiptLines = data.items.map((line) => {
        const item = orderLines.get(line.purchaseOrderItemId);
        if (!item) throw new PurchaseOrderError("Receipt contains a line that does not belong to this purchase order", 422);
        const received = quantity(item.receivedQuantity.toString());
        const requested = quantity(line.quantity);
        const ordered = quantity(item.orderedQuantity.toString());
        if (requested.gt(ordered.minus(received))) throw new PurchaseOrderError(`Received quantity exceeds the remaining quantity for ${item.productName}`, 409);
        return { item, requested, received: received.plus(requested) };
      });
      const receipt = await tx.goodsReceipt.create({
        data: {
          receiptNumber: stamp("GR"), idempotencyKey: data.idempotencyKey, purchaseOrderId: id,
          receivedById: userId, notes: data.notes ?? null,
          items: { create: receiptLines.map(({ item, requested }) => ({ purchaseOrderItemId: item.id, quantity: requested.toFixed(3) })) },
        }, include: { items: { include: { purchaseOrderItem: { select: { productName: true, sku: true } } } }, receivedBy: { select: { id: true, name: true } } },
      });
      for (const { item, requested, received } of receiptLines) {
        const product = await tx.product.findUnique({ where: { id: item.productId }, select: { stockQuantity: true } });
        if (!product) throw new PurchaseOrderError(`Product ${item.productName} no longer exists`, 409);
        if (new Decimal(product.stockQuantity.toString()).plus(requested).gt(MAX_STOCK)) throw new PurchaseOrderError(`Receiving this quantity would exceed stock capacity for ${item.productName}`, 409);
        await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQuantity: received.toFixed(3) } });
        await tx.product.update({ where: { id: item.productId }, data: { stockQuantity: { increment: requested.toFixed(3) } } });
        await tx.inventoryTransaction.create({
          data: { productId: item.productId, type: "PURCHASE_RECEIPT", quantityChange: requested.toFixed(3), referenceType: "PURCHASE_RECEIPT", referenceId: receipt.id, notes: `${receipt.receiptNumber} · ${current.orderNumber}` },
        });
      }
      const receivedById = new Map(receiptLines.map(({ item, received }) => [item.id, received]));
      const fullyReceived = current.items.every((item) =>
        (receivedById.get(item.id) ?? quantity(item.receivedQuantity.toString())).eq(item.orderedQuantity.toString()));
      const status = fullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED";
      await tx.purchaseOrder.update({ where: { id }, data: { status } });
      await audit(tx, userId, "PURCHASE_ORDER_RECEIPT_RECORDED", id, { receiptId: receipt.id, receiptNumber: receipt.receiptNumber, status });
      if (status !== current.status) await audit(tx, userId, "PURCHASE_ORDER_STATUS_CHANGED", id, { from: current.status, to: status });
      return { receipt, replayed: false, orderStatus: status };
    }, { isolationLevel: "ReadCommitted" });
  } catch (error) {
    if (error?.code === "P2002") {
      const existing = await db.goodsReceipt.findUnique({ where: { idempotencyKey: data.idempotencyKey }, include: { items: true } });
      if (existing?.purchaseOrderId === id) return { receipt: existing, replayed: true, orderStatus: (await db.purchaseOrder.findUnique({ where: { id }, select: { status: true } }))?.status };
      if (existing) throw new PurchaseOrderError("This receipt request key has already been used", 409);
    }
    throw error;
  }
}

export async function createPurchaseInvoice(id, userId, db = prisma) {
  try { return await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${id} FOR UPDATE`;
    const order = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true, invoice: { include: { items: true, payments: true } } } });
    if (!order) throw new PurchaseOrderError("Purchase order not found", 404);
    if (order.invoice) return { invoice: order.invoice, created: false };
    if (["DRAFT", "CANCELLED"].includes(order.status)) throw new PurchaseOrderError("An invoice can only be created for a sent or confirmed purchase order", 409);
    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber: stamp("PINV"), type: "PURCHASE", status: "UNPAID", purchaseOrderId: id,
        subtotal: order.subtotal, discountTotal: order.discountTotal, taxTotal: order.taxTotal,
        additionalCharges: order.additionalCharges, totalAmount: order.totalAmount,
        items: { create: order.items.map((item) => {
          const line = calculateLine({ quantity: item.orderedQuantity.toString(), unitPrice: item.unitPrice.toString(), discountPercent: item.discountPercent.toString(), taxRate: item.taxRate.toString() });
          return {
            productName: item.productName, sku: item.sku, quantity: item.orderedQuantity,
            unitPrice: item.unitPrice, discountAmount: line.discountAmount.toFixed(2), taxRate: item.taxRate,
            taxAmount: line.taxAmount.toFixed(2), lineTotal: item.lineTotal,
          };
        }) },
      }, include: { items: true, payments: true },
    });
    await audit(tx, userId, "PURCHASE_INVOICE_CREATED", id, { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber });
    return { invoice, created: true };
  }, { isolationLevel: "ReadCommitted" }); } catch (error) {
    if (error?.code === "P2002") {
      const invoice = await db.invoice.findUnique({ where: { purchaseOrderId: id }, include: { items: true, payments: true } });
      if (invoice) return { invoice, created: false };
    }
    throw error;
  }
}
