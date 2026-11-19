// Piezas compartidas del panel.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api } from '../../client/api.js'
import { DAY_LABELS } from '../../shared/time.js'

export const AdminContext = createContext(null)
export const useAdmin = () => useContext(AdminContext)

/** Lista editable de una colección del servidor. */
export function useCollection(name) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const load = useCallback(
    () =>
      api(`/admin/${name}`)
        .then((data) => {
          setItems(data)
          setError(null)
        })
        .catch((e) => setError(e.message)),
    [name],
  )
  useEffect(() => {
    load()
  }, [load])

  const save = async (item, isNew) => {
    const result = isNew
      ? await api(`/admin/${name}`, { method: 'POST', body: item })
      : await api(`/admin/${name}/${item.id}`, { method: 'PUT', body: item })
    await load()
    return result
  }
  const remove = async (id) => {
    await api(`/admin/${name}/${id}`, { method: 'DELETE' })
    await load()
  }
  return { items, error, reload: load, save, remove }
}

export function PageHeader({ title, description, children }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="page-head__actions">{children}</div>}
    </header>
  )
}

export function Field({ label, hint, children, wide }) {
  return (
    <label className={`field ${wide ? 'field--wide' : ''}`}>
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  )
}

export function Modal({ title, onClose, children, footer, size }) {
  const ref = useRef(null)
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    ref.current?.querySelector('input, textarea, select')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal__panel ${size === 'wide' ? 'modal__panel--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="modal__head">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  )
}

/** Formulario en modal con guardado y errores del servidor. */
export function EditorModal({ title, onClose, onSubmit, children, size, extraActions }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSubmit()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal
      title={title}
      onClose={onClose}
      size={size}
      footer={
        <>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="modal__buttons">
            {extraActions}
            <button type="button" className="button button--ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" form="editor-form" className="button button--primary" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </>
      }
    >
      <form id="editor-form" className="form-grid" onSubmit={submit}>
        {children}
      </form>
    </Modal>
  )
}

export function TagPicker({ options = [], value = [], onChange, allowCustom = true, label }) {
  const [custom, setCustom] = useState('')
  const all = [...new Set([...options, ...value])]
  const toggle = (tag) => onChange(value.includes(tag) ? value.filter((t) => t !== tag) : [...value, tag])
  const add = () => {
    const tag = custom.trim().toLowerCase()
    if (tag && !value.includes(tag)) onChange([...value, tag])
    setCustom('')
  }
  return (
    <div className="tags" role="group" aria-label={label}>
      {all.map((tag) => (
        <button type="button" key={tag} className={`tag ${value.includes(tag) ? 'tag--on' : ''}`} aria-pressed={value.includes(tag)} onClick={() => toggle(tag)}>
          {tag}
        </button>
      ))}
      {allowCustom && (
        <input
          className="tags__input"
          value={custom}
          placeholder="+ otra"
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          onBlur={add}
        />
      )}
    </div>
  )
}

export function DaysPicker({ value = [], onChange }) {
  const order = [1, 2, 3, 4, 5, 6, 0]
  return (
    <div className="tags" role="group" aria-label="Días">
      {order.map((d) => (
        <button
          type="button"
          key={d}
          className={`tag ${value.includes(d) ? 'tag--on' : ''}`}
          aria-pressed={value.includes(d)}
          onClick={() => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort())}
        >
          {DAY_LABELS[d]}
        </button>
      ))}
    </div>
  )
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={`badge badge--${tone}`}>{children}</span>
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function ConfirmButton({ onConfirm, children = 'Eliminar', question = '¿Seguro? Esta acción no se puede deshacer.' }) {
  return (
    <button
      type="button"
      className="button button--danger button--small"
      onClick={() => {
        if (window.confirm(question)) onConfirm()
      }}
    >
      {children}
    </button>
  )
}

export function Loading({ error }) {
  if (error) return <p className="form-error">{error}</p>
  return <p className="muted">Cargando…</p>
}

export function Empty({ children }) {
  return <p className="empty">{children}</p>
}

/** Envuelve una acción asíncrona para mostrar su error con el aviso del panel. */
export function useAction() {
  const { notify } = useAdmin()
  return useCallback(
    async (fn, success) => {
      try {
        const result = await fn()
        if (success) notify(success)
        return result
      } catch (e) {
        notify(e.message, 'error')
        return undefined
      }
    },
    [notify],
  )
}

export const numberOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v))
