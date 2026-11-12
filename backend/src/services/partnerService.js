import { prisma } from "../config/prisma.js";

const configs = {
  supplier: {
    model: "supplier", entity: "Supplier", auditPrefix: "SUPPLIER",
    searchFields: ["name", "companyName", "email", "phone"],
    countRelation: "purchaseOrders", historyRelation: "purchaseOrders",
    order: { orderDate: "desc" },
    historySelect: {
      id: true, orderNumber: true, status: true, orderDate: true, totalAmount: true,
      invoice: { select: { id: true, invoiceNumber: true, status: true, totalAmount: true, paidAmount: true, payments: { orderBy: { paymentDate: "desc" }, select: { id: true, amount: true, paymentDate: true, method: true, transactionReference: true } } } },
    },
  },
  buyer: {
    model: "buyer", entity: "Buyer", auditPrefix: "BUYER",
    searchFields: ["name", "companyName", "email", "phone"],
    countRelation: "salesOrders", historyRelation: "salesOrders",
    order: { orderDate: "desc" },
    historySelect: {
      id: true, orderNumber: true, status: true, orderDate: true, totalAmount: true,
      invoice: { select: { id: true, invoiceNumber: true, status: true, totalAmount: true, paidAmount: true, payments: { orderBy: { paymentDate: "desc" }, select: { id: true, amount: true, paymentDate: true, method: true, transactionReference: true } } } },
    },
  },
};

export class PartnerServiceError extends Error {
  constructor(message, status = 400) { super(message); this.name = "PartnerServiceError"; this.status = status; }
}

const normalized = (value) => value?.trim().toLocaleLowerCase() ?? "";
const audit = (tx, userId, action, config, id, metadata) => tx.auditLog.create({
  data: { userId, action: `${config.auditPrefix}_${action}`, entity: config.entity, entityId: String(id), metadata },
});

async function ensureNoActiveDuplicate(tx, config, data, exceptId) {
  const model = tx[config.model];
  const records = await model.findMany({
    where: { status: "ACTIVE", ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, name: true, companyName: true },
  });
  const duplicate = records.find((record) => normalized(record.name) === normalized(data.name)
    && normalized(record.companyName) === normalized(data.companyName));
  if (duplicate) throw new PartnerServiceError(`An active ${config.entity.toLowerCase()} with this name and company already exists`, 409);
}

function configFor(kind) {
  const config = configs[kind];
  if (!config) throw new TypeError("Unknown partner type");
  return config;
}

export async function listPartners(kind, filters, db = prisma) {
  const config = configFor(kind);
  const where = {
    ...(filters.status === "ALL" ? {} : { status: filters.status }),
    ...(filters.search ? { OR: config.searchFields.map((field) => ({ [field]: { contains: filters.search } })) } : {}),
  };
  const model = db[config.model];
  const [items, total] = await Promise.all([
    model.findMany({ where, include: { _count: { select: { [config.countRelation]: true } } }, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }),
    model.count({ where }),
  ]);
  return { items, pagination: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) } };
}

export async function getPartner(kind, id, db = prisma) {
  const config = configFor(kind);
  const record = await db[config.model].findUnique({
    where: { id },
    include: { [config.historyRelation]: { orderBy: config.order, take: 25, select: config.historySelect } },
  });
  if (!record) throw new PartnerServiceError(`${config.entity} not found`, 404);
  return record;
}

export async function createPartner(kind, data, userId, db = prisma) {
  const config = configFor(kind);
  try {
    return await db.$transaction(async (tx) => {
      await ensureNoActiveDuplicate(tx, config, data);
      const record = await tx[config.model].create({ data: { ...data, status: "ACTIVE" } });
      await audit(tx, userId, "CREATED", config, record.id, { name: record.name, companyName: record.companyName });
      return record;
    });
  } catch (error) { throw mapDatabaseError(error, config); }
}

export async function updatePartner(kind, id, data, userId, db = prisma) {
  const config = configFor(kind);
  try {
    return await db.$transaction(async (tx) => {
      const model = tx[config.model];
      const current = await model.findUnique({ where: { id } });
      if (!current) throw new PartnerServiceError(`${config.entity} not found`, 404);
      if (current.status !== "ACTIVE") throw new PartnerServiceError(`Inactive ${config.entity.toLowerCase()} records cannot be edited`, 409);
      const identity = { name: data.name ?? current.name, companyName: data.companyName !== undefined ? data.companyName : current.companyName };
      if (normalized(identity.name) !== normalized(current.name) || normalized(identity.companyName) !== normalized(current.companyName)) {
        await ensureNoActiveDuplicate(tx, config, identity, id);
      }
      const record = await model.update({ where: { id }, data });
      await audit(tx, userId, "UPDATED", config, id, { changedFields: Object.keys(data) });
      return record;
    });
  } catch (error) { throw mapDatabaseError(error, config); }
}

export async function archivePartner(kind, id, userId, db = prisma) {
  const config = configFor(kind);
  return db.$transaction(async (tx) => {
    const model = tx[config.model];
    const current = await model.findUnique({ where: { id } });
    if (!current) throw new PartnerServiceError(`${config.entity} not found`, 404);
    if (current.status === "INACTIVE") return current;
    const record = await model.update({ where: { id }, data: { status: "INACTIVE" } });
    await audit(tx, userId, "ARCHIVED", config, id, { name: current.name });
    return record;
  });
}

function mapDatabaseError(error, config) {
  if (error?.code === "P2002") throw new PartnerServiceError(`An active ${config.entity.toLowerCase()} with this name and company already exists`, 409);
  if (error?.code === "P2025") throw new PartnerServiceError(`${config.entity} not found`, 404);
  throw error;
}
