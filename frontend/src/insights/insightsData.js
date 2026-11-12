const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const objectRows = (value) => Array.isArray(value) ? value.filter(isRecord) : []

export const payloadForKind = (state, kind) => state?.kind === kind ? state.data : null

export class InsightsResponseError extends Error {
  constructor(message) { super(message); this.name = 'InsightsResponseError' }
}

function responseData(response, label) {
  if (!isRecord(response) || response.success !== true || !isRecord(response.data)) {
    throw new InsightsResponseError(`The ${label} response did not contain the expected { success, data } API envelope.`)
  }
  return response.data
}

export function normalizeDashboardResponse(response) {
  const data = responseData(response, 'dashboard')
  if (!isRecord(data.overview)) throw new InsightsResponseError('The dashboard response is missing its overview data. Please retry or contact support.')
  if (!isRecord(data.inventoryOverview)) throw new InsightsResponseError('The dashboard response is missing its inventory overview. Please retry or contact support.')
  return {
    ...data,
    trends: objectRows(data.trends),
    lowStockAlerts: objectRows(data.lowStockAlerts),
    topSellingProducts: objectRows(data.topSellingProducts),
    recentTransactions: objectRows(data.recentTransactions),
    recentPayments: objectRows(data.recentPayments),
    recentOrderActivities: objectRows(data.recentOrderActivities),
  }
}

export function normalizeAnalyticsResponse(response) {
  const data = responseData(response, 'analytics')
  return {
    ...data,
    trends: objectRows(data.trends),
    productSales: objectRows(data.productSales),
    productPurchases: objectRows(data.productPurchases),
    inventoryMovement: objectRows(data.inventoryMovement),
    lowStock: objectRows(data.lowStock),
    supplierTransactions: objectRows(data.supplierTransactions),
    buyerTransactions: objectRows(data.buyerTransactions),
    financialSummary: isRecord(data.financialSummary) ? data.financialSummary : {},
  }
}
