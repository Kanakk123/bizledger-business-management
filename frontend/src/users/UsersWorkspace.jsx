import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import './users.css'

export default function UsersWorkspace() {
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [busy, setBusy] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    api('/api/users').then((response) => {
      if (!Array.isArray(response.data)) throw new Error('Unexpected user list response from the server.')
      if (active) { setUsers(response.data); setError('') }
    }).catch((requestError) => { if (active) setError(requestError.message) }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [reload])

  async function create(event) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      await api('/api/users', { method: 'POST', body: JSON.stringify(form) })
      setForm({ name: '', email: '', password: '' }); setNotice('Staff account created.'); setReload((value) => value + 1)
    } catch (requestError) { setError(requestError.message) }
    finally { setSaving(false) }
  }

  async function toggle(user) {
    const next = !user.isActive
    if (!window.confirm(`${next ? 'Activate' : 'Deactivate'} ${user.name}’s staff account?`)) return
    setError(''); setNotice('')
    try {
      await api(`/api/users/${user.id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: next }) })
      setNotice(`Staff account ${next ? 'activated' : 'deactivated'}.`); setReload((value) => value + 1)
    } catch (requestError) { setError(requestError.message) }
  }

  return <section className="page-content user-admin-page">
    <div className="page-heading"><div><p className="page-kicker">WORKSPACE / ACCESS</p><h1>Users & team</h1><p className="page-subtitle">Create and manage staff access to BizLedger.</p></div></div>
    {notice && <div className="user-notice" role="status">{notice}</div>}{error && <div className="user-error" role="alert">{error}<button onClick={() => setReload((value) => value + 1)}>Retry</button></div>}
    <div className="user-admin-grid"><form className="user-card user-create-form" onSubmit={create}><span className="user-kicker">NEW TEAM MEMBER</span><h2>Create staff account</h2><p>New accounts receive Staff permissions by default.</p><label>Full name<input required minLength="2" maxLength="100" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Email address<input required type="email" maxLength="150" autoComplete="off" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Temporary password<input required type="password" minLength="8" maxLength="200" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /><small>At least 8 characters. Passwords are hashed before storage and cannot be viewed later.</small></label><button className="button button-primary" disabled={saving}>{saving ? 'Creating…' : 'Create staff account'}</button></form>
      <section className="user-card user-list-card"><div className="user-list-heading"><div><span className="user-kicker">ACCESS DIRECTORY</span><h2>Workspace users</h2></div><span>{users.length} accounts</span></div>{busy ? <div className="user-state">Loading user accounts…</div> : !users.length && !error ? <div className="user-state">No user accounts found.</div> : <div className="user-table-wrap"><table><thead><tr><th>NAME</th><th>EMAIL</th><th>ROLE</th><th>STATUS</th><th /></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td>{user.name}</td><td>{user.email}</td><td>{user.role}</td><td><span className={user.isActive ? 'user-status-active' : 'user-status-inactive'}>{user.isActive ? 'Active' : 'Inactive'}</span></td><td>{user.role === 'STAFF' && <button className="user-toggle" onClick={() => toggle(user)}>{user.isActive ? 'Deactivate' : 'Activate'}</button>}</td></tr>)}</tbody></table></div>}</section></div>
  </section>
}
