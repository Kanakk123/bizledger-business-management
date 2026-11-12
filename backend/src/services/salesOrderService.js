import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { prisma } from "../config/prisma.js";

const money = (value) => new Decimal(value ?? "0").toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const quantity = (value) => new Decimal(value).toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
const MAX_MONEY = new Decimal("9999999999.99");
const MAX_STOCK = new Decimal("999999999.999");
const stamp = (prefix) => `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;

export class SalesOrderError extends Error {
  constructor(message, status = 400) { super(message); this.name = "SalesOrderError"; this.status = status; }
}

const orderInclude = {
  buyer: true,
  items: { orderBy: { id: "asc" }, include: { product: { select: { id: true, isActive: true, unit: true } } } },
  fulfillments: { orderBy: [{ fulfilledAt: "desc" }, { id: "desc" }], include: { items: { include: { salesOrderItem: { select: { productName: true, sku: true } } } }, fulfilledBy: { select: { id: true, name: true } } } },
  returns: { orderBy: [{ returnedAt: "desc" }, { id: "desc" }], include: { items: { include: { salesOrderItem: { select: { productName: true, sku: true } } } }, processedBy: { select: { id: true, name: true } } } },
  invoice: { include: { items: true, payments: { orderBy: { paymentDate: "desc" } } } },
};

function calculateLine(line) {
  const qty = quantity(line.quantity);
  const unitPrice = money(line.unitPrice);
  const base = money(qty.mul(unitPrice));
  const discountPercent = new Decimal(line.discountPercent ?? "0");
  const discountAmount = money(base.mul(discountPercent).div(100));
  const taxRate = new Decimal(line.taxRate ?? "0");
  const taxAmount = money(base.minus(discountAmount).mul(taxRate).div(100));
  const lineTotal = money(base.minus(discountAmount).plus(taxAmount));
  if ([base, discountAmount, taxAmount, lineTotal].some((value) => value.gt(MAX_MONEY))) throw new SalesOrderError("A line total exceeds the supported monetary limit", 422);
  return { qty, unitPrice, base, discountPercent, discountAmount, taxRate, taxAmount, lineTotal };
}

export function calculateSalesTotals(items, shippingCharges = "0") {
  const totals = { subtotal: new Decimal(0), discountTotal: new Decimal(0), taxTotal: new Decimal(0), totalAmount: new Decimal(0) };
  for (const item of items) {
    const line = calculateLine({ quantity: item.quantity, unitPrice: item.unitPrice, discountPercent: item.discountPercent, taxRate: item.taxRate });
    totals.subtotal = totals.subtotal.plus(line.base);
    totals.discountTotal = totals.discountTotal.plus(line.discountAmount);
    totals.taxTotal = totals.taxTotal.plus(line.taxAmount);
    totals.totalAmount = totals.totalAmount.plus(line.lineTotal);
  }
  totals.shippingCharges = money(shippingCharges);
  totals.totalAmount = money(totals.totalAmount.plus(totals.shippingCharges));
  for (const value of Object.values(totals)) if (value.gt(MAX_MONEY)) throw new SalesOrderError("Sales order total exceeds the supported monetary limit", 422);
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, money(value).toFixed(2)]));
}

const audit = (tx, userId, action, orderId, metadata) => tx.auditLog.create({
  data: { userId, action, entity: "SalesOrder", entityId: String(orderId), metadata },
});

async function activeBuyer(tx, buyerId) {
  const buyer = await tx.buyer.findUnique({ where: { id: buyerId }, select: { id: true, status: true } });
  if (!buyer || buyer.status !== "ACTIVE") throw new SalesOrderError("Buyer does not exist or is archived", 422);
}

async function snapshotLines(tx, inputLines) {
  const products = await tx.product.findMany({ where: { id: { in: inputLines.map((line) => line.productId) }, isActive: true } });
  const byId = new Map(products.map((product) => [product.id, product]));
  return inputLines.map((line) => {
    const product = byId.get(line.productId);
    if (!product) throw new SalesOrderError(`Product ${line.productId} does not exist or is archived`, 422);
    const unitPrice = line.unitPrice ?? product.sellingPrice.toString();
    if (new Decimal(unitPrice).lte(0)) throw new SalesOrderError("Unit prices must be greater than zero", 422);
    const taxRate = line.taxRate ?? product.taxRate.toString();
    if (new Decimal(taxRate).lt(0) || new Decimal(taxRate).gt(100)) throw new SalesOrderError(`Tax rate for ${product.name} must be between 0 and 100 percent`, 422);
    const computed = calculateLine({ quantity: line.quantity, unitPrice, discountPercent: line.discountPercent, taxRate });
    return {
      productId: product.id, productName: product.name, sku: product.sku, productDescription: product.description,
      quantity: computed.qty.toFixed(3), unitPrice: computed.unitPrice.toFixed(2), discountPercent: computed.discountPercent.toFixed(2),
      taxRate: computed.taxRate.toFixed(2), lineTotal: computed.lineTotal.toFixed(2),
    };
  });
}

export async function createSalesOrder(data, userId, db = prisma) {
  return db.$transaction(async (tx) => {
    await activeBuyer(tx, data.buyerId);
    const lines = await snapshotLines(tx, data.items);
    const totals = calculateSalesTotals(lines, data.shippingCharges);
    const order = await tx.salesOrder.create({
      data: {
        orderNumber: stamp("SO"), buyerId: data.buyerId,
        deliveryDate: data.expectedDelivery ? new Date(`${data.expectedDelivery}T00:00:00.000Z`) : null,
        remarks: data.remarks ?? null, deliveryInstructions: data.deliveryInstructions ?? null, ...totals, items: { create: lines },
      }, include: orderInclude,
    });
    await audit(tx, userId, "SALES_ORDER_CREATED", order.id, { orderNumber: order.orderNumber, buyerId: order.buyerId, totalAmount: order.totalAmount.toString() });
    return order;
  }, { isolationLevel: "ReadCommitted" });
}

export async function listSalesOrders(filters, db = prisma) {
  const orderDate = {};
  if (filters.dateFrom) orderDate.gte = new Date(`${filters.dateFrom}T00:00:00.000Z`);
  if (filters.dateTo) {
    orderDate.lt = new Date(`${filters.dateTo}T00:00:00.000Z`);
    orderDate.lt.setUTCDate(orderDate.lt.getUTCDate() + 1);
  }
  const where = {
    ...(filters.status !== "ALL" ? { status: filters.status } : {}),
    ...(filters.buyerId ? { buyerId: filters.buyerId } : {}),
    ...(Object.keys(orderDate).length ? { orderDate } : {}),
    ...(filters.search ? { OR: [
      { orderNumber: { contains: filters.search } },
      { buyer: { name: { contains: filters.search } } },
      { buyer: { companyName: { contains: filters.search } } },
    ] } : {}),
  };
  const [items, total] = await Promise.all([
    db.salesOrder.findMany({ where, include: { buyer: true, _count: { select: { items: true, fulfillments: true, returns: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }),
    db.salesOrder.count({ where }),
  ]);
  return { items, pagination: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) } };
}

export async function getSalesOrder(id, db = prisma) {
  const order = await db.salesOrder.findUnique({ where: { id }, include: orderInclude });
  if (!order) throw new SalesOrderError("Sales order not found", 404);
  return order;
}

export async function updateSalesOrder(id, data, userId, db = prisma) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM sales_orders WHERE id = ${id} FOR UPDATE`;
    const current = await tx.salesOrder.findUnique({ where: { id }, include: { items: true } });
    if (!current) throw new SalesOrderError("Sales order not found", 404);
    if (current.status !== "NEW") throw new SalesOrderError("Only new sales orders can be edited", 409);
    const buyerId = data.buyerId ?? current.buyerId;
    await activeBuyer(tx, buyerId);
    let lines = current.items.map((item) => ({
      productId: item.productId, quantity: item.quantity.toString(), unitPrice: item.unitPrice.toString(),
      discountPercent: item.discountPercent.toString(), taxRate: item.taxRate.toString(),
    }));
    if (data.items) lines = await snapshotLines(tx, data.items);
    const totals = calculateSalesTotals(lines, data.shippingCharges ?? current.shippingCharges.toString());
    const updateData = {
      ...(data.buyerId !== undefined ? { buyerId } : {}),
      ...(data.expectedDelivery !== undefined ? { deliveryDate: data.expectedDelivery ? new Date(`${data.expectedDelivery}T00:00:00.000Z`) : null } : {}),
      ...(data.remarks !== undefined ? { remarks: data.remarks } : {}),
      ...(data.deliveryInstructions !== undefined ? { deliveryInstructions: data.deliveryInstructions } : {}),
      shippingCharges: data.shippingCharges ?? current.shippingCharges.toString(), ...totals,
    };
    if (data.items) {
      await tx.salesOrderItem.deleteMany({ where: { salesOrderId: id } });
      updateData.items = { create: lines };
    }
    const updated = await tx.salesOrder.update({ where: { id }, data: updateData, include: orderInclude });
    await audit(tx, userId, "SALES_ORDER_UPDATED", id, { changedFields: Object.keys(data) });
    return updated;
  }, { isolationLevel: "ReadCommitted" });
}

const transitions = {
  NEW: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["DISPATCHED", "CANCELLED"],
  DISPATCHED: ["CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

export async function changeSalesOrderStatus(id, status, userId, db = prisma) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM sales_orders WHERE id = ${id} FOR UPDATE`;
    const current = await tx.salesOrder.findUnique({ where: { id }, include: { items: true } });
    if (!current) throw new SalesOrderError("Sales order not found", 404);
    if (current.status === status) return current;
    if (status === "CANCELLED" && current.items.some((item) => !new Decimal(item.fulfilledQuantity.toString()).isZero())) {
      throw new SalesOrderError("Orders with fulfilled quantities cannot be cancelled; process a return instead", 409);
    }
    if (!transitions[current.status]?.includes(status)) throw new SalesOrderError(`Cannot change a sales order from ${current.status} to ${status}`, 409);
    const updated = await tx.salesOrder.update({ where: { id }, data: { status } });
    await audit(tx, userId, "SALES_ORDER_STATUS_CHANGED", id, { from: current.status, to: status });
    return updated;
  }, { isolationLevel: "ReadCommitted" });
}

async function existingMovement(db, model, id, key) {
  const existing = await db[model].findUnique({ where: { idempotencyKey: key }, include: { items: true } });
  if (existing?.salesOrderId === id) return { movement: existing, replayed: true };
  if (existing) throw new SalesOrderError("This request key has already been used", 409);
  return null;
}

export async function fulfillSalesOrder(id, data, userId, db = prisma) {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM sales_orders WHERE id = ${id} FOR UPDATE`;
      const current = await tx.salesOrder.findUnique({ where: { id }, include: { items: true } });
      if (!current) throw new SalesOrderError("Sales order not found", 404);
      const previous = await tx.salesFulfillment.findUnique({ where: { idempotencyKey: data.idempotencyKey }, include: { items: true } });
      if (previous) {
        if (previous.salesOrderId !== id) throw new SalesOrderError("This fulfillment request key has already been used", 409);
        return { fulfillment: previous, replayed: true, orderStatus: current.status };
      }
      if (!["CONFIRMED", "PROCESSING", "DISPATCHED"].includes(current.status)) throw new SalesOrderError("Only confirmed or processing orders can be fulfilled", 409);
      const orderItems = new Map(current.items.map((item) => [item.id, item]));
      const rows = data.items.map((line) => {
        const item = orderItems.get(line.salesOrderItemId);
        if (!item) throw new SalesOrderError("Fulfillment contains a line that does not belong to this sales order", 422);
        const fulfilled = quantity(item.fulfilledQuantity.toString());
        const requested = quantity(line.quantity);
        if (requested.gt(quantity(item.quantity.toString()).minus(fulfilled))) throw new SalesOrderError(`Fulfilled quantity exceeds the remaining quantity for ${item.productName}`, 409);
        return { item, requested, fulfilled: fulfilled.plus(requested) };
      });
      const fulfillment = await tx.salesFulfillment.create({
        data: { fulfillmentNumber: stamp("FUL"), idempotencyKey: data.idempotencyKey, salesOrderId: id, fulfilledById: userId, notes: data.notes ?? null, items: { create: rows.map(({ item, requested }) => ({ salesOrderItemId: item.id, quantity: requested.toFixed(3) })) } },
        include: { items: { include: { salesOrderItem: { select: { productName: true, sku: true } } } }, fulfilledBy: { select: { id: true, name: true } } },
      });
      for (const { item, requested, fulfilled } of rows) {
        const changed = await tx.product.updateMany({
          where: { id: item.productId, isActive: true, stockQuantity: { gte: requested.toFixed(3) } },
          data: { stockQuantity: { decrement: requested.toFixed(3) } },
        });
        if (changed.count !== 1) {
          const product = await tx.product.findUnique({ where: { id: item.productId }, select: { isActive: true, stockQuantity: true } });
          if (!product || !product.isActive) throw new SalesOrderError(`Product ${item.productName} is archived or unavailable`, 409);
          throw new SalesOrderError(`Insufficient stock to fulfill ${item.productName}`, 409);
        }
        await tx.salesOrderItem.update({ where: { id: item.id }, data: { fulfilledQuantity: fulfilled.toFixed(3) } });
        await tx.inventoryTransaction.create({ data: { productId: item.productId, type: "SALE_FULFILLMENT", quantityChange: requested.negated().toFixed(3), referenceType: "SALES_FULFILLMENT", referenceId: fulfillment.id, notes: `${fulfillment.fulfillmentNumber} · ${current.orderNumber}` } });
      }
      const fulfilledById = new Map(rows.map(({ item, fulfilled }) => [item.id, fulfilled]));
      const complete = current.items.every((item) => (fulfilledById.get(item.id) ?? quantity(item.fulfilledQuantity.toString())).eq(item.quantity.toString()));
      const status = complete ? "DELIVERED" : current.status === "CONFIRMED" ? "PROCESSING" : current.status;
      await tx.salesOrder.update({ where: { id }, data: { status } });
      await audit(tx, userId, "SALES_ORDER_FULFILLED", id, { fulfillmentId: fulfillment.id, fulfillmentNumber: fulfillment.fulfillmentNumber, status });
      if (status !== current.status) await audit(tx, userId, "SALES_ORDER_STATUS_CHANGED", id, { from: current.status, to: status });
      return { fulfillment, replayed: false, orderStatus: status };
    }, { isolationLevel: "ReadCommitted" });
  } catch (error) {
    if (error?.code === "P2002") {
      const previous = await existingMovement(db, "salesFulfillment", id, data.idempotencyKey);
      if (previous) return { ...previous, orderStatus: (await db.salesOrder.findUnique({ where: { id }, select: { status: true } }))?.status };
    }
    throw error;
  }
}

export async function returnSalesOrderItems(id, data, userId, db = prisma) {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM sales_orders WHERE id = ${id} FOR UPDATE`;
      const current = await tx.salesOrder.findUnique({ where: { id }, include: { items: true } });
      if (!current) throw new SalesOrderError("Sales order not found", 404);
      const previous = await tx.salesReturn.findUnique({ where: { idempotencyKey: data.idempotencyKey }, include: { items: true } });
      if (previous) {
        if (previous.salesOrderId !== id) throw new SalesOrderError("This return request key has already been used", 409);
        return { return: previous, replayed: true };
      }
      const orderItems = new Map(current.items.map((item) => [item.id, item]));
      const rows = data.items.map((line) => {
        const item = orderItems.get(line.salesOrderItemId);
        if (!item) throw new SalesOrderError("Return contains a line that does not belong to this sales order", 422);
        const alreadyReturned = quantity(item.returnedQuantity.toString());
        const requested = quantity(line.quantity);
        if (requested.gt(quantity(item.fulfilledQuantity.toString()).minus(alreadyReturned))) throw new SalesOrderError(`Returned quantity exceeds the unreturned fulfilled quantity for ${item.productName}`, 409);
        return { item, requested, returned: alreadyReturned.plus(requested) };
      });
      const returned = await tx.salesReturn.create({
        data: { returnNumber: stamp("RET"), idempotencyKey: data.idempotencyKey, salesOrderId: id, processedById: userId, reason: data.reason, items: { create: rows.map(({ item, requested }) => ({ salesOrderItemId: item.id, quantity: requested.toFixed(3) })) } },
        include: { items: { include: { salesOrderItem: { select: { productName: true, sku: true } } } }, processedBy: { select: { id: true, name: true } } },
      });
      for (const { item, requested, returned: newReturned } of rows) {
        const product = await tx.product.findUnique({ where: { id: item.productId }, select: { stockQuantity: true } });
        if (!product) throw new SalesOrderError(`Product ${item.productName} no longer exists`, 409);
        if (new Decimal(product.stockQuantity.toString()).plus(requested).gt(MAX_STOCK)) throw new SalesOrderError(`Return would exceed stock capacity for ${item.productName}`, 409);
        await tx.salesOrderItem.update({ where: { id: item.id }, data: { returnedQuantity: newReturned.toFixed(3) } });
        await tx.product.update({ where: { id: item.productId }, data: { stockQuantity: { increment: requested.toFixed(3) } } });
        await tx.inventoryTransaction.create({ data: { productId: item.productId, type: "SALE_RETURN", quantityChange: requested.toFixed(3), referenceType: "SALES_RETURN", referenceId: returned.id, notes: `${returned.returnNumber} · ${current.orderNumber}` } });
      }
      await audit(tx, userId, "SALES_ORDER_RETURN_RECORDED", id, { returnId: returned.id, returnNumber: returned.returnNumber, reason: data.reason });
      return { return: returned, replayed: false };
    }, { isolationLevel: "ReadCommitted" });
  } catch (error) {
    if (error?.code === "P2002") {
      const previous = await existingMovement(db, "salesReturn", id, data.idempotencyKey);
      if (previous) return previous;
    }
    throw error;
  }
}

export async function createSalesInvoice(id, userId, db = prisma) {
  try { return await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM sales_orders WHERE id = ${id} FOR UPDATE`;
    const order = await tx.salesOrder.findUnique({ where: { id }, include: { buyer: true, items: true, invoice: { include: { items: true, payments: true } } } });
    if (!order) throw new SalesOrderError("Sales order not found", 404);
    if (order.invoice) return { invoice: order.invoice, created: false };
    if (["NEW", "CANCELLED"].includes(order.status)) throw new SalesOrderError("An invoice can only be created for a confirmed sales order", 409);
    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber: stamp("SINV"), type: "SALES", status: "UNPAID", salesOrderId: id,
        partnerName: order.buyer.name, partnerCompany: order.buyer.companyName, partnerEmail: order.buyer.email, partnerPhone: order.buyer.phone,
        partnerAddress: [order.buyer.billingAddress, order.buyer.city, order.buyer.state, order.buyer.postalCode, order.buyer.country].filter(Boolean).join(", ") || null,
        partnerTaxId: order.buyer.taxRegistration,
        subtotal: order.subtotal, discountTotal: order.discountTotal, taxTotal: order.taxTotal,
        additionalCharges: order.shippingCharges, totalAmount: order.totalAmount,
        items: { create: order.items.map((item) => {
          const line = calculateLine({ quantity: item.quantity.toString(), unitPrice: item.unitPrice.toString(), discountPercent: item.discountPercent.toString(), taxRate: item.taxRate.toString() });
          return { productName: item.productName, sku: item.sku, description: item.productDescription, quantity: item.quantity, unitPrice: item.unitPrice, discountAmount: line.discountAmount.toFixed(2), taxRate: item.taxRate, taxAmount: line.taxAmount.toFixed(2), lineTotal: item.lineTotal };
        }) },
      }, include: { items: true, payments: true },
    });
    await audit(tx, userId, "SALES_INVOICE_CREATED", id, { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber });
    return { invoice, created: true };
  }, { isolationLevel: "ReadCommitted" }); } catch (error) {
    if (error?.code === "P2002") {
      const invoice = await db.invoice.findUnique({ where: { salesOrderId: id }, include: { items: true, payments: true } });
      if (invoice) return { invoice, created: false };
    }
    throw error;
  }
}
