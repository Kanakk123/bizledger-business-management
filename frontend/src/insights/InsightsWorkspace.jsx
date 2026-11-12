import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { normalizeAnalyticsResponse, normalizeDashboardResponse, payloadForKind } from './insightsData.js'
import './insights.css'
import './charts.css'

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const reportTypes = [
  ['sales', 'Sales'], ['purchases', 'Purchases'], ['inventory', 'Inventory movements'], ['low-stock', 'Low stock'],
  ['product-sales', 'Product sales'], ['product-purchases', 'Product purchases'], ['supplier-transactions', 'Supplier transactions'],
  ['buyer-transactions', 'Buyer transactions'], ['receivables', 'Accounts receivable'], ['payables', 'Accounts payable'],
  ['revenue-expenditure', 'Revenue & expenditure'], ['payments', 'Payments'],
]
const currency = (value) => value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const dateLabel = (value) => value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'
const dateInput = (date) => date.toISOString().slice(0, 10)
const emptySummary = { count: 0, amount: '0.00', paymentAmount: '0.00', paymentCount: 0, quantity: '0.000' }
const safeReport = (value, filters) => ({
  ...((value && typeof value === 'object') ? value : {}),
  summary: { ...emptySummary, ...(value?.summary && typeof value.summary === 'object' ? value.summary : {}) },
  items: Array.isArray(value?.items) ? value.items.filter((row) => row && typeof row === 'object') : [],
  range: value?.range && typeof value.range === 'object' ? value.range : { dateFrom: filters.dateFrom, dateTo: filters.dateTo },
  pagination: { page: filters.page, pageSize: 20, total: 0, totalPages: 0, ...(value?.pagination && typeof value.pagination === 'object' ? value.pagination : {}) },
})
const defaultFrom = () => { const date = new Date(); date.setDate(date.getDate() - 29); return dateInput(date) }
const defaultTo = () => dateInput(new Date())
const cardHints = {
  'Sales revenue': 'Issued sales invoices for delivered orders, less returned line value. Not cash collected.',
  'Purchase expenditure': 'Purchase invoice totals for fully received orders. Not supplier payments made.',
  'Total sales': 'Delivered sales order values less returned item values. Cancelled and pending orders are excluded.',
  'Total purchases': 'Purchase order value for received orders. Cancelled and pending orders are excluded.',
  'Receivables': 'Current outstanding amount across issued sales invoices, calculated from saved payments.',
  'Payables': 'Current outstanding amount across issued purchase invoices, calculated from saved payments.',
  'Inventory units': 'Sum of current stock quantities for active products; units may differ between products.',
}

function Chart({ rows = [], lines = [['salesRevenue', 'Sales revenue'], ['purchaseExpenditure', 'Purchase expenditure']] }) {
  if (!Array.isArray(rows) || !rows.length) return <div className="insight-empty small-empty">No transactions in this date range.</div>
  const values = rows.flatMap((row) => lines.map(([key]) => Number(row?.[key] || 0)))
  const max = Math.max(1, ...values)
  const left = 78, right = 18, top = 22, bottom = 48, height = 284, width = 1100
  const plotW = width - left - right, plotH = height - top - bottom
  const groupW = plotW / rows.length, seriesW = Math.min(18, groupW * 0.7 / lines.length)
  const labelStep = Math.max(1, Math.ceil(rows.length / 9))
  const compactCurrency = (value) => `₹${Number(value).toLocaleString('en-IN', { notation: 'compact', maximumFractionDigits: 1 })}`
  return <div className="chart-wrap"><div className="chart-legend">{lines.map(([key, label], index) => <span key={key}><i className={`legend-dot legend-${index}`} />{label}</span>)}</div><svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Revenue and expenditure by date"><title>Financial totals by period</title>{[0, .25, .5, .75, 1].map((ratio) => { const y = top + plotH * (1 - ratio); return <g key={ratio}><line x1={left} y1={y} x2={width - right} y2={y} className="chart-gridline"/><text x={left - 10} y={y + 4} textAnchor="end" className="chart-axis-label">{compactCurrency(max * ratio)}</text></g> })}<text transform={`translate(15 ${top + plotH / 2}) rotate(-90)`} className="chart-axis-title">Amount (INR)</text>{rows.map((row, rowIndex) => { const x0 = left + rowIndex * groupW + groupW / 2; return <g key={row.date}>{lines.map(([key, label], index) => { const value = Math.max(0, Number(row?.[key] || 0)); const barHeight = value / max * plotH; const x = x0 + (index - (lines.length - 1) / 2) * seriesW - seriesW * .38; return <rect key={key} x={x} y={top + plotH - barHeight} width={seriesW * .76} height={barHeight} rx="3" className={`chart-svg-bar bar-${index}`}><title>{`${dateLabel(row.date)} · ${label}: ${currency(value)}`}</title></rect> })}{(rowIndex % labelStep === 0 || rowIndex === rows.length - 1) && <text x={x0} y={height - 15} textAnchor="middle" className="chart-axis-label">{dateLabel(row.date)}</text>}</g> })}<text x={left + plotW / 2} y={height - 2} textAnchor="middle" className="chart-axis-title">Date</text></svg></div>
}

function DataTable({ columns, rows, empty }) {
  if (!rows?.length) return <div className="insight-empty">{empty || 'No records found for these filters.'}</div>
  return <div className="insight-table-wrap"><table className="insight-table"><thead><tr>{columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? row.productId ?? `${row.date}-${index}`}>{columns.map(([key]) => {
    const value = row[key]
    const display = value instanceof Date ? value.toLocaleString() : key.toLowerCase().includes('amount') || ['revenue', 'expenditure', 'total', 'paid', 'quantity'].includes(key.toLowerCase()) && key.toLowerCase() !== 'itemcount' ? (['quantity'].includes(key.toLowerCase()) ? value : currency(value)) : typeof value === 'string' && /date|at$/i.test(key) ? dateLabel(value) : value ?? '—'
    return <td key={key}>{String(display)}</td>
  })}</tr>)}</tbody></table></div>
}

export default function InsightsWorkspace({ kind }) {
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(defaultTo)
  const [groupBy, setGroupBy] = useState('daily')
  const [reportType, setReportType] = useState('sales')
  const [status, setStatus] = useState('ALL')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('date')
  const [sortOrder, setSortOrder] = useState('desc')
  const [page, setPage] = useState(1)
  const [payloadState, setPayloadState] = useState(null)
  const [busy, setBusy] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const dashboard = kind === 'Dashboard'
  const analytics = kind === 'Analytics'
  const title = kind
  const payload = payloadForKind(payloadState, kind)
  const savePayload = useCallback((data) => setPayloadState({ kind, data }), [kind])
  const reportHasStatus = ['sales', 'purchases', 'supplier-transactions', 'buyer-transactions', 'receivables', 'payables', 'payments'].includes(reportType)
  const currentStockSnapshot = reportType === 'low-stock'

  const load = useCallback(async () => {
    setBusy(true); setError('')
    try {
      const params = new URLSearchParams({ dateFrom: from, dateTo: to })
      if (dashboard) savePayload(normalizeDashboardResponse(await api(`/api/dashboard?${params}`)))
      else if (analytics) { params.set('groupBy', groupBy); savePayload(normalizeAnalyticsResponse(await api(`/api/analytics?${params}`))) }
      else {
        Object.entries({ type: reportType, status, search, page: String(page), pageSize: '20', sortBy, sortOrder }).forEach(([k, v]) => params.set(k, v))
        const filters = { dateFrom: from, dateTo: to, page }
        const response = await api(`/api/reports?${params}`)
        savePayload(safeReport(response?.data, filters))
      }
    } catch (e) { setError(e.message); savePayload(null) } finally { setBusy(false) }
  }, [analytics, dashboard, from, groupBy, page, reportType, savePayload, search, sortBy, sortOrder, status, to])
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer) }, [load])

  async function exportCsv() {
    setExporting(true); setError('')
    try {
      const params = new URLSearchParams({ dateFrom: from, dateTo: to, type: reportType, status, search, sortBy, sortOrder, page: String(page), pageSize: '20' })
      const response = await fetch(`${API_URL}/api/reports/export.csv?${params}`, { credentials: 'include' })
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message || 'CSV export failed.') }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `bizledger-${reportType}-${from}-${to}.csv`; link.click(); URL.revokeObjectURL(url)
    } catch (e) { setError(e.message) } finally { setExporting(false) }
  }

  const overview = payload?.overview
  const cards = overview ? [
    ['Active products', overview.activeProducts], ['Inventory units', overview.inventoryUnits], ['Total purchases', currency(overview.totalPurchases)],
    ['Total sales', currency(overview.totalSales)], ['Pending purchase orders', overview.pendingPurchaseOrders], ['Pending sales orders', overview.pendingSalesOrders],
    ['Sales revenue', currency(overview.salesRevenue)], ['Purchase expenditure', currency(overview.purchaseExpenditure)], ['Buyer receivables', currency(overview.receivables)],
    ['Supplier payables', currency(overview.payables)], ['Low-stock products', overview.lowStockProducts],
  ] : []
  const reportRows = Array.isArray(payload?.items) ? payload.items : []
  const reportSummary = payload?.summary ?? emptySummary
  const reportPagination = payload?.pagination ?? { total: 0, totalPages: 0 }
  const reportColumns = reportRows.length ? [...new Set(reportRows.flatMap((row) => Object.keys(row)))].filter((key) => !['id', 'partnerId', 'productId', 'invoiceId'].includes(key)).map((key) => [key, key.replace(/[A-Z]/g, (c) => ` ${c}`).replace(/^./, (c) => c.toUpperCase())]) : []

  return <section className="page-content insight-page">
    <div className="page-heading"><div><p className="page-kicker">YOUR WORKSPACE&nbsp; / &nbsp;INSIGHTS</p><h1>{title}</h1><p className="page-subtitle">Live figures and records from your BizLedger workspace.</p></div></div>
    <div className="insight-filters">{!currentStockSnapshot && <><label>From<input type="date" value={from} max={to} onChange={(e) => { setPage(1); setFrom(e.target.value) }} /></label><label>To<input type="date" value={to} min={from} onChange={(e) => { setPage(1); setTo(e.target.value) }} /></label></>}{analytics && <label>Group by<select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>}{!dashboard && !analytics && <><label>Report<select value={reportType} onChange={(e) => { setPage(1); setReportType(e.target.value) }}>{reportTypes.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label><label>Search<input type="search" value={search} placeholder="Search records" onChange={(e) => { setPage(1); setSearch(e.target.value) }} /></label>{reportHasStatus && <label>Status<select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value) }}>{['ALL', 'NEW', 'CONFIRMED', 'PROCESSING', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'].map((x) => <option key={x}>{x}</option>)}</select></label>}<label>Sort by<select value={sortBy} onChange={(e) => setSortBy(e.target.value)}><option value="date">Date</option><option value="name">Name / reference</option><option value="amount">Amount</option><option value="quantity">Quantity</option></select></label><label>Order<select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}><option value="desc">Newest / highest</option><option value="asc">Oldest / lowest</option></select></label><button className="insight-export" onClick={exportCsv} disabled={exporting}>{exporting ? 'Preparing…' : 'Export CSV'}</button></>}</div>
    {error && <div className="insight-error" role="alert">{error}<button onClick={load}>Retry</button></div>}
    {busy && !payload ? <div className="insight-empty">Loading {title.toLowerCase()}…</div> : !payload && !error ? <div className="insight-empty">No results available.</div> : null}
    {dashboard && payload && <>
      <div className="metric-grid">{cards.map(([label, value]) => <article key={label} title={cardHints[label] || ''}><span>{label}</span><strong>{value ?? '—'}</strong></article>)}</div>
      <div className="insight-grid"><article className="insight-card span-two"><div className="insight-card-head"><div><h2>Revenue versus expenditure</h2><p>Invoice value for delivered sales and received purchases, net of sales returns.</p></div></div><Chart rows={payload.trends} /></article>
        <article className="insight-card"><h2>Inventory overview</h2><div className="inventory-stats"><div><strong>{payload.inventoryOverview.zeroStockProducts ?? '—'}</strong><span>Zero stock</span></div><div><strong>{payload.inventoryOverview.belowThresholdProducts ?? '—'}</strong><span>At or below minimum</span></div><div><strong>{payload.inventoryOverview.totalUnits ?? '—'}</strong><span>Current units</span></div></div><h3>Low-stock alerts</h3><DataTable columns={[["name", "Product"], ["sku", "SKU"], ["stockQuantity", "Stock"], ["minStockLevel", "Minimum"]]} rows={payload.lowStockAlerts} empty="No low-stock products." /></article>
        <article className="insight-card"><h2>Top-selling products</h2><DataTable columns={[["name", "Product"], ["sku", "SKU"], ["quantity", "Net units"], ["revenue", "Net sales"]]} rows={payload.topSellingProducts} empty="No delivered sales in this period." /></article>
        <article className="insight-card span-two"><h2>Recent orders</h2><DataTable columns={[["type", "Type"], ["reference", "Reference"], ["partner", "Partner"], ["status", "Status"], ["date", "Date"], ["amount", "Order value"]]} rows={payload.recentTransactions} /></article>
        <article className="insight-card"><h2>Recent payments</h2><DataTable columns={[["invoiceNumber", "Invoice"], ["partner", "Partner"], ["method", "Method"], ["amount", "Amount"]]} rows={payload.recentPayments} empty="No payments in this period." /></article>
        <article className="insight-card"><h2>Recent order activity</h2>{payload.recentOrderActivities.length ? payload.recentOrderActivities.map((a, index) => <p className="activity-line" key={a.id ?? index}><span>{String(a.action ?? 'Activity').replaceAll('_', ' ')}</span><small>{a.user?.name || 'System'} · {dateLabel(a.createdAt)}</small></p>) : <div className="insight-empty">No recent order activity.</div>}</article>
      </div>
    </>}
    {analytics && payload && <>
      <article className="insight-card"><div className="insight-card-head"><div><h2>Sales, purchases and cash movement</h2><p>Invoice totals are kept separate from buyer collections and supplier payments.</p></div></div><Chart rows={payload.trends} lines={[["salesRevenue", "Sales revenue"], ["purchaseExpenditure", "Purchase expenditure"], ["collectionsReceived", "Collections"], ["supplierPaymentsMade", "Supplier payments"]]} /></article>
      <div className="insight-grid analytics-tables"><article className="insight-card"><h2>Product-wise sales</h2><DataTable columns={[["productName", "Product"], ["sku", "SKU"], ["quantity", "Net units"], ["revenue", "Revenue"]]} rows={payload.productSales} /></article><article className="insight-card"><h2>Product-wise purchases</h2><DataTable columns={[["productName", "Product"], ["sku", "SKU"], ["quantity", "Received units"], ["expenditure", "Value received"]]} rows={payload.productPurchases} /></article><article className="insight-card"><h2>Supplier transactions</h2><DataTable columns={[["partnerName", "Supplier"], ["orderCount", "Orders"], ["amount", "Received order value"]]} rows={payload.supplierTransactions} /></article><article className="insight-card"><h2>Buyer transactions</h2><DataTable columns={[["partnerName", "Buyer"], ["orderCount", "Orders"], ["amount", "Delivered sales value"]]} rows={payload.buyerTransactions} /></article><article className="insight-card span-two"><h2>Inventory movement</h2><DataTable columns={[["date", "Date"], ["productName", "Product"], ["type", "Movement"], ["quantityChange", "Quantity change"], ["referenceType", "Source"]]} rows={payload.inventoryMovement} empty="No inventory movement in this period." /></article></div>
      <p className="insight-footnote">Current receivable and payable balances are snapshots as of today; trend periods use the selected date range.</p>
    </>}
    {!dashboard && !analytics && payload && <>
      <div className="report-summary"><article><span>Filtered records</span><strong>{reportSummary.count ?? 0}</strong></article><article><span>{reportType.includes('transactions') ? 'Order value' : 'Report amount'}</span><strong>{currency(reportSummary.amount)}</strong></article>{reportType.includes('transactions') && Number(reportSummary.paymentAmount ?? 0) > 0 && <article><span>Payments recorded</span><strong>{currency(reportSummary.paymentAmount)}</strong></article>}<article><span>Quantity</span><strong>{reportSummary.quantity ?? '0.000'}</strong></article><span className="report-range">{payload.range?.dateFrom ?? from} — {payload.range?.dateTo ?? to}</span></div>
      <DataTable columns={reportColumns} rows={reportRows} />
      <div className="report-pagination"><span>{reportPagination.total ?? 0} records · page {page} of {Math.max(1, reportPagination.totalPages ?? 0)}</span><div><button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button><button disabled={page >= (reportPagination.totalPages ?? 0)} onClick={() => setPage((p) => p + 1)}>Next</button></div></div>
    </>}
  </section>
}
