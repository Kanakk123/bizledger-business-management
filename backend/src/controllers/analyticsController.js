import { getAnalytics, getDashboard, getReport, toCsv } from "../services/analyticsService.js";

export const analyticsController = {
  dashboard: async (req, res) => res.json({ success: true, data: await getDashboard(req.validatedQuery) }),
  analytics: async (req, res) => res.json({ success: true, data: await getAnalytics(req.validatedQuery) }),
  reports: async (req, res) => res.json({ success: true, data: await getReport(req.validatedQuery) }),
  exportCsv: async (req, res) => {
    const report = await getReport(req.validatedQuery, undefined, { all: true });
    const csv = toCsv(report);
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="bizledger-${report.type}-${report.range.dateFrom}-${report.range.dateTo}.csv"`, "Cache-Control": "private, no-store" });
    return res.send(`\uFEFF${csv}`);
  },
};
