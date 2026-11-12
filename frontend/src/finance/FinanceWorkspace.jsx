import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import './finance.css'

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const date = (v) => v ? new Date(v).toLocaleDateString() : '—'
const writable = (user) => ['ADMIN', 'MANAGER'].includes(user.role)

export default function FinanceWorkspace({ kind, user }) {
  const paymentsPage = kind === 'Payments'
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(null)
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState('')
  const [type, setType] = useState('ALL')
  const [supplierId, setSupplierId] = useState('')
  const [buyerId, setBuyerId] = useState('')
  const [suppliers, setSuppliers] = useState([])
  const [buyers, setBuyers] = useState([])
  const [status, setStatus] = useState('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState(null)
  const [busy, setBusy] = useState(false)
  const [savingPayment, setSavingPayment] = useState(false)
  const paymentKey = useRef(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState({ invoiceId: '', amount: '', method: 'BANK_TRANSFER', paymentDate: new Date().toISOString().slice(0, 10), transactionReference: '' })
  const [metadata, setMetadata] = useState({ dueDate: '', notes: '', paymentTerms: '' })

  const load = useCallback(async () => {
    setBusy(true); setError('')
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20', search: query, type, ...(paymentsPage ? {} : { status }), ...(supplierId ? { supplierId } : {}), ...(buyerId ? { buyerId } : {}), ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}) })
      const result = await api(`${paymentsPage ? '/api/payments' : '/api/invoices'}?${params}`)
      setItems(result.items); setPagination(result.pagination)
      if (!paymentsPage) {
        const cards = await api('/api/invoices/summary')
        setSummary(cards.data)
      }
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }, [buyerId, dateFrom, dateTo, page, paymentsPage, query, status, supplierId, type])
  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])
  useEffect(() => {
    if (paymentsPage) return undefined
    let active = true
    Promise.all([api('/api/suppliers?status=ALL&page=1&pageSize=100'), api('/api/buyers?status=ALL&page=1&pageSize=100')]).then(([s, b]) => {
      if (active) { setSuppliers(s.items); setBuyers(b.items) }
    }).catch((e) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [paymentsPage])

  async function open(item) {
    try {
      const result = await api(`${paymentsPage ? '/api/payments' : '/api/invoices'}/${item.id}`)
      setSelected(result.data)
      if (!paymentsPage) {
        setForm((v) => ({ ...v, invoiceId: String(item.id), amount: result.data.outstandingAmount }))
        setMetadata({ dueDate: result.data.dueDate ? result.data.dueDate.slice(0, 10) : '', notes: result.data.notes || '', paymentTerms: result.data.paymentTerms || '' })
      }
    } catch (e) { setError(e.message) }
  }
  async function recordPayment(e) {
    e.preventDefault(); setError(''); setNotice(''); setSavingPayment(true)
    try {
      paymentKey.current ||= crypto.randomUUID()
      await api('/api/payments', { method: 'POST', body: JSON.stringify({ ...form, invoiceId: Number(form.invoiceId), idempotencyKey: paymentKey.current }) })
      paymentKey.current = null
      setNotice('Payment recorded successfully.')
      if (selected) await open(selected)
      await load()
    } catch (e) { setError(e.message) } finally { setSavingPayment(false) }
  }
  async function saveMetadata() {
    setError(''); setNotice('')
    try {
      const result = await api(`/api/invoices/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ dueDate: metadata.dueDate || null, notes: metadata.notes || null, paymentTerms: metadata.paymentTerms || null }) })
      setSelected(result.data); setNotice('Invoice details saved. Issued amounts and line items remain unchanged.'); await load()
    } catch (e) { setError(e.message) }
  }
  async function downloadPdf(invoice) {
    try {
      const response = await fetch(`${API_URL}/api/invoices/${invoice.id}/pdf`, { credentials: 'include' })
      if (!response.ok) throw new Error('Could not download this invoice PDF.')
      const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = `${invoice.invoiceNumber}.pdf`; a.click(); URL.revokeObjectURL(url)
    } catch (e) { setError(e.message) }
  }

  return <section className="page-content finance-page">
    <div className="page-heading"><div><p className="page-kicker">YOUR WORKSPACE&nbsp; / &nbsp;FINANCE</p><h1>{kind}</h1><p className="page-subtitle">Invoices, recorded payments and current balances.</p></div></div>
    {!paymentsPage && summary && <div className="finance-summary">
      {[['Accounts receivable', summary.accountsReceivable], ['Accounts payable', summary.accountsPayable], ['Collected from buyers', summary.totalCollected], ['Paid to suppliers', summary.totalPaidToSuppliers], ['Overdue receivables', summary.overdueReceivables], ['Overdue payables', summary.overduePayables], ['Unpaid invoices', summary.unpaidCount], ['Partially paid invoices', summary.partiallyPaidCount], ['Overdue invoices', summary.overdueCount]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{label.toLowerCase().includes('invoice') ? value : money(value)}</strong></article>)}
    </div>}
    {!paymentsPage && summary && <div className="partner-balances"><div><h3>Supplier balances</h3>{summary.supplierOutstanding.length ? summary.supplierOutstanding.map((x) => <p key={x.partnerId}>{x.partnerName}<strong>{money(x.amount)}</strong></p>) : <p>No supplier balances outstanding.</p>}</div><div><h3>Buyer balances</h3>{summary.buyerOutstanding.length ? summary.buyerOutstanding.map((x) => <p key={x.partnerId}>{x.partnerName}<strong>{money(x.amount)}</strong></p>) : <p>No buyer balances outstanding.</p>}</div></div>}
    <div className="finance-toolbar"><input aria-label="Search" placeholder="Search invoice or reference" value={query} onChange={(e) => { setPage(1); setQuery(e.target.value) }} /><select aria-label="Invoice type" value={type} onChange={(e) => { const next = e.target.value; setType(next); if (next === 'PURCHASE') setBuyerId(''); if (next === 'SALES') setSupplierId('') }}><option value="ALL">Purchases & sales</option><option value="PURCHASE">Purchase</option><option value="SALES">Sales</option></select>{!paymentsPage && <select aria-label="Payment status" value={status} onChange={(e) => setStatus(e.target.value)}>{['ALL', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>}{(type === 'ALL' || type === 'PURCHASE') && <select aria-label="Supplier" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); if (e.target.value) setBuyerId('') }}><option value="">All suppliers</option>{suppliers.map((p) => <option key={p.id} value={p.id}>{p.name}{p.companyName ? ` · ${p.companyName}` : ''}</option>)}</select>}{(type === 'ALL' || type === 'SALES') && <select aria-label="Buyer" value={buyerId} onChange={(e) => { setBuyerId(e.target.value); if (e.target.value) setSupplierId('') }}><option value="">All buyers</option>{buyers.map((p) => <option key={p.id} value={p.id}>{p.name}{p.companyName ? ` · ${p.companyName}` : ''}</option>)}</select>}<input aria-label="Date from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /><input aria-label="Date to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
    {error && <div className="finance-error" role="alert">{error}</div>}{notice && <div className="finance-notice" role="status">{notice}</div>}
    {busy ? <div className="finance-state">Loading {kind.toLowerCase()}…</div> : items.length === 0 ? <div className="finance-state">No {kind.toLowerCase()} found. Invoices are created from their purchase or sales order.</div> : <div className="finance-table-wrap"><table className="finance-table"><thead><tr>{paymentsPage ? <><th>Invoice</th><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th></> : <><th>Invoice</th><th>Type</th><th>Partner</th><th>Date due</th><th>Status</th><th>Total</th><th>Outstanding</th></>}</tr></thead><tbody>{items.map((item) => <tr key={item.id} onClick={() => open(item)} tabIndex="0" onKeyDown={(e) => e.key === 'Enter' && open(item)}>{paymentsPage ? <><td>{item.invoice.invoiceNumber}</td><td>{date(item.paymentDate)}</td><td>{item.method}</td><td>{item.transactionReference || '—'}</td><td>{money(item.amount)}</td></> : <><td>{item.invoiceNumber}</td><td>{item.type}</td><td>{item.partnerName || (item.type === 'PURCHASE' ? item.purchaseOrder?.supplier?.name : item.salesOrder?.buyer?.name) || '—'}</td><td>{date(item.dueDate)}</td><td><span className={`finance-status status-${item.status.toLowerCase()}`}>{item.status.replace('_', ' ')}</span></td><td>{money(item.totalAmount)}</td><td>{money(item.outstandingAmount)}</td></>}</tr>)}</tbody></table></div>}
    <div className="finance-pagination"><span>{pagination ? `${pagination.total} records` : ''}</span><div><button disabled={page <= 1} onClick={() => setPage((v) => v - 1)}>Previous</button><span>Page {page} of {Math.max(1, pagination?.totalPages || 1)}</span><button disabled={!pagination || page >= pagination.totalPages} onClick={() => setPage((v) => v + 1)}>Next</button></div></div>
    {selected && <div className="finance-overlay" role="presentation" onClick={() => setSelected(null)}><section className="finance-detail" role="dialog" aria-modal="true" aria-label="Financial record" onClick={(e) => e.stopPropagation()}><button className="finance-close" onClick={() => setSelected(null)} aria-label="Close">×</button>
      {paymentsPage ? <><p className="page-kicker">PAYMENT DETAIL</p><h2>{money(selected.amount)}</h2><p>{selected.invoice?.invoiceNumber} · {selected.method} · {date(selected.paymentDate)}</p><p>Reference: {selected.transactionReference || '—'}</p><h3>Audit history</h3>{(selected.auditHistory || []).map((entry) => <p key={entry.id}>{entry.action} · {date(entry.createdAt)}</p>)}</> : <><p className="page-kicker">{selected.type} INVOICE</p><h2>{selected.invoiceNumber}</h2><p>{selected.partnerName} {selected.partnerCompany && `· ${selected.partnerCompany}`}</p><p>{date(selected.invoiceDate)} · Due {date(selected.dueDate)} · {selected.status}</p><div className="finance-actions"><button onClick={() => downloadPdf(selected)}>Download PDF</button><button onClick={() => window.print()}>Print</button></div><h3>Items</h3><div className="invoice-lines">{selected.items.map((line) => <p key={line.id}>{line.productName} · {line.sku} · {line.description || ''} · {line.quantity} × {money(line.unitPrice)} · discount {money(line.discountAmount)} · tax {money(line.taxAmount)} · {money(line.lineTotal)}</p>)}</div><p>Subtotal {money(selected.subtotal)} · Discount {money(selected.discountTotal)} · Tax {money(selected.taxTotal)} · Charges {money(selected.additionalCharges)}</p><strong>Total {money(selected.totalAmount)} · Paid {money(selected.paidAmount)} · Due {money(selected.outstandingAmount)}</strong><h3>Payment history</h3>{selected.payments.length ? selected.payments.map((p) => <p key={p.id}>{date(p.paymentDate)} · {p.method} · {money(p.amount)} · {p.transactionReference || '—'}</p>) : <p>No payments recorded yet.</p>}
        {writable(user) && <div className="invoice-meta"><h3>Invoice terms and notes</h3><label>Due date<input type="date" value={metadata.dueDate} onChange={(e) => setMetadata({ ...metadata, dueDate: e.target.value })} /></label><label>Payment terms<input maxLength="100" value={metadata.paymentTerms} onChange={(e) => setMetadata({ ...metadata, paymentTerms: e.target.value })} /></label><label>Notes<textarea rows="3" value={metadata.notes} onChange={(e) => setMetadata({ ...metadata, notes: e.target.value })} /></label><button onClick={saveMetadata}>Save invoice details</button></div>}
        {writable(user) && Number(selected.outstandingAmount) > 0 && <form className="payment-form" onSubmit={recordPayment}><h3>Record a payment</h3><label>Amount<input required inputMode="decimal" value={form.amount} max={selected.outstandingAmount} onChange={(e) => { paymentKey.current = null; setForm({ ...form, amount: e.target.value }) }} /></label><label>Date<input required type="date" value={form.paymentDate} onChange={(e) => { paymentKey.current = null; setForm({ ...form, paymentDate: e.target.value }) }} /></label><label>Method<select value={form.method} onChange={(e) => { paymentKey.current = null; setForm({ ...form, method: e.target.value }) }}>{['CASH', 'BANK_TRANSFER', 'UPI', 'CARD', 'CHEQUE', 'OTHER'].map((m) => <option key={m}>{m}</option>)}</select></label><label>Reference<input value={form.transactionReference} maxLength="150" onChange={(e) => { paymentKey.current = null; setForm({ ...form, transactionReference: e.target.value }) }} /></label><button type="submit" disabled={savingPayment}>{savingPayment ? 'Saving…' : 'Save payment'}</button></form>}
      </>}
    </section></div>}
  </section>
}
