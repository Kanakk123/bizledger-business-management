import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import './purchases.css'

const statuses = ['DRAFT', 'SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']
const canWrite = (user) => user.role === 'ADMIN' || user.role === 'MANAGER'
const money = (value) => `₹${Number(value || 0).toFixed(2)}`
const dateText = (value) => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value)) : '—'
const emptyLine = () => ({ productId: '', quantity: '1', unitPrice: '', discountPercent: '0', taxRate: '0' })

function Heading({ title, subtitle, actions }) {
  return <div className="products-heading"><div><p className="products-kicker">PURCHASING / ORDERS</p><h1>{title}</h1><p>{subtitle}</p></div>{actions && <div className="products-heading-actions">{actions}</div>}</div>
}
function Loading({ label }) { return <div className="products-state"><span className="products-spinner" />{label}</div> }
function ErrorState({ message, retry }) { return <div className="products-state products-error" role="alert"><span className="state-icon">!</span><strong>We couldn’t load this view</strong><p>{message}</p>{retry && <button className="button button-outline" onClick={retry}>Try again</button>}</div> }
function statusLabel(status) { return status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) }
function cents(value) {
  const match = String(value || '0').match(/^(\d+)(?:\.(\d{1,2}))?$/)
  return match ? BigInt(match[1]) * 100n + BigInt(((match[2] || '') + '00').slice(0, 2)) : 0n
}
function milli(value) {
  const match = String(value || '0').match(/^(\d+)(?:\.(\d{1,3}))?$/)
  return match ? BigInt(match[1]) * 1000n + BigInt(((match[2] || '') + '000').slice(0, 3)) : 0n
}
function percentBasis(value) {
  const match = String(value || '0').match(/^(\d+)(?:\.(\d{1,2}))?$/)
  return match ? BigInt(match[1]) * 100n + BigInt(((match[2] || '') + '00').slice(0, 2)) : 0n
}
function showCents(value) { return `₹${value / 100n}.${String(value % 100n).padStart(2, '0')}` }
function showMilli(value) { const whole = value / 1000n; const fraction = String(value % 1000n).padStart(3, '0').replace(/0+$/, ''); return fraction ? `${whole}.${fraction}` : String(whole) }
function preview(lines, charges) {
  let total = 0n
  for (const line of lines) {
    const base = (milli(line.quantity) * cents(line.unitPrice) + 500n) / 1000n
    const discount = (base * percentBasis(line.discountPercent) + 5000n) / 10000n
    const tax = ((base - discount) * percentBasis(line.taxRate) + 5000n) / 10000n
    total += base - discount + tax
  }
  return showCents(total + cents(charges))
}

export default function PurchaseOrdersWorkspace({ path, navigate, user }) {
  const parts = path.split('/').filter(Boolean)
  if (parts[1] === 'new') return <OrderForm navigate={navigate} />
  if (parts[1] && /^\d+$/.test(parts[1]) && parts[2] === 'edit') return <OrderForm id={Number(parts[1])} navigate={navigate} />
  if (parts[1] && /^\d+$/.test(parts[1])) return <OrderDetail id={Number(parts[1])} navigate={navigate} user={user} />
  return <OrderList navigate={navigate} user={user} />
}

function OrderList({ navigate, user }) {
  const [orders, setOrders] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ALL')
  const [supplierId, setSupplierId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 })
  const [state, setState] = useState({ key: '', loading: true, error: '' })
  const [reload, setReload] = useState(0)
  const write = canWrite(user)
  const key = `${search}|${status}|${supplierId}|${dateFrom}|${dateTo}|${page}|${reload}`

  useEffect(() => {
    let live = true
    api('/api/suppliers?status=ACTIVE&page=1&pageSize=100').then((result) => { if (live) setSuppliers(result.items) }).catch(() => {})
    const query = new URLSearchParams({ search, status, page: String(page), pageSize: '20' })
    if (supplierId) query.set('supplierId', supplierId)
    if (dateFrom) query.set('dateFrom', dateFrom)
    if (dateTo) query.set('dateTo', dateTo)
    api(`/api/purchases?${query}`).then((result) => {
      if (live) { setOrders(result.items); setPagination(result.pagination); setState({ key, loading: false, error: '' }) }
    }).catch((error) => { if (live) setState({ key, loading: false, error: error.message }) })
    return () => { live = false }
  }, [key, search, status, supplierId, dateFrom, dateTo, page, reload])

  const loading = state.key !== key || state.loading
  const error = state.key === key ? state.error : ''
  return <div className="products-page purchase-page">
    <Heading title="Purchase orders" subtitle="Create supplier orders, follow progress and receive stock." actions={write && <button className="button button-primary" onClick={() => navigate(null, '/purchases/new')}>＋ New purchase order</button>} />
    <div className="products-toolbar purchase-toolbar">
      <label className="product-search"><span>⌕</span><input aria-label="Search purchase orders" placeholder="Search order or supplier" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></label>
      <select aria-label="Filter by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option value="ALL">All statuses</option>{statuses.map((value) => <option value={value} key={value}>{statusLabel(value)}</option>)}</select>
      <select aria-label="Filter by supplier" value={supplierId} onChange={(event) => { setSupplierId(event.target.value); setPage(1) }}><option value="">All suppliers</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.companyName || supplier.name}</option>)}</select>
      <label className="purchase-date">From<input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1) }} /></label>
      <label className="purchase-date">To<input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1) }} /></label>
    </div>
    {loading ? <Loading label="Loading purchase orders…" /> : error ? <ErrorState message={error} retry={() => setReload((value) => value + 1)} /> : orders.length === 0 ? <div className="products-empty"><span>↙</span><strong>No purchase orders found</strong><p>{write ? 'Create an order to start tracking supplier purchases and incoming stock.' : 'Try changing the search or filters.'}</p>{write && <button className="button button-primary" onClick={() => navigate(null, '/purchases/new')}>Create purchase order</button>}</div> : <>
      <div className="products-table-wrap"><table className="products-table"><thead><tr><th>ORDER</th><th>SUPPLIER</th><th>ORDER DATE</th><th>EXPECTED</th><th>LINES / RECEIPTS</th><th>TOTAL</th><th>STATUS</th><th /></tr></thead><tbody>{orders.map((order) => <tr key={order.id} onClick={() => navigate(null, `/purchases/${order.id}`)} className="purchase-click-row"><td><strong>{order.orderNumber}</strong></td><td>{order.supplier.companyName || order.supplier.name}</td><td>{dateText(order.orderDate)}</td><td>{dateText(order.expectedDelivery)}</td><td>{order._count.items} / {order._count.receipts}</td><td>{money(order.totalAmount)}</td><td><span className={`purchase-status status-${order.status.toLowerCase()}`}>{statusLabel(order.status)}</span></td><td><button className="purchase-open" aria-label={`Open ${order.orderNumber}`} onClick={(event) => { event.stopPropagation(); navigate(null, `/purchases/${order.id}`) }}>View →</button></td></tr>)}</tbody></table></div>
      <div className="products-pagination"><span>{pagination.total} purchase orders</span><div><span>Page {pagination.page} of {Math.max(1, pagination.totalPages)}</span><button className="button button-outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="button button-outline" disabled={page >= pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
    </>}
  </div>
}

function OrderForm({ id, navigate }) {
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [form, setForm] = useState({ supplierId: '', expectedDelivery: '', additionalCharges: '0', remarks: '', deliveryInstructions: '', items: [emptyLine()] })
  const [state, setState] = useState({ loading: true, error: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    Promise.all([api('/api/suppliers?status=ACTIVE&page=1&pageSize=100'), api('/api/products?page=1&pageSize=100'), ...(id ? [api(`/api/purchases/${id}`)] : [])]).then(([supplierResult, productResult, orderResult]) => {
      if (!live) return
      setSuppliers(supplierResult.items)
      setProducts(productResult.items.filter((product) => product.isActive))
      if (orderResult) {
        const order = orderResult.data
        if (order.status !== 'DRAFT') throw new Error('Only draft purchase orders can be edited.')
        setForm({ supplierId: String(order.supplierId), expectedDelivery: order.expectedDelivery ? new Date(order.expectedDelivery).toISOString().slice(0, 10) : '', additionalCharges: String(order.additionalCharges), remarks: order.remarks || '', deliveryInstructions: order.deliveryInstructions || '', items: order.items.map((item) => ({ productId: String(item.productId), quantity: String(item.orderedQuantity), unitPrice: String(item.unitPrice), discountPercent: String(item.discountPercent), taxRate: String(item.taxRate) })) })
      }
      setState({ loading: false, error: '' })
    }).catch((error) => { if (live) setState({ loading: false, error: error.message }) })
    return () => { live = false }
  }, [id])

  function setField(field, value) { setForm((current) => ({ ...current, [field]: value })) }
  function changeLine(index, field, value) {
    setForm((current) => ({ ...current, items: current.items.map((line, lineIndex) => {
      if (index !== lineIndex) return line
      if (field === 'productId') {
        const product = products.find((item) => item.id === Number(value))
        return { ...line, productId: value, unitPrice: product ? String(product.purchasePrice) : '', taxRate: product ? String(product.taxRate) : '0' }
      }
      return { ...line, [field]: value }
    }) }))
  }
  async function submit(event) {
    event.preventDefault(); setSaving(true); setState({ loading: false, error: '' })
    const body = { supplierId: Number(form.supplierId), expectedDelivery: form.expectedDelivery || null, additionalCharges: form.additionalCharges || '0', remarks: form.remarks || null, deliveryInstructions: form.deliveryInstructions || null, items: form.items.map((line) => ({ productId: Number(line.productId), quantity: line.quantity, unitPrice: line.unitPrice, discountPercent: line.discountPercent || '0', taxRate: line.taxRate || '0' })) }
    try {
      const result = await api(id ? `/api/purchases/${id}` : '/api/purchases', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) })
      navigate(null, `/purchases/${result.data.id}`)
    } catch (error) { setState({ loading: false, error: error.message }) }
    finally { setSaving(false) }
  }
  if (state.loading) return <div className="products-page"><Loading label="Loading order form…" /></div>
  if (state.error && (suppliers.length === 0 || products.length === 0)) return <div className="products-page"><Heading title={id ? 'Edit purchase order' : 'New purchase order'} subtitle="" /><ErrorState message={state.error} /></div>
  return <div className="products-page purchase-page">
    <Heading title={id ? 'Edit purchase order' : 'New purchase order'} subtitle="Set supplier, delivery details and item pricing. The server calculates the final totals." actions={<button className="button button-outline" onClick={() => navigate(null, '/purchases')}>← Orders</button>} />
    {state.error && <div className="inline-error" role="alert">{state.error}</div>}
    <form className="purchase-form" onSubmit={submit}>
      {suppliers.length === 0 && <div className="inline-warning">Add an active supplier before creating a purchase order.</div>}
      {products.length === 0 && <div className="inline-warning">Add an active product before creating a purchase order.</div>}
      <section className="detail-card purchase-section"><div className="detail-card-heading"><div><span className="detail-kicker">SUPPLIER & DELIVERY</span><h2>Order details</h2></div></div><div className="purchase-form-grid"><label className="purchase-field">Supplier<select value={form.supplierId} onChange={(event) => setField('supplierId', event.target.value)} required><option value="">Choose active supplier</option>{suppliers.map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.companyName ? `${supplier.companyName} · ${supplier.name}` : supplier.name}</option>)}</select></label><label className="purchase-field">Expected delivery<input type="date" value={form.expectedDelivery} onChange={(event) => setField('expectedDelivery', event.target.value)} /></label><label className="purchase-field">Delivery instructions<textarea rows="2" maxLength="10000" value={form.deliveryInstructions} onChange={(event) => setField('deliveryInstructions', event.target.value)} /></label><label className="purchase-field">Remarks<textarea rows="2" maxLength="10000" value={form.remarks} onChange={(event) => setField('remarks', event.target.value)} /></label></div></section>
      <section className="detail-card purchase-section"><div className="detail-card-heading"><div><span className="detail-kicker">ORDER ITEMS</span><h2>Products</h2></div><button className="button button-outline" type="button" onClick={() => setField('items', [...form.items, emptyLine()])}>＋ Add line</button></div><div className="purchase-lines">{form.items.map((line, index) => <div className="purchase-line" key={index}><label className="purchase-field line-product">Product<select value={line.productId} required onChange={(event) => changeLine(index, 'productId', event.target.value)}><option value="">Choose product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></label><label className="purchase-field">Quantity<input required min="0.001" step="0.001" type="number" value={line.quantity} onChange={(event) => changeLine(index, 'quantity', event.target.value)} /></label><label className="purchase-field">Unit price<input required min="0.01" step="0.01" type="number" value={line.unitPrice} onChange={(event) => changeLine(index, 'unitPrice', event.target.value)} /></label><label className="purchase-field">Discount %<input min="0" max="100" step="0.01" type="number" value={line.discountPercent} onChange={(event) => changeLine(index, 'discountPercent', event.target.value)} /></label><label className="purchase-field">Tax %<input min="0" max="100" step="0.01" type="number" value={line.taxRate} onChange={(event) => changeLine(index, 'taxRate', event.target.value)} /></label><strong className="purchase-line-total">{preview([line], '0')}</strong><button className="purchase-remove" type="button" aria-label="Remove product line" disabled={form.items.length === 1} onClick={() => setField('items', form.items.filter((_, lineIndex) => lineIndex !== index))}>×</button></div>)}</div><label className="purchase-field charges-field">Additional charges<input type="number" min="0" step="0.01" value={form.additionalCharges} onChange={(event) => setField('additionalCharges', event.target.value)} /></label><div className="purchase-total-preview"><span>Estimated total <small>Final total is calculated by BizLedger.</small></span><strong>{preview(form.items, form.additionalCharges)}</strong></div></section>
      <div className="purchase-form-actions"><button className="button button-outline" type="button" onClick={() => navigate(null, '/purchases')}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : id ? 'Save changes' : 'Create draft order'}</button></div>
    </form>
  </div>
}

function OrderDetail({ id, navigate, user }) {
  const [order, setOrder] = useState(null)
  const [receiptQuantities, setReceiptQuantities] = useState({})
  const [notes, setNotes] = useState('')
  const [state, setState] = useState({ loading: true, error: '' })
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const idempotencyKey = useRef(null)
  const write = canWrite(user)
  const refresh = () => setReload((value) => value + 1)
  useEffect(() => {
    let live = true
    api(`/api/purchases/${id}`).then((result) => { if (live) { setOrder(result.data); setState({ loading: false, error: '' }) } }).catch((error) => { if (live) setState({ loading: false, error: error.message }) })
    return () => { live = false }
  }, [id, reload])

  async function transition(status) {
    if (status === 'CANCELLED' && !window.confirm(`Cancel ${order.orderNumber}? Received stock remains recorded.`)) return
    setBusy(true); setActionError(''); setNotice('')
    try { await api(`/api/purchases/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); setNotice(`Order status changed to ${statusLabel(status)}.`); refresh() }
    catch (error) { setActionError(error.message) } finally { setBusy(false) }
  }
  async function receive(event) {
    event.preventDefault(); setBusy(true); setActionError(''); setNotice('')
    const items = order.items.map((item) => ({ purchaseOrderItemId: item.id, quantity: receiptQuantities[item.id] || '0' })).filter((item) => Number(item.quantity) > 0)
    if (items.length === 0) { setActionError('Enter at least one received quantity.'); setBusy(false); return }
    idempotencyKey.current ||= crypto.randomUUID()
    try {
      const result = await api(`/api/purchases/${id}/receipts`, { method: 'POST', body: JSON.stringify({ idempotencyKey: idempotencyKey.current, notes: notes || null, items }) })
      idempotencyKey.current = null; setReceiptQuantities({}); setNotes(''); setNotice(result.data.replayed ? 'This delivery was already recorded.' : 'Goods receipt recorded and inventory updated.'); refresh()
    } catch (error) { setActionError(error.message) } finally { setBusy(false) }
  }
  async function createInvoice() {
    setBusy(true); setActionError(''); setNotice('')
    try { const result = await api(`/api/purchases/${id}/invoice`, { method: 'POST' }); setNotice(result.data.created ? 'Purchase invoice created.' : 'This purchase order already has an invoice.'); refresh() }
    catch (error) { setActionError(error.message) } finally { setBusy(false) }
  }
  if (state.loading) return <div className="products-page"><Loading label="Loading purchase order…" /></div>
  if (state.error || !order) return <div className="products-page"><Heading title="Purchase order" subtitle="" actions={<button className="button button-outline" onClick={() => navigate(null, '/purchases')}>← Orders</button>} /><ErrorState message={state.error || 'Purchase order not found'} retry={refresh} /></div>

  const remaining = (item) => { const amount = milli(item.orderedQuantity) - milli(item.receivedQuantity); return amount > 0n ? showMilli(amount) : '0' }
  const canReceive = write && ['CONFIRMED', 'PARTIALLY_RECEIVED'].includes(order.status)
  const nextStatuses = order.status === 'DRAFT' ? ['SENT', 'CANCELLED'] : order.status === 'SENT' ? ['CONFIRMED', 'CANCELLED'] : ['CONFIRMED', 'PARTIALLY_RECEIVED'].includes(order.status) ? ['CANCELLED'] : []
  return <div className="products-page purchase-page">
    <Heading title={order.orderNumber} subtitle={`${order.supplier.companyName || order.supplier.name} · Created ${dateText(order.orderDate)}`} actions={<><button className="button button-outline" onClick={() => navigate(null, '/purchases')}>← Orders</button>{write && order.status === 'DRAFT' && <button className="button button-outline" onClick={() => navigate(null, `/purchases/${id}/edit`)}>Edit draft</button>}</>} />
    {actionError && <div className="inline-error" role="alert">{actionError}</div>}{notice && <div className="inline-success" role="status">{notice}</div>}
    <div className="purchase-detail-layout"><div className="purchase-detail-main">
      <section className="detail-card purchase-section"><div className="detail-card-heading"><div><span className="detail-kicker">ORDER SUMMARY</span><h2>Order details</h2></div><span className={`purchase-status status-${order.status.toLowerCase()}`}>{statusLabel(order.status)}</span></div><div className="purchase-summary-grid"><div><small>Supplier</small><strong>{order.supplier.companyName || order.supplier.name}</strong><span>{order.supplier.email || order.supplier.phone || '—'}</span></div><div><small>Expected delivery</small><strong>{dateText(order.expectedDelivery)}</strong></div><div><small>Order remarks</small><strong>{order.remarks || '—'}</strong></div><div><small>Delivery instructions</small><strong>{order.deliveryInstructions || '—'}</strong></div></div>
        <div className="purchase-breakdown-wrap"><table className="purchase-breakdown"><thead><tr><th>PRODUCT</th><th>ORDERED</th><th>RECEIVED</th><th>UNIT PRICE</th><th>DISC. / TAX</th><th>LINE TOTAL</th></tr></thead><tbody>{order.items.map((item) => <tr key={item.id}><td><strong>{item.productName}</strong><small>{item.sku}{item.productDescription ? ` · ${item.productDescription}` : ''}</small></td><td>{item.orderedQuantity} {item.product?.unit || ''}</td><td>{item.receivedQuantity}</td><td>{money(item.unitPrice)}</td><td>{item.discountPercent}% / {item.taxRate}%</td><td>{money(item.lineTotal)}</td></tr>)}</tbody></table></div>
        <div className="purchase-totals"><span>Subtotal <strong>{money(order.subtotal)}</strong></span><span>Discount <strong>−{money(order.discountTotal)}</strong></span><span>Tax <strong>{money(order.taxTotal)}</strong></span><span>Additional charges <strong>{money(order.additionalCharges)}</strong></span><b>Total <strong>{money(order.totalAmount)}</strong></b></div>
      </section>
      {canReceive && <section className="detail-card purchase-section"><div className="detail-card-heading"><div><span className="detail-kicker">GOODS RECEIPT</span><h2>Record delivery</h2></div></div><form onSubmit={receive}><div className="purchase-receive-list">{order.items.map((item) => <label key={item.id} className="purchase-receive-row"><span><strong>{item.productName}</strong><small>{item.receivedQuantity} received · {remaining(item)} remaining</small></span><input type="number" aria-label={`Received quantity for ${item.productName}`} min="0" max={remaining(item)} step="0.001" disabled={remaining(item) === 0} value={receiptQuantities[item.id] ?? ''} onChange={(event) => setReceiptQuantities((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="0" /></label>)}</div><label className="purchase-field">Delivery note<textarea rows="2" maxLength="10000" value={notes} onChange={(event) => setNotes(event.target.value)} /></label><button className="button button-primary" disabled={busy}>Record receipt and update stock</button></form></section>}
      <section className="detail-card purchase-section"><div className="detail-card-heading"><div><span className="detail-kicker">RECEIPT HISTORY</span><h2>Deliveries</h2></div><span className="history-count">{order.receipts.length} receipts</span></div>{order.receipts.length === 0 ? <p className="history-empty">No deliveries have been recorded.</p> : <div className="purchase-receipts">{order.receipts.map((receipt) => <article className="purchase-receipt" key={receipt.id}><div><strong>{receipt.receiptNumber}</strong><small>{dateText(receipt.receivedAt)} · {receipt.receivedBy?.name || 'User'}{receipt.notes ? ` · ${receipt.notes}` : ''}</small></div><ul>{receipt.items.map((item) => <li key={item.id}>{item.purchaseOrderItem.productName}: +{item.quantity}</li>)}</ul></article>)}</div>}</section>
      <section className="detail-card purchase-section"><div className="detail-card-heading"><div><span className="detail-kicker">PAYABLES</span><h2>Purchase invoice</h2></div>{write && !order.invoice && !['DRAFT', 'CANCELLED'].includes(order.status) && <button className="button button-outline" disabled={busy} onClick={createInvoice}>Create invoice</button>}</div>{order.invoice ? <div className="purchase-invoice"><div><strong>{order.invoice.invoiceNumber}</strong><small>{statusLabel(order.invoice.status)} · {money(order.invoice.totalAmount)} total · {money(order.invoice.paidAmount)} paid · {showCents(cents(order.invoice.totalAmount) - cents(order.invoice.paidAmount))} outstanding</small></div>{order.invoice.payments.length === 0 ? <p className="history-empty">No supplier payments recorded yet.</p> : order.invoice.payments.map((payment) => <div className="purchase-payment" key={payment.id}><span>{dateText(payment.paymentDate)} · {payment.method}</span><strong>{money(payment.amount)}</strong></div>)}</div> : <p className="history-empty">No purchase invoice linked yet.</p>}</section>
    </div><aside className="purchase-detail-side"><section className="detail-card purchase-actions-card"><span className="detail-kicker">WORKFLOW</span><h2>Order status</h2>{nextStatuses.map((status) => <button className={status === 'CANCELLED' ? 'button button-outline purchase-cancel' : 'button button-primary'} key={status} disabled={busy} onClick={() => transition(status)}>{status === 'CANCELLED' ? 'Cancel order' : `Mark ${statusLabel(status)}`}</button>)}<p>{order.status === 'RECEIVED' ? 'All ordered quantities have been received. Cancellation requires a separate reversal workflow.' : order.status === 'CANCELLED' ? 'This order is cancelled. Recorded deliveries and stock history remain preserved.' : 'Only valid status transitions are available.'}</p></section></aside></div>
  </div>
}
