// Panel de administración: inicio de sesión y navegación entre secciones.
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../client/api.js'
import { useRadio } from '../../client/useRadio.js'
import { ConnectionBadge } from '../../components/ConnectionBadge.jsx'
import { AdminContext } from './ui.jsx'
import '../../styles/admin.css'
import { Live } from './Live.jsx'
import { Songs } from './Songs.jsx'
import { Playlists } from './Playlists.jsx'
import { Rules } from './Rules.jsx'
import { Events } from './Events.jsx'
import { Announcements } from './Announcements.jsx'
import { History } from './History.jsx'
import { Stats } from './Stats.jsx'
import { Settings } from './Settings.jsx'

const SECTIONS = [
  { id: 'vivo', label: 'En vivo', Component: Live },
  { id: 'canciones', label: 'Canciones', Component: Songs },
  { id: 'listas', label: 'Listas', Component: Playlists },
  { id: 'reglas', label: 'Reglas', Component: Rules },
  { id: 'eventos', label: 'Eventos', Component: Events },
  { id: 'anuncios', label: 'Anuncios', Component: Announcements },
  { id: 'historial', label: 'Historial', Component: History },
  { id: 'estadisticas', label: 'Estadísticas', Component: Stats },
  { id: 'configuracion', label: 'Configuración', Component: Settings },
]

function useSection() {
  const read = () => {
    const id = location.hash.slice(1)
    return SECTIONS.some((s) => s.id === id) ? id : 'vivo'
  }
  const [section, setSection] = useState(read)
  useEffect(() => {
    const onHash = () => setSection(read())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return section
}

export function Admin() {
  const [session, setSession] = useState(null)

  const check = useCallback(() => {
    api('/admin/session')
      .then(setSession)
      .catch((e) => setSession({ authenticated: false, configured: true, error: e.message }))
  }, [])

  useEffect(() => {
    document.title = 'Radio Campus · Administración'
    check()
    const expired = () => setSession((s) => ({ ...s, authenticated: false, expired: true }))
    window.addEventListener('radio:session-expired', expired)
    return () => window.removeEventListener('radio:session-expired', expired)
  }, [check])

  if (!session) return <div className="admin-boot">Cargando…</div>
  if (!session.authenticated) return <Login session={session} onLogin={check} />
  return <Dashboard onLogout={() => setSession({ authenticated: false, configured: true })} />
}

function Login({ session, onLogin }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(session.expired ? 'Tu sesión expiró. Vuelve a entrar.' : session.error ?? null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('/admin/login', { method: 'POST', body: { password } })
      onLogin()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <form className="login__card" onSubmit={submit}>
        <h1>Radio Campus</h1>
        <p>Panel de administración</p>
        {!session.configured && (
          <p className="form-error">El servidor no tiene contraseña configurada. Define ADMIN_PASSWORD (ver README).</p>
        )}
        <label className="field">
          <span className="field__label">Contraseña</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button--primary" disabled={busy || !session.configured}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}

function Dashboard({ onLogout }) {
  const section = useSection()
  const { state, connection } = useRadio('admin')
  const [config, setConfig] = useState(null)
  const [toast, setToast] = useState(null)

  const reloadConfig = useCallback(() => api('/admin/config').then(setConfig).catch(() => {}), [])
  useEffect(() => {
    reloadConfig()
  }, [reloadConfig])

  const notify = useCallback((message, tone = 'ok') => {
    setToast({ message, tone, id: Date.now() })
  }, [])
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), toast.tone === 'error' ? 7000 : 3500)
    return () => clearTimeout(id)
  }, [toast])

  async function logout() {
    await api('/admin/logout', { method: 'POST' }).catch(() => {})
    onLogout()
  }

  const { Component } = SECTIONS.find((s) => s.id === section)

  return (
    <AdminContext.Provider value={{ state, config, reloadConfig, notify }}>
      <div className="admin">
        <aside className="admin__nav">
          <div className="admin__brand">
            <strong>{config?.campus.name ?? 'Radio Campus'}</strong>
            <ConnectionBadge connection={connection} />
          </div>
          <nav aria-label="Secciones">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className={s.id === section ? 'active' : ''} aria-current={s.id === section ? 'page' : undefined}>
                {s.label}
              </a>
            ))}
          </nav>
          <div className="admin__links">
            <a href="/pantalla" target="_blank" rel="noreferrer">
              Abrir pantalla ↗
            </a>
            <a href="/votar" target="_blank" rel="noreferrer">
              Abrir votación ↗
            </a>
            <button className="link-button" onClick={logout}>
              Cerrar sesión
            </button>
          </div>
        </aside>
        <main className="admin__main">{config ? <Component /> : <p className="muted">Cargando…</p>}</main>
        {toast && (
          <div key={toast.id} className={`toast toast--${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
            {toast.message}
          </div>
        )}
      </div>
    </AdminContext.Provider>
  )
}
