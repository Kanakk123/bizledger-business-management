import { useEffect, useState } from 'react'
import { api } from './lib/api.js'
import ProductsWorkspace from './products/ProductsWorkspace.jsx'
import PartnersWorkspace from './partners/PartnersWorkspace.jsx'
import PurchaseOrdersWorkspace from './purchases/PurchaseOrdersWorkspace.jsx'
import './App.css'

const sections = [
  { name: 'Dashboard', path: '/', icon: '◫', permission: 'dashboard:read' },
  { name: 'Products', path: '/products', icon: '▦', permission: 'products:read' },
  { name: 'Suppliers', path: '/suppliers', icon: '♧', permission: 'suppliers:read' },
  { name: 'Buyers', path: '/buyers', icon: '♙', permission: 'buyers:read' },
  { name: 'Purchases', path: '/purchases', icon: '↙', permission: 'purchases:read' },
  { name: 'Sales', path: '/sales', icon: '↗', permission: 'sales:read' },
  { name: 'Invoices', path: '/invoices', icon: '▤', permission: 'invoices:read' },
  { name: 'Payments', path: '/payments', icon: '＄', permission: 'payments:read' },
  { name: 'Reports', path: '/reports', icon: '▥', permission: 'reports:read' },
]

function Brand({ compact = false }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}>
    <span className="brand-mark"><span /><span /><span /></span>
    {!compact && <span className="brand-name">bizledger<span>.</span></span>}
  </div>
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      })
      setPassword('')
      onLogin(result.user)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  return <main className="login-page">
    <section className="login-story">
      <div className="story-top"><Brand /><span className="story-label">BUSINESS, IN GOOD ORDER</span></div>
      <div className="story-copy">
        <div className="eyebrow"><span /> YOUR BUSINESS, CLEARER</div>
        <h1>Make room<br />for <em>what’s next.</em></h1>
        <p>One calm place to keep stock, orders and the numbers that move your business forward.</p>
      </div>
      <div className="story-bottom">
        <div className="orbit orbit-one" /><div className="orbit orbit-two" />
        <div className="story-note"><span className="note-dot" /> A clearer view of your day</div>
        <span className="story-version">BIZLEDGER · BUSINESS MANAGEMENT</span>
      </div>
    </section>
    <section className="login-panel">
      <div className="login-panel-top"><span>Welcome back</span><span className="secure-label">●&nbsp; SECURE SIGN IN</span></div>
      <div className="login-card-wrap">
        <Brand compact />
        <div className="login-heading"><p className="eyebrow">YOUR WORKSPACE</p><h2>Sign in to BizLedger</h2><p>Enter your account details to continue.</p></div>
        <form className="login-form" onSubmit={submit}>
          <label htmlFor="email">Email address</label>
          <div className="input-wrap"><span className="input-icon">✉</span><input id="email" type="email" autoComplete="username" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
          <div className="password-label"><label htmlFor="password">Password</label></div>
          <div className="input-wrap"><span className="input-icon lock-icon">⌑</span><input id="password" type="password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="sign-in-button" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<span>→</span></button>
          <p className="login-footnote"><span>◈</span> Your account is protected with encrypted sign-in.</p>
        </form>
      </div>
      <footer className="login-footer"><span>© 2026 BizLedger</span><span>Built for the business you’re building.</span></footer>
    </section>
  </main>
}

function AppShell({ user, onLogout }) {
  const [path, setPath] = useState(window.location.pathname)
  const [menuOpen, setMenuOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const active = sections.find((item) => item.path === path)
    || (path.startsWith('/products/') ? sections[1] : null)
    || (path.startsWith('/suppliers/') ? sections[2] : null)
    || (path.startsWith('/buyers/') ? sections[3] : null)
    || (path.startsWith('/purchases/') ? sections[4] : null)
    || sections[0]

  useEffect(() => {
    const updatePath = () => setPath(window.location.pathname)
    window.addEventListener('popstate', updatePath)
    return () => window.removeEventListener('popstate', updatePath)
  }, [])

  function navigate(event, destination) {
    event?.preventDefault()
    window.history.pushState({}, '', destination)
    setPath(destination)
    setMenuOpen(false)
  }

  async function logout() {
    setLoggingOut(true)
    try { await api('/api/auth/logout', { method: 'POST' }) } catch { /* The session may already have expired. */ }
    onLogout()
  }

  return <div className="app-shell">
    {menuOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <a className="sidebar-brand" href="/" onClick={(event) => navigate(event, '/')}><Brand /></a>
      <div className="workspace-switch"><span className="workspace-avatar">B</span><span className="workspace-text"><strong>My workspace</strong><small>Business account</small></span><span className="switch-chevron">⌄</span></div>
      <div className="nav-caption">WORKSPACE</div>
      <nav className="side-nav" aria-label="Main navigation">
        {sections.map((item) => <a key={item.path} href={item.path} onClick={(event) => navigate(event, item.path)} className={`nav-link ${active.path === item.path ? 'nav-active' : ''}`}><span className="nav-icon">{item.icon}</span><span>{item.name}</span>{item.name === 'Products' && <span className="nav-indicator" />}</a>)}
      </nav>
      <div className="sidebar-bottom"><div className="help-card"><span className="help-spark">✳</span><strong>Need a hand?</strong><span>Your workspace is ready to grow.</span><span className="help-link">Help center · coming soon</span></div>
        <button className="profile-button" type="button" onClick={logout} disabled={loggingOut}><span className="profile-avatar">{user.name?.trim()?.[0]?.toUpperCase() || 'U'}</span><span className="profile-copy"><strong>{user.name}</strong><small>{user.role.toLowerCase()}</small></span><span className="profile-action">{loggingOut ? '…' : '↪'}</span></button>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar"><button className="menu-toggle" aria-label="Open navigation" onClick={() => setMenuOpen(true)}>☰</button><div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>{active.name}</strong></div><div className="topbar-actions"><span className="today-label">Your business at a glance</span><span className="topbar-divider" /><button className="avatar-small" title={user.name}>{user.name?.trim()?.[0]?.toUpperCase() || 'U'}</button></div></header>
      {active.name === 'Products' ? <ProductsWorkspace path={path} navigate={navigate} user={user} />
        : ['Suppliers', 'Buyers'].includes(active.name) ? <PartnersWorkspace kind={active.name.toLowerCase().slice(0, -1)} path={path} navigate={navigate} user={user} />
          : active.name === 'Purchases' ? <PurchaseOrdersWorkspace path={path} navigate={navigate} user={user} />
        : <section className="page-content"><div className="page-heading"><div><p className="page-kicker">YOUR WORKSPACE&nbsp; / &nbsp;{active.name.toUpperCase()}</p><h1>{active.name === 'Dashboard' ? `Good to have you here, ${user.name.split(' ')[0]}.` : active.name}</h1><p className="page-subtitle">{active.name === 'Dashboard' ? 'A little more clarity for the work ahead.' : `Your ${active.name.toLowerCase()} workspace.`}</p></div><div className="date-chip"><span>◷</span> {new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date())}</div></div>
        <div className="welcome-card"><div className="welcome-copy"><span className="welcome-label"><span /> WORKSPACE READY</span><h2>{active.name === 'Dashboard' ? 'Your business, coming into focus.' : `${active.name} will feel at home here.`}</h2><p>Sign-in is connected and your workspace is ready. This area will come alive as the BizLedger features are added.</p><div className="welcome-actions"><span className="role-badge">{user.role}</span><span className="welcome-secure">◈&nbsp; Private workspace</span></div></div><div className="welcome-art" aria-hidden="true"><div className="art-ring ring-back"/><div className="art-ring ring-front"/><div className="art-sun"/><div className="art-hill hill-back"/><div className="art-hill hill-front"/><div className="art-stem"/><div className="art-leaf leaf-left"/><div className="art-leaf leaf-right"/><span className="art-star star-a">✳</span><span className="art-star star-b">✦</span></div></div>
        <div className="section-row"><div><h2>Everything in its place</h2><p>Your tools, ready when you are.</p></div><span className="section-count">{sections.length} AREAS</span></div>
        <div className="area-grid">{sections.slice(1).map((item, index) => <a className="area-card" href={item.path} onClick={(event) => navigate(event, item.path)} key={item.path}><span className={`area-icon area-color-${index % 4}`}>{item.icon}</span><span className="area-card-text"><strong>{item.name}</strong><small>Open {item.name.toLowerCase()}</small></span><span className="area-arrow">↗</span></a>)}</div>
        <footer className="content-footer"><span>BizLedger <i>·</i> Your business, in good order.</span><span>Signed in as {user.email}</span></footer>
      </section>}
    </main>
  </div>
}

export default function App() {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true)
  useEffect(() => {
    let active = true
    api('/api/auth/me')
      .then((result) => { if (active) setUser(result.user) })
      .catch(() => { if (active) setUser(null) })
      .finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [])

  if (checking) return <main className="loading-screen"><Brand /><span className="loading-dot" />Checking your workspace</main>
  return user ? <AppShell user={user} onLogout={() => setUser(null)} /> : <Login onLogin={setUser} />
}
