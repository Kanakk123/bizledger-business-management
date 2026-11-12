import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import './products.css'

const emptyProduct = { name: '', sku: '', description: '', categoryId: '', unit: 'each', specifications: '', purchasePrice: '', sellingPrice: '', taxRate: '0', stockQuantity: '0', stockReason: '', minStockLevel: '0', remarks: '' }
const money = (value) => `₹${value ?? '0.00'}`
const quantity = (value) => String(value ?? '0').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
const quantityUnits = (value) => { const [whole, fraction = ''] = String(value ?? '0').split('.'); return BigInt(whole || '0') * 1000n + BigInt((fraction + '000').slice(0, 3)) }
const lowStock = (available, threshold) => quantityUnits(available) <= quantityUnits(threshold)
const canWrite = (user) => user.role === 'ADMIN' || user.role === 'MANAGER'

function PageHeading({ kicker, title, subtitle, actions }) {
  return <div className="products-heading"><div><p className="products-kicker">{kicker}</p><h1>{title}</h1><p>{subtitle}</p></div>{actions && <div className="products-heading-actions">{actions}</div>}</div>
}

function StateMessage({ error, onRetry }) {
  return <div className="products-state products-error" role="alert"><span className="state-icon">!</span><strong>We couldn’t load this view</strong><p>{error}</p>{onRetry && <button className="button button-outline" onClick={onRetry}>Try again</button>}</div>
}

function LoadingState({ label = 'Loading products…' }) {
  return <div className="products-state"><span className="products-spinner" />{label}</div>
}

export default function ProductsWorkspace({ path, navigate, user }) {
  const parts = path.split('/').filter(Boolean)
  if (parts[1] === 'categories') return <CategoryManager navigate={navigate} user={user} />
  if (parts[1] === 'new') return <ProductForm navigate={navigate} />
  if (parts[1] && /^\d+$/.test(parts[1]) && parts[2] === 'edit') return <ProductForm id={Number(parts[1])} navigate={navigate} />
  if (parts[1] && /^\d+$/.test(parts[1])) return <ProductDetail id={Number(parts[1])} navigate={navigate} user={user} />
  return <ProductList navigate={navigate} user={user} />
}

function ProductList({ navigate, user }) {
  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [search, setSearch] = useState('')
  const [searchValue, setSearchValue] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [lowStock, setLowStock] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 })
  const [lowCount, setLowCount] = useState(0)
  const [request, setRequest] = useState({ key: null, loading: true, error: '' })
  const [reload, setReload] = useState(0)
  const write = canWrite(user)
  const requestKey = JSON.stringify({ search, page, categoryId, lowStock, includeArchived, reload })
  const loading = request.key !== requestKey || request.loading
  const error = request.key === requestKey ? request.error : ''

  useEffect(() => { const timer = setTimeout(() => { setSearch(searchValue); setPage(1) }, 250); return () => clearTimeout(timer) }, [searchValue])
  useEffect(() => { api('/api/categories').then((result) => setCategories(result.data)).catch(() => setCategories([])) }, [])
  useEffect(() => {
    let active = true
    const filters = JSON.parse(requestKey)
    const query = new URLSearchParams({ search: filters.search, page: String(filters.page), pageSize: '20', lowStock: String(filters.lowStock), includeArchived: String(filters.includeArchived) })
    if (filters.categoryId) query.set('categoryId', filters.categoryId)
    api(`/api/products?${query}`)
      .then((result) => { if (active) { setItems(result.items); setPagination(result.pagination) } })
      .catch((requestError) => { if (active) setRequest({ key: requestKey, loading: true, error: requestError.message }) })
      .finally(() => { if (active) setRequest((state) => state.key === requestKey ? { ...state, loading: false } : { key: requestKey, loading: false, error: '' }) })
    return () => { active = false }
  }, [requestKey])
  useEffect(() => { api('/api/products/low-stock?page=1&pageSize=1').then((result) => setLowCount(result.pagination.total)).catch(() => {}) }, [reload])

  return <div className="products-page">
    <PageHeading kicker="CATALOGUE / INVENTORY" title="Products" subtitle="Keep your catalogue, costs and stock in one place." actions={<><button className="button button-outline" onClick={() => navigate(null, '/products/categories')}>Manage categories</button>{write && <button className="button button-primary" onClick={() => navigate(null, '/products/new')}><span>＋</span> Add product</button>}</>} />
    {lowCount > 0 && <button className={`low-stock-banner ${lowStock ? 'low-stock-selected' : ''}`} onClick={() => { setLowStock(!lowStock); setPage(1) }}><span className="low-stock-symbol">!</span><span><strong>{lowCount} {lowCount === 1 ? 'product is' : 'products are'} running low</strong><small>At or below its minimum stock threshold</small></span><span className="low-stock-action">{lowStock ? 'Show all products' : 'Review low stock'} <b>→</b></span></button>}
    <div className="products-toolbar"><label className="product-search"><span>⌕</span><input value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder="Search by name, SKU or description" aria-label="Search products" /><kbd>⌘ K</kbd></label><select aria-label="Filter by category" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1) }}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{write && <label className="archived-filter"><input type="checkbox" checked={includeArchived} onChange={(event) => { setIncludeArchived(event.target.checked); setPage(1) }} /> Include archived</label>}</div>
    {error ? <StateMessage error={error} onRetry={() => setReload((value) => value + 1)} /> : loading ? <LoadingState /> : items.length === 0 ? <div className="products-state empty-products"><span className="empty-box">▦</span><strong>{search || categoryId || lowStock ? 'No products match these filters' : 'Your catalogue is ready for its first product'}</strong><p>{search || categoryId || lowStock ? 'Try changing the search or filters.' : 'Add a product to start tracking prices and inventory.'}</p>{write && !search && !categoryId && !lowStock && <button className="button button-primary" onClick={() => navigate(null, '/products/new')}>Add your first product</button>}</div> : <>
      <div className="products-table-wrap"><table className="products-table"><thead><tr><th>PRODUCT</th><th>CATEGORY</th><th>UNIT PRICE</th><th>IN STOCK</th><th>STATUS</th><th aria-label="Actions" /></tr></thead><tbody>{items.map((item) => <tr key={item.id} onClick={() => navigate(null, `/products/${item.id}`)} className="product-row"><td><div className="product-name-cell"><span className="product-thumb">{item.name.trim()[0]?.toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.sku}</small></span></div></td><td>{item.category?.name || <span className="muted">Uncategorized</span>}</td><td><span className="price-main">{money(item.sellingPrice)}</span><small className="price-sub">Cost {money(item.purchasePrice)}</small></td><td><span className={lowStock(item.stockQuantity, item.minStockLevel) ? 'stock-low' : 'stock-normal'}>{quantity(item.stockQuantity)} <small>{item.unit}</small></span><small className="price-sub">Minimum {quantity(item.minStockLevel)}</small></td><td><span className={`product-status ${item.isActive ? (lowStock(item.stockQuantity, item.minStockLevel) ? 'status-low' : 'status-active') : 'status-archived'}`}>{item.isActive ? (lowStock(item.stockQuantity, item.minStockLevel) ? 'Low stock' : 'Active') : 'Archived'}</span></td><td><button className="row-open" aria-label={`View ${item.name}`} onClick={(event) => { event.stopPropagation(); navigate(null, `/products/${item.id}`) }}>→</button></td></tr>)}</tbody></table></div>
      <div className="products-pagination"><span>Showing <strong>{(page - 1) * pagination.pageSize + 1}–{Math.min(page * pagination.pageSize, pagination.total)}</strong> of <strong>{pagination.total}</strong> products</span><div><button className="page-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Previous</button><span className="page-number">Page {page} of {Math.max(1, pagination.totalPages)}</span><button className="page-button" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>Next →</button></div></div>
    </>}
  </div>
}

function ProductForm({ id, navigate }) {
  const editing = Boolean(id)
  const [form, setForm] = useState(emptyProduct)
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(editing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    api('/api/categories?includeArchived=true').then((result) => { if (active) setCategories(result.data) }).catch((requestError) => { if (active) setError(requestError.message) })
    if (editing) api(`/api/products/${id}`).then(({ data }) => {
      if (active) setForm({ name: data.name, sku: data.sku, description: data.description || '', categoryId: data.categoryId ? String(data.categoryId) : '', unit: data.unit, specifications: data.specifications || '', purchasePrice: String(data.purchasePrice), sellingPrice: String(data.sellingPrice), taxRate: String(data.taxRate), stockQuantity: '0', stockReason: '', minStockLevel: String(data.minStockLevel), remarks: data.remarks || '' })
    }).catch((requestError) => { if (active) setError(requestError.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id, editing])
  const update = (key) => (event) => setForm((value) => ({ ...value, [key]: event.target.value }))

  async function submit(event) {
    event.preventDefault(); setSaving(true); setError('')
    const data = { name: form.name, sku: form.sku, description: form.description || null, categoryId: form.categoryId ? Number(form.categoryId) : null, unit: form.unit, specifications: form.specifications || null, purchasePrice: form.purchasePrice, sellingPrice: form.sellingPrice, taxRate: form.taxRate, minStockLevel: form.minStockLevel, remarks: form.remarks || null }
    if (!editing) { data.stockQuantity = form.stockQuantity; if (form.stockReason) data.stockReason = form.stockReason }
    try {
      const result = await api(editing ? `/api/products/${id}` : '/api/products', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(data) })
      navigate(null, `/products/${result.data.id}`)
    } catch (requestError) { setError(requestError.details?.length ? requestError.details.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' ') : requestError.message) }
    finally { setSaving(false) }
  }

  if (loading) return <div className="products-page"><LoadingState label="Loading product…" /></div>
  return <div className="products-page"><PageHeading kicker="CATALOGUE / PRODUCTS" title={editing ? 'Edit product' : 'Add a product'} subtitle={editing ? 'Update product details. Use stock adjustment to change available quantity.' : 'Add the details your team needs to identify and price this item.'} actions={<button className="button button-outline" onClick={() => navigate(null, editing ? `/products/${id}` : '/products')}>Cancel</button>} />
    {error && <div className="inline-error" role="alert">{error}</div>}
    <form className="product-form" onSubmit={submit}>
      <section className="form-section"><div className="form-section-heading"><span>01</span><div><strong>Product information</strong><small>How this item appears in your catalogue</small></div></div><div className="form-grid"><Field label="Product name" required><input value={form.name} onChange={update('name')} maxLength="150" required placeholder="e.g. Stainless steel wrench" /></Field><Field label="SKU" required><input value={form.sku} onChange={update('sku')} maxLength="60" required placeholder="e.g. TOOL-001" /></Field><Field label="Category"><select value={form.categoryId} onChange={update('categoryId')}><option value="">Uncategorized</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.isActive ? '' : ' (archived)'}</option>)}</select></Field><Field label="Unit" required><input value={form.unit} onChange={update('unit')} maxLength="30" required placeholder="each, box, kg…" /></Field><Field label="Description" wide><textarea value={form.description || ''} onChange={update('description')} rows="3" placeholder="A short description for your team" /></Field><Field label="Specifications" wide><textarea value={form.specifications || ''} onChange={update('specifications')} rows="3" placeholder="Size, material or other useful details" /></Field></div></section>
      <section className="form-section"><div className="form-section-heading"><span>02</span><div><strong>Pricing & inventory</strong><small>Prices use exact decimal values; quantities support up to three decimals</small></div></div><div className="form-grid form-grid-three"><Field label="Purchase price (₹)" required><input type="number" min="0" step="0.01" value={form.purchasePrice} onChange={update('purchasePrice')} required placeholder="0.00" /></Field><Field label="Selling price (₹)" required><input type="number" min="0" step="0.01" value={form.sellingPrice} onChange={update('sellingPrice')} required placeholder="0.00" /></Field><Field label="Tax rate (%)"><input type="number" min="0" max="999.99" step="0.01" value={form.taxRate} onChange={update('taxRate')} /></Field>{!editing && <><Field label="Opening stock"><input type="number" min="0" step="0.001" value={form.stockQuantity} onChange={update('stockQuantity')} /><small>Opening stock is written to the inventory ledger.</small></Field>{Number(form.stockQuantity) > 0 && <Field label="Opening stock reason" required><input value={form.stockReason} onChange={update('stockReason')} maxLength="500" required placeholder="e.g. Initial count" /></Field>}</>}<Field label="Low-stock threshold"><input type="number" min="0" step="0.001" value={form.minStockLevel} onChange={update('minStockLevel')} /><small>Alerts when stock is at or below this level.</small></Field></div></section>
      <section className="form-section"><div className="form-section-heading"><span>03</span><div><strong>Internal notes</strong><small>Optional notes for your team</small></div></div><Field label="Remarks"><textarea value={form.remarks || ''} onChange={update('remarks')} rows="3" placeholder="Add any internal notes" /></Field></section>
      <div className="form-actions"><button type="button" className="button button-outline" onClick={() => navigate(null, editing ? `/products/${id}` : '/products')}>Cancel</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create product'}</button></div>
    </form>
  </div>
}

function Field({ label, required, wide, children }) {
  return <label className={`product-field ${wide ? 'field-wide' : ''}`}><span>{label}{required && <i> *</i>}</span>{children}</label>
}

function ProductDetail({ id, navigate, user }) {
  const [product, setProduct] = useState(null)
  const [loadState, setLoadState] = useState({ key: null, loading: true, error: '' })
  const [quantityChange, setQuantityChange] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const write = canWrite(user)
  const requestKey = `${id}:${reload}`
  const loading = loadState.key !== requestKey || loadState.loading
  const error = loadState.key === requestKey ? loadState.error : ''
  useEffect(() => {
    let active = true
    api(`/api/products/${id}`).then(({ data }) => { if (active) setProduct(data) }).catch((requestError) => { if (active) setLoadState({ key: requestKey, loading: true, error: requestError.message }) }).finally(() => { if (active) setLoadState((state) => state.key === requestKey ? { ...state, loading: false } : { key: requestKey, loading: false, error: '' }) })
    return () => { active = false }
  }, [requestKey, id])

  async function adjust(event) {
    event.preventDefault(); setSaving(true); setActionError(''); setNotice('')
    try {
      await api(`/api/products/${id}/adjustments`, { method: 'POST', body: JSON.stringify({ quantityChange, reason }) })
      setQuantityChange(''); setReason(''); setNotice('Inventory and its ledger were updated.'); setReload((value) => value + 1)
    } catch (requestError) { setActionError(requestError.message) }
    finally { setSaving(false) }
  }
  async function archive() {
    if (!window.confirm(`Archive ${product.name}? It will remain in transaction history.`)) return
    setActionError('')
    try { await api(`/api/products/${id}/archive`, { method: 'POST' }); navigate(null, '/products') }
    catch (requestError) { setActionError(requestError.message) }
  }

  if (loading) return <div className="products-page"><LoadingState label="Loading product details…" /></div>
  if (error) return <div className="products-page"><PageHeading kicker="CATALOGUE / PRODUCTS" title="Product details" subtitle="" actions={<button className="button button-outline" onClick={() => navigate(null, '/products')}>Back to products</button>} /><StateMessage error={error} onRetry={() => setReload((value) => value + 1)} /></div>
  return <div className="products-page"><PageHeading kicker="CATALOGUE / PRODUCTS" title={product.name} subtitle={`${product.sku} · ${product.category?.name || 'Uncategorized'}`} actions={<><button className="button button-outline" onClick={() => navigate(null, '/products')}>← Products</button>{write && product.isActive && <button className="button button-primary" onClick={() => navigate(null, `/products/${id}/edit`)}>Edit product</button>}</>} />
    {actionError && <div className="inline-error" role="alert">{actionError}</div>}{notice && <div className="inline-success" role="status">{notice}</div>}
    {!product.isActive && <div className="inline-warning">This product is archived. Its details and inventory history are preserved.</div>}
    <div className="product-detail-grid"><div className="product-detail-main"><section className="detail-card"><div className="detail-card-heading"><div><span className="detail-kicker">PRODUCT OVERVIEW</span><h2>At a glance</h2></div><span className={`product-status ${product.isActive ? 'status-active' : 'status-archived'}`}>{product.isActive ? 'Active' : 'Archived'}</span></div><div className="detail-stats"><div><small>SELLING PRICE</small><strong>{money(product.sellingPrice)}</strong></div><div><small>PURCHASE PRICE</small><strong>{money(product.purchasePrice)}</strong></div><div><small>AVAILABLE STOCK</small><strong className={lowStock(product.stockQuantity, product.minStockLevel) ? 'stock-low' : ''}>{quantity(product.stockQuantity)} <small>{product.unit}</small></strong></div><div><small>LOW-STOCK ALERT</small><strong>{quantity(product.minStockLevel)} {product.unit}</strong></div></div><div className="detail-info-grid"><div><small>Tax rate</small><strong>{product.taxRate}%</strong></div><div><small>Category</small><strong>{product.category?.name || 'Uncategorized'}</strong></div><div><small>Description</small><strong>{product.description || '—'}</strong></div><div><small>Specifications</small><strong>{product.specifications || '—'}</strong></div><div><small>Remarks</small><strong>{product.remarks || '—'}</strong></div></div></section>
      <section className="detail-card history-card"><div className="detail-card-heading"><div><span className="detail-kicker">INVENTORY LEDGER</span><h2>Stock history</h2></div><span className="history-count">{product.inventoryTransactions.length} recent entries</span></div>{product.inventoryTransactions.length === 0 ? <p className="history-empty">No stock movements recorded yet.</p> : <div className="history-table-wrap"><table className="history-table"><thead><tr><th>DATE</th><th>CHANGE</th><th>REASON / REFERENCE</th><th>TYPE</th></tr></thead><tbody>{product.inventoryTransactions.map((entry) => <tr key={entry.id}><td>{new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.createdAt))}</td><td className={Number(entry.quantityChange) < 0 ? 'stock-low' : 'stock-increase'}>{Number(entry.quantityChange) > 0 ? '+' : ''}{quantity(entry.quantityChange)} {product.unit}</td><td>{entry.notes || entry.referenceType || 'Inventory movement'}</td><td><span className="ledger-badge">{entry.type.replaceAll('_', ' ').toLowerCase()}</span></td></tr>)}</tbody></table></div>}</section></div>
      <aside className="product-detail-side">{write && product.isActive && <section className="detail-card adjustment-card"><span className="detail-kicker">INVENTORY CONTROL</span><h2>Adjust stock</h2><p>Corrections are saved with a reason in the inventory ledger.</p><form onSubmit={adjust}><Field label="Quantity change" required><input type="number" step="0.001" value={quantityChange} onChange={(event) => setQuantityChange(event.target.value)} required placeholder="e.g. 5 or -2.5" /></Field><small className="field-hint">Use a positive number to add stock, or a negative number to remove it.</small><Field label="Reason" required><textarea value={reason} onChange={(event) => setReason(event.target.value)} required minLength="2" maxLength="500" rows="3" placeholder="e.g. Count correction" /></Field><button className="button button-primary button-full" disabled={saving}>{saving ? 'Saving adjustment…' : 'Record adjustment'}</button></form></section>}
        <section className="detail-card side-meta"><span className="detail-kicker">RECORD</span><div><small>Created</small><strong>{new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(product.createdAt))}</strong></div><div><small>Last updated</small><strong>{new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(product.updatedAt))}</strong></div>{write && product.isActive && <button className="archive-link" onClick={archive}>Archive product</button>}</section></aside></div>
  </div>
}

function CategoryManager({ navigate, user }) {
  const [categories, setCategories] = useState([])
  const [includeArchived, setIncludeArchived] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [editing, setEditing] = useState(null)
  const [loadState, setLoadState] = useState({ key: null, loading: true, error: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const write = canWrite(user)
  const requestKey = `${includeArchived}:${reload}`
  const loading = loadState.key !== requestKey || loadState.loading
  const loadError = loadState.key === requestKey ? loadState.error : ''
  useEffect(() => {
    let active = true
    api(`/api/categories?includeArchived=${includeArchived}`).then(({ data }) => { if (active) setCategories(data) }).catch((requestError) => { if (active) setLoadState({ key: requestKey, loading: true, error: requestError.message }) }).finally(() => { if (active) setLoadState((state) => state.key === requestKey ? { ...state, loading: false } : { key: requestKey, loading: false, error: '' }) })
    return () => { active = false }
  }, [requestKey, includeArchived])
  async function save(event) {
    event.preventDefault(); setSaving(true); setError('')
    try {
      await api(editing ? `/api/categories/${editing.id}` : '/api/categories', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify({ name, description }) })
      setName(''); setDescription(''); setEditing(null); setReload((value) => value + 1)
    } catch (requestError) { setError(requestError.message) }
    finally { setSaving(false) }
  }
  function startEdit(category) { setEditing(category); setName(category.name); setDescription(category.description || '') }
  async function archive(category) {
    if (!window.confirm(`Archive category “${category.name}”? Products remain linked and are preserved.`)) return
    setError('')
    try { await api(`/api/categories/${category.id}/archive`, { method: 'POST' }); setReload((value) => value + 1) }
    catch (requestError) { setError(requestError.message) }
  }

  return <div className="products-page"><PageHeading kicker="CATALOGUE / SETTINGS" title="Categories" subtitle="Organize products into useful groups." actions={<button className="button button-outline" onClick={() => navigate(null, '/products')}>← Back to products</button>} />
    {error && <div className="inline-error" role="alert">{error}</div>}
    <div className="category-layout">{write && <form className="detail-card category-form" onSubmit={save}><span className="detail-kicker">{editing ? 'EDIT CATEGORY' : 'NEW CATEGORY'}</span><h2>{editing ? 'Update category' : 'Add category'}</h2><Field label="Category name" required><input value={name} onChange={(event) => setName(event.target.value)} required maxLength="100" placeholder="e.g. Workshop tools" /></Field><Field label="Description"><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows="4" maxLength="5000" placeholder="A short description (optional)" /></Field><button className="button button-primary button-full" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save category' : 'Create category'}</button>{editing && <button className="button button-text button-full" type="button" onClick={() => { setEditing(null); setName(''); setDescription('') }}>Cancel edit</button>}</form>}
      <section className="detail-card category-list"><div className="detail-card-heading"><div><span className="detail-kicker">PRODUCT GROUPS</span><h2>All categories</h2></div>{write && <label className="archived-filter"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> Include archived</label>}</div>{loading ? <LoadingState label="Loading categories…" /> : loadError ? <StateMessage error={loadError} onRetry={() => setReload((value) => value + 1)} /> : categories.length === 0 ? <div className="history-empty">No categories yet. Add one to group related products.</div> : <div className="category-rows">{categories.map((category) => <div className="category-row" key={category.id}><span className="category-dot">▦</span><span className="category-row-copy"><strong>{category.name}</strong><small>{category.description || 'No description'} · {category._count?.products ?? 0} products</small></span>{!category.isActive && <span className="product-status status-archived">Archived</span>}{write && category.isActive && <div className="category-actions"><button onClick={() => startEdit(category)}>Edit</button><button onClick={() => archive(category)}>Archive</button></div>}</div>)}</div>}</section></div>
  </div>
}
