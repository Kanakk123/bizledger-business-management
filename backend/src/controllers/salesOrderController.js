import {
  changeSalesOrderStatus, createSalesInvoice, createSalesOrder, fulfillSalesOrder,
  getSalesOrder, listSalesOrders, returnSalesOrderItems, updateSalesOrder,
} from "../services/salesOrderService.js";
import {
  salesFulfillmentSchema, salesOrderCreateSchema, salesOrderIdSchema, salesOrderListSchema,
  salesOrderStatusSchema, salesOrderUpdateSchema, salesReturnSchema,
} from "../schemas/salesOrders.js";

export const salesOrderSchemas = {
  create: salesOrderCreateSchema, update: salesOrderUpdateSchema, id: salesOrderIdSchema,
  list: salesOrderListSchema, status: salesOrderStatusSchema, fulfillment: salesFulfillmentSchema, return: salesReturnSchema,
};

export const salesOrderController = {
  create: async (req, res) => res.status(201).json({ success: true, data: await createSalesOrder(req.validatedBody, req.user.id) }),
  list: async (req, res) => res.json({ success: true, ...await listSalesOrders(req.validatedQuery) }),
  get: async (req, res) => res.json({ success: true, data: await getSalesOrder(req.validatedParams.id) }),
  update: async (req, res) => res.json({ success: true, data: await updateSalesOrder(req.validatedParams.id, req.validatedBody, req.user.id) }),
  status: async (req, res) => res.json({ success: true, data: await changeSalesOrderStatus(req.validatedParams.id, req.validatedBody.status, req.user.id) }),
  fulfill: async (req, res) => res.status(201).json({ success: true, data: await fulfillSalesOrder(req.validatedParams.id, req.validatedBody, req.user.id) }),
  return: async (req, res) => res.status(201).json({ success: true, data: await returnSalesOrderItems(req.validatedParams.id, req.validatedBody, req.user.id) }),
  invoice: async (req, res) => {
    const result = await createSalesInvoice(req.validatedParams.id, req.user.id);
    return res.status(result.created ? 201 : 200).json({ success: true, data: result });
  },
};
