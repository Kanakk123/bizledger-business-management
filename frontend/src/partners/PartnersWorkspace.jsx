import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import './partners.css'

const CONFIG = {
  supplier: { title: 'Suppliers', singular: 'Supplier', path: '/suppliers', endpoint: '/api/suppliers', relation: 'purchaseOrders', historyTitle: 'Purchase history', historyNumber: 'orderNumber' },
  buyer: { title: 'Buyers', singular: 'Buyer', path: '/buyers', endpoint: '/api/buyers', relation: 'salesOrders', historyTitle: 'Sales history', historyNumber: 'orderNumber' },
}
const canWrite = (user) => user.role === 'ADMIN' || user.role === 'MANAGER'
const optionalFields = (kind) => kind === 'supplier'
  ? ['companyName', 'email', 'phone', 'address', 'city', 'state', 'postalCode', 'country', 'taxRegistration', 'paymentTerms', 'notes']
  : ['companyName', 'email', 'phone', 'billingAddress', 'shippingAddress', 'city', 'state', 'postalCode', 'country', 'taxRegistration', 'notes']
const FIELD_META = {
  name: { label: 'Contact name', required: true }, companyName: { label: 'Company name' }, email: { label: 'Email address', type: 'email' },
  phone: { label: 'Phone number', type: 'tel', placeholder: '+91 98765 43210' }, address: { label: 'Address', rows: 3 },
  billingAddress: { label: 'Billing address', rows: 3 }, shippingAddress: { label: 'Shipping address', rows: 3 },
  city: { label: 'City' }, state: { label: 'State / region' }, postalCode: { label: 'Postal code' }, country: { label: 'Country' },
  taxRegistration: { label: 'GSTIN', placeholder: '15 character GSTIN', maxLength: 15 }, paymentTerms: { label: 'Payment terms', placeholder: 'e.g. Net 30' }, notes: { label: 'Additional notes', rows: 4 },
}
const emptyPartner = (kind) => Object.fromEntries(['name', ...optionalFields(kind)].map((field) => [field, '']))
const display = (value) => value || '—'
const formatDate = (value) => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value)) : '—'
const formatMoney = (value) => value == null ? '—' : `₹${value}`

function PartnerHeading({ kicker, title, subtitle, actions }) {
  return <div className="partners-heading"><div><p className="partners-kicker">{kicker}</p><h1>{title}</h1><p>{subtitle}</p></div>{actions && <div className="partners-heading-actions">{actions}</div>}</div>
}

function PartnerLoading({ label = 'Loading records…' }) {
  return <div className="partners-state"><span className="partners-spinner" />{label}</div>
}

function PartnerError({ message, onRetry }) {
  return <div className="partners-state partners-error" role="alert"><span className="partners-error-icon">!</span><strong>We couldn’t load this view</strong><p>{message}</p><button className="partner-button partner-button-outline" onClick={onRetry}>Try again</button></div>
}

export default function PartnersWorkspace({ kind, path, navigate, user }) {
  const config = CONFIG[kind]
  if (!config) return null
  const parts = path.split('/').filter(Boolean)
  if (parts[1] === 'new') return <PartnerForm kind={kind} navigate={navigate} />
  if (parts[1] && /^\d+$/.test(parts[1]) && parts[2] === 'edit') return <PartnerForm kind={kind} id={Number(parts[1])} navigate={navigate} />
  if (parts[1] && /^\d+$/.test(parts[1])) return <PartnerDetail kind={kind} id={Number(parts[1])} navigate={navigate} user={user} />
  return <PartnerList kind={kind} navigate={navigate} user={user} />
}

function PartnerList({ kind, navigate, user }) {
  const config = CONFIG[kind]
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ACTIVE')
  const [page, setPage] = useState(1)
  const [records, setRecords] = useState([])
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 })
  const [request, setRequest] = useState({ key: null, loading: true, error: '' })
  const [reload, setReload] = useState(0)
  const requestKey = JSON.stringify({ kind, search, status, page, reload })
  const loading = request.key !== requestKey || request.loading
  const error = request.key === requestKey ? request.error : ''
  const write = canWrite(user)

  useEffect(() => { const timer = setTimeout(() => { setSearch(searchInput); setPage(1) }, 250); return () => clearTimeout(timer) }, [searchInput])
  useEffect(() => {
    let active = true
    const filters = JSON.parse(requestKey)
    const query = new URLSearchParams({ search: filters.search, status: filters.status, page: String(filters.page), pageSize: '20' })
    api(`${CONFIG[filters.kind].endpoint}?${query}`)
      .then((result) => { if (active) { setRecords(result.items); setPagination(result.pagination) } })
      .catch((requestError) => { if (active) setRequest({ key: requestKey, loading: true, error: requestError.message }) })
      .finally(() => { if (active) setRequest((previous) => previous.key === requestKey ? { ...previous, loading: false } : { key: requestKey, loading: false, error: '' }) })
    return () => { active = false }
  }, [requestKey])

  return <div className="partners-page">
    <PartnerHeading kicker="BUSINESS CONTACTS / DIRECTORY" title={config.title} subtitle={`Manage your ${config.title.toLowerCase()} and keep related orders close at hand.`} actions={write && <button className="partner-button partner-button-primary" onClick={() => navigate(null, `${config.path}/new`)}>＋ Add {config.singular.toLowerCase()}</button>} />
    <div className="partners-toolbar"><label className="partners-search"><span>⌕</span><input aria-label={`Search ${config.title.toLowerCase()}`} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={`Search name, company, email or phone`} /></label><select aria-label="Filter by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="ALL">All statuses</option></select><span className="partners-result-count">{pagination.total} {pagination.total === 1 ? config.singular.toLowerCase() : config.title.toLowerCase()}</span></div>
    {error ? <PartnerError message={error} onRetry={() => setReload((value) => value + 1)} /> : loading ? <PartnerLoading label={`Loading ${config.title.toLowerCase()}…`} /> : records.length === 0 ? <div className="partners-state partners-empty"><span className="partners-empty-icon">♧</span><strong>{search || status !== 'ACTIVE' ? `No ${config.title.toLowerCase()} match these filters` : `No active ${config.title.toLowerCase()} yet`}</strong><p>{search || status !== 'ACTIVE' ? 'Try another search or status filter.' : `Add a ${config.singular.toLowerCase()} to keep contact and transaction details together.`}</p>{write && !search && status === 'ACTIVE' && <button className="partner-button partner-button-primary" onClick={() => navigate(null, `${config.path}/new`)}>Add your first {config.singular.toLowerCase()}</button>}</div> : <>
      <div className="partners-table-wrap"><table className="partners-table"><thead><tr><th>{config.singular.toUpperCase()}</th><th>CONTACT</th><th>LOCATION</th><th>{kind === 'supplier' ? 'PURCHASE ORDERS' : 'SALES ORDERS'}</th><th>STATUS</th><th /></tr></thead><tbody>{records.map((record) => <tr className="partner-row" key={record.id} onClick={() => navigate(null, `${config.path}/${record.id}`)}><td><div className="partner-name-cell"><span className="partner-avatar">{record.name.trim()[0]?.toUpperCase() || config.singular[0]}</span><span><strong>{record.name}</strong><small>{record.companyName || config.singular}</small></span></div></td><td><span className="partner-contact-main">{record.email || record.phone || 'No contact details'}</span><small className="partner-muted-line">{record.email && record.phone ? record.phone : record.email ? '' : record.phone ? '' : 'Add an email or phone'}</small></td><td>{[record.city, record.state, record.country].filter(Boolean).join(', ') || '—'}</td><td>{record._count?.[kind === 'supplier' ? 'purchaseOrders' : 'salesOrders'] ?? 0}</td><td><span className={`partner-status ${record.status === 'ACTIVE' ? 'partner-status-active' : 'partner-status-inactive'}`}>{record.status === 'ACTIVE' ? 'Active' : 'Inactive'}</span></td><td><button className="partner-row-open" aria-label={`View ${record.name}`} onClick={(event) => { event.stopPropagation(); navigate(null, `${config.path}/${record.id}`) }}>→</button></td></tr>)}</tbody></table></div>
      <div className="partners-pagination"><span>Showing <strong>{Math.min((page - 1) * pagination.pageSize + 1, pagination.total)}–{Math.min(page * pagination.pageSize, pagination.total)}</strong> of <strong>{pagination.total}</strong></span><div><button className="partner-page-button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>← Previous</button><span>Page {page} of {Math.max(1, pagination.totalPages)}</span><button className="partner-page-button" disabled={page >= pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Next →</button></div></div>
    </>}
  </div>
}

function PartnerForm({ kind, id, navigate }) {
  const config = CONFIG[kind]
  const editing = Boolean(id)
  const fields = useMemo(() => ['name', ...optionalFields(kind)], [kind])
  const [form, setForm] = useState(() => emptyPartner(kind))
  const [loading, setLoading] = useState(editing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!editing) return undefined
    let active = true
    api(`${config.endpoint}/${id}`).then(({ data }) => {
      if (active) setForm(Object.fromEntries(fields.map((field) => [field, data[field] ?? ''])))
    }).catch((requestError) => { if (active) setError(requestError.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [config.endpoint, editing, fields, id])

  async function submit(event) {
    event.preventDefault(); setError(''); setSaving(true)
    const payload = Object.fromEntries(fields.map((field) => [field, form[field]?.trim() || null]))
    try {
      const result = await api(editing ? `${config.endpoint}/${id}` : config.endpoint, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) })
      navigate(null, `${config.path}/${result.data.id}`)
    } catch (requestError) {
      const validation = requestError.details?.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' ')
      setError(validation || requestError.message)
    } finally { setSaving(false) }
  }

  if (loading) return <div className="partners-page"><PartnerLoading label={`Loading ${config.singular.toLowerCase()}…`} /></div>
  return <div className="partners-page"><PartnerHeading kicker={`BUSINESS CONTACTS / ${config.singular.toUpperCase()}`} title={editing ? `Edit ${config.singular.toLowerCase()}` : `Add ${config.singular.toLowerCase()}`} subtitle={editing ? 'Update contact information while keeping existing order history.' : `Add contact information for a ${config.singular.toLowerCase()}.`} actions={<button className="partner-button partner-button-outline" onClick={() => navigate(null, editing ? `${config.path}/${id}` : config.path)}>Cancel</button>} />
    {error && <div className="partner-inline-error" role="alert">{error}</div>}
    <form className="partner-form" onSubmit={submit}>
      <section className="partner-form-section"><div className="partner-form-section-heading"><span>01</span><div><strong>Contact information</strong><small>Identity and ways to reach this {config.singular.toLowerCase()}</small></div></div><div className="partner-form-grid">{['name', 'companyName', 'email', 'phone'].map((field) => <PartnerField key={field} field={field} value={form[field]} onChange={(value) => setForm((current) => ({ ...current, [field]: value }))} />)}</div></section>
      <section className="partner-form-section"><div className="partner-form-section-heading"><span>02</span><div><strong>{kind === 'supplier' ? 'Business address' : 'Addresses'}</strong><small>Location and tax registration details</small></div></div><div className="partner-form-grid">{(kind === 'supplier' ? ['address', 'city', 'state', 'postalCode', 'country', 'taxRegistration', 'paymentTerms'] : ['billingAddress', 'shippingAddress', 'city', 'state', 'postalCode', 'country', 'taxRegistration']).map((field) => <PartnerField key={field} field={field} value={form[field]} onChange={(value) => setForm((current) => ({ ...current, [field]: value }))} />)}</div></section>
      <section className="partner-form-section"><div className="partner-form-section-heading"><span>03</span><div><strong>Additional notes</strong><small>Internal notes for your team</small></div></div><div className="partner-form-grid"><PartnerField field="notes" value={form.notes} onChange={(value) => setForm((current) => ({ ...current, notes: value }))} /></div></section>
      <div className="partner-form-actions"><button type="button" className="partner-button partner-button-outline" onClick={() => navigate(null, editing ? `${config.path}/${id}` : config.path)}>Cancel</button><button className="partner-button partner-button-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : `Create ${config.singular.toLowerCase()}`}</button></div>
    </form>
  </div>
}

function PartnerField({ field, value, onChange }) {
  const meta = FIELD_META[field]
  const multiline = Boolean(meta.rows)
  return <label className={`partner-field ${multiline ? 'partner-field-wide' : ''}`}><span>{meta.label}{meta.required && <i> *</i>}</span>{multiline
    ? <textarea rows={meta.rows} value={value} onChange={(event) => onChange(event.target.value)} maxLength={field === 'notes' ? 10000 : 10000} required={meta.required} placeholder={meta.placeholder || ''} />
    : <input type={meta.type || 'text'} value={value} onChange={(event) => onChange(event.target.value)} maxLength={meta.maxLength || (field === 'phone' ? 25 : undefined)} required={meta.required} placeholder={meta.placeholder || ''} autoComplete={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'off'} />}</label>
}

function PartnerDetail({ kind, id, navigate, user }) {
  const config = CONFIG[kind]
  const [record, setRecord] = useState(null)
  const [request, setRequest] = useState({ key: null, loading: true, error: '' })
  const [reload, setReload] = useState(0)
  const [actionError, setActionError] = useState('')
  const write = canWrite(user)
  const requestKey = `${kind}:${id}:${reload}`
  const loading = request.key !== requestKey || request.loading
  const error = request.key === requestKey ? request.error : ''
  useEffect(() => {
    let active = true
    api(`${config.endpoint}/${id}`).then(({ data }) => { if (active) setRecord(data) })
      .catch((requestError) => { if (active) setRequest({ key: requestKey, loading: true, error: requestError.message }) })
      .finally(() => { if (active) setRequest((previous) => previous.key === requestKey ? { ...previous, loading: false } : { key: requestKey, loading: false, error: '' }) })
    return () => { active = false }
  }, [config.endpoint, id, requestKey])

  async function archive() {
    if (!window.confirm(`Archive ${record.name}? Existing orders and payment history will remain available.`)) return
    setActionError('')
    try { await api(`${config.endpoint}/${id}/archive`, { method: 'POST' }); setReload((value) => value + 1) }
    catch (requestError) { setActionError(requestError.message) }
  }

  if (loading) return <div className="partners-page"><PartnerLoading label={`Loading ${config.singular.toLowerCase()} details…`} /></div>
  if (error) return <div className="partners-page"><PartnerHeading kicker="BUSINESS CONTACTS" title={`${config.singular} details`} subtitle="" actions={<button className="partner-button partner-button-outline" onClick={() => navigate(null, config.path)}>Back to {config.title.toLowerCase()}</button>} /><PartnerError message={error} onRetry={() => setReload((value) => value + 1)} /></div>
  const history = record[config.relation] || []
  const payments = history.flatMap((order) => (order.invoice?.payments || []).map((payment) => ({ ...payment, invoiceNumber: order.invoice.invoiceNumber, orderNumber: order.orderNumber })))
  return <div className="partners-page"><PartnerHeading kicker={`BUSINESS CONTACTS / ${config.singular.toUpperCase()}`} title={record.name} subtitle={record.companyName || config.singular} actions={<><button className="partner-button partner-button-outline" onClick={() => navigate(null, config.path)}>← {config.title}</button>{write && record.status === 'ACTIVE' && <><button className="partner-button partner-button-outline" onClick={() => navigate(null, `${config.path}/${id}/edit`)}>Edit</button><button className="partner-button partner-button-danger" onClick={archive}>Archive</button></>}</>} />
    {actionError && <div className="partner-inline-error" role="alert">{actionError}</div>}{record.status === 'INACTIVE' && <div className="partner-inline-warning">This record is inactive. Its saved contact information and transaction history are preserved.</div>}
    <div className="partner-detail-grid"><section className="partner-detail-card"><div className="partner-detail-title"><div><span className="partner-detail-kicker">CONTACT PROFILE</span><h2>Contact information</h2></div><span className={`partner-status ${record.status === 'ACTIVE' ? 'partner-status-active' : 'partner-status-inactive'}`}>{record.status === 'ACTIVE' ? 'Active' : 'Inactive'}</span></div><div className="partner-info-grid"><Info label="Contact name" value={record.name} /><Info label="Company" value={record.companyName} /><Info label="Email" value={record.email} /><Info label="Phone" value={record.phone} />{kind === 'supplier' ? <Info label="Address" value={record.address} /> : <><Info label="Billing address" value={record.billingAddress} /><Info label="Shipping address" value={record.shippingAddress} /></>}<Info label="City" value={record.city} /><Info label="State / region" value={record.state} /><Info label="Postal code" value={record.postalCode} /><Info label="Country" value={record.country} /><Info label="GSTIN" value={record.taxRegistration} />{kind === 'supplier' && <Info label="Payment terms" value={record.paymentTerms} />}<Info label="Additional notes" value={record.notes} wide /><Info label="Added" value={formatDate(record.createdAt)} /></div></section>
      <section className="partner-detail-card"><div className="partner-detail-title"><div><span className="partner-detail-kicker">RELATED RECORDS</span><h2>{config.historyTitle}</h2></div><span className="partner-history-count">{history.length} recent</span></div>{history.length === 0 ? <div className="partner-history-empty">No related {kind === 'supplier' ? 'purchase orders' : 'sales orders'} yet.</div> : <div className="partner-history-list">{history.map((order) => <div className="partner-history-row" key={order.id}><span className="partner-history-icon">{kind === 'supplier' ? '↙' : '↗'}</span><span className="partner-history-copy"><strong>{order.orderNumber}</strong><small>{formatDate(order.orderDate)} · {order.status.toLowerCase().replaceAll('_', ' ')}</small></span><span className="partner-history-amount">{formatMoney(order.totalAmount)}</span>{order.invoice && <small className="partner-invoice-tag">{order.invoice.invoiceNumber} · {order.invoice.status.toLowerCase().replaceAll('_', ' ')}</small>}</div>)}</div>}</section>
      <section className="partner-detail-card partner-payments-card"><div className="partner-detail-title"><div><span className="partner-detail-kicker">SETTLEMENT ACTIVITY</span><h2>Payments</h2></div><span className="partner-history-count">{payments.length} recorded</span></div>{payments.length === 0 ? <div className="partner-history-empty">Payments will appear here when a related order has an invoice.</div> : <div className="partner-table-wrap"><table className="partner-history-table"><thead><tr><th>DATE</th><th>INVOICE</th><th>METHOD</th><th>REFERENCE</th><th>AMOUNT</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td>{formatDate(payment.paymentDate)}</td><td>{payment.invoiceNumber}</td><td>{payment.method.replaceAll('_', ' ').toLowerCase()}</td><td>{payment.transactionReference || '—'}</td><td>{formatMoney(payment.amount)}</td></tr>)}</tbody></table></div>}</section>
    </div>
  </div>
}

function Info({ label, value, wide = false }) {
  return <div className={wide ? 'partner-info-wide' : ''}><small>{label}</small><strong>{display(value)}</strong></div>
}
