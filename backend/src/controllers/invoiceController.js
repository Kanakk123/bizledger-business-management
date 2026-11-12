import { createPayment, financialSummary, getInvoice, getPayment, invoicePdf, listInvoices, listPayments, updateInvoiceMetadata } from "../services/invoiceService.js";

export const invoiceController = {
  invoices: async (req, res) => res.json({ success: true, ...await listInvoices(req.validatedQuery) }),
  invoice: async (req, res) => res.json({ success: true, data: await getInvoice(req.validatedParams.id) }),
  updateInvoice: async (req, res) => res.json({ success: true, data: await updateInvoiceMetadata(req.validatedParams.id, req.validatedBody, req.user.id) }),
  pdf: async (req, res) => {
    const { buffer, invoice } = await invoicePdf(req.validatedParams.id);
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${invoice.invoiceNumber}.pdf"`, "Cache-Control": "private, no-store" });
    return res.send(buffer);
  },
  payments: async (req, res) => res.json({ success: true, ...await listPayments(req.validatedQuery) }),
  payment: async (req, res) => res.json({ success: true, data: await getPayment(req.validatedParams.id) }),
  createPayment: async (req, res) => {
    const result = await createPayment(req.validatedBody, req.user.id);
    return res.status(result.replayed ? 200 : 201).json({ success: true, data: result });
  },
  summary: async (_req, res) => res.json({ success: true, data: await financialSummary() }),
};
