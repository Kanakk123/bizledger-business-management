import { archivePartner, createPartner, getPartner, listPartners, updatePartner } from "../services/partnerService.js";
import { buyerCreateSchema, buyerUpdateSchema, partnerIdSchema, partnerListQuerySchema, supplierCreateSchema, supplierUpdateSchema } from "../schemas/partners.js";

export const partnerSchemas = {
  supplier: { create: supplierCreateSchema, update: supplierUpdateSchema, id: partnerIdSchema, list: partnerListQuerySchema },
  buyer: { create: buyerCreateSchema, update: buyerUpdateSchema, id: partnerIdSchema, list: partnerListQuerySchema },
};

export const createPartnerController = (kind) => ({
  create: async (req, res) => res.status(201).json({ success: true, data: await createPartner(kind, req.validatedBody, req.user.id) }),
  list: async (req, res) => res.json({ success: true, ...await listPartners(kind, req.validatedQuery) }),
  get: async (req, res) => res.json({ success: true, data: await getPartner(kind, req.validatedParams.id) }),
  update: async (req, res) => res.json({ success: true, data: await updatePartner(kind, req.validatedParams.id, req.validatedBody, req.user.id) }),
  archive: async (req, res) => res.json({ success: true, data: await archivePartner(kind, req.validatedParams.id, req.user.id) }),
});
