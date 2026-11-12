import test from 'node:test'
import assert from 'node:assert/strict'
import { InsightsResponseError, normalizeAnalyticsResponse, normalizeDashboardResponse, payloadForKind } from '../src/insights/insightsData.js'

test('dashboard normalizer accepts the backend success/data envelope and empty database payload', () => {
  const result = normalizeDashboardResponse({
    success: true,
    data: {
      overview: { activeProducts: 0, salesRevenue: '0.00' },
      inventoryOverview: { zeroStockProducts: 0, belowThresholdProducts: 0, totalUnits: '0.000' },
      trends: [], lowStockAlerts: [], topSellingProducts: [], recentTransactions: [], recentPayments: [], recentOrderActivities: [],
    },
  })
  assert.equal(result.inventoryOverview.zeroStockProducts, 0)
  assert.deepEqual(result.lowStockAlerts, [])
  assert.deepEqual(result.trends, [])
})

test('partial dashboard inventory data preserves missing metrics as absent for safe placeholder rendering', () => {
  const result = normalizeDashboardResponse({ success: true, data: { overview: {}, inventoryOverview: { belowThresholdProducts: 2 }, lowStockAlerts: null } })
  assert.equal(result.inventoryOverview.zeroStockProducts, undefined)
  assert.equal(result.inventoryOverview.belowThresholdProducts, 2)
  assert.deepEqual(result.lowStockAlerts, [])
})

test('missing dashboard inventory overview becomes a visible contract error instead of a render crash', () => {
  assert.throws(
    () => normalizeDashboardResponse({ success: true, data: { overview: {} } }),
    (error) => error instanceof InsightsResponseError && /missing its inventory overview/.test(error.message),
  )
})

test('analytics responses use the same envelope and tolerate empty or partial collections', () => {
  const result = normalizeAnalyticsResponse({ success: true, data: { trends: null, productSales: [], financialSummary: null } })
  assert.deepEqual(result.trends, [])
  assert.deepEqual(result.productSales, [])
  assert.deepEqual(result.financialSummary, {})
})

test('unexpected API envelope is reported explicitly', () => {
  assert.throws(() => normalizeDashboardResponse({ data: { overview: {}, inventoryOverview: {} } }), InsightsResponseError)
})

test('switching Reports or Analytics back to Dashboard never renders the prior section payload', () => {
  const reportsPayload = { summary: { count: 3 }, items: [] }
  const analyticsPayload = { trends: [], financialSummary: {} }
  const dashboardPayload = { overview: {}, inventoryOverview: { zeroStockProducts: 0 } }

  let state = { kind: 'Reports', data: reportsPayload }
  assert.equal(payloadForKind(state, 'Reports'), reportsPayload)
  assert.equal(payloadForKind(state, 'Dashboard'), null)

  state = { kind: 'Analytics', data: analyticsPayload }
  assert.equal(payloadForKind(state, 'Analytics'), analyticsPayload)
  assert.equal(payloadForKind(state, 'Dashboard'), null)

  state = { kind: 'Dashboard', data: dashboardPayload }
  assert.equal(payloadForKind(state, 'Dashboard'), dashboardPayload)
})
