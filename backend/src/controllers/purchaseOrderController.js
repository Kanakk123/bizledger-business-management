import {
  changePurchaseOrderStatus, createPurchaseInvoice, createPurchaseOrder, getPurchaseOrder,
  listPurchaseOrders, receivePurchaseOrderItems, updatePurchaseOrder,
} from "../services/purchaseOrderService.js";
import {
  goodsReceiptSchema, purchaseOrderCreateSchema, purchaseOrderIdSchema,
  purchaseOrderListSchema, purchaseOrderStatusSchema, purchaseOrderUpdateSchema,
} from "../schemas/purchaseOrders.js";

export const purchaseOrderSchemas = {
  create: purchaseOrderCreateSchema,
  update: purchaseOrderUpdateSchema,
  id: purchaseOrderIdSchema,
  list: purchaseOrderListSchema,
  status: purchaseOrderStatusSchema,
  receipt: goodsReceiptSchema,
};

export const purchaseOrderController = {
  create: async (req, res) => res.status(201).json({ success: true, data: await createPurchaseOrder(req.validatedBody, req.user.id) }),
  list: async (req, res) => res.json({ success: true, ...await listPurchaseOrders(req.validatedQuery) }),
  get: async (req, res) => res.json({ success: true, data: await getPurchaseOrder(req.validatedParams.id) }),
  update: async (req, res) => res.json({ success: true, data: await updatePurchaseOrder(req.validatedParams.id, req.validatedBody, req.user.id) }),
  status: async (req, res) => res.json({ success: true, data: await changePurchaseOrderStatus(req.validatedParams.id, req.validatedBody.status, req.user.id) }),
  receive: async (req, res) => res.status(201).json({ success: true, data: await receivePurchaseOrderItems(req.validatedParams.id, req.validatedBody, req.user.id) }),
  invoice: async (req, res) => {
    const result = await createPurchaseInvoice(req.validatedParams.id, req.user.id);
    return res.status(result.created ? 201 : 200).json({ success: true, data: result });
  },
};
