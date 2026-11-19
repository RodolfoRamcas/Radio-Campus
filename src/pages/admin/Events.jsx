import { useState } from 'react'
import { formatDateRange } from '../../client/format.js'
import { EVENT_TYPES } from '../../shared/context.js'
import { Badge, ConfirmButton, EditorModal, Empty, Field, Loading, PageHeader, Toggle, useAction, useAdmin, useCollection } from './ui.jsx'

export function Events() {
  const { items, error, save, remove } = useCollection('events')
  const { config, state, notify } = useAdmin()
  const run = useAction()
  const [editing, setEditing] = useState(null)
  const today = state?.contextDetail.date ?? ''

  if (!items) return <Loading error={error} />

  return (
    <>
      <PageHeader title="Festividades y eventos" description="El calendario institucional. Las reglas de tipo “Calendario” se activan mientras un evento está vigente.">
        <button className="button button--primary" onClick={() => setEditing({ name: '', type: 'evento', theme: null, startDate: today, endDate: today, notes: '', enabled: true })}>
          Nuevo evento
        </button>
      </PageHeader>
      {items.length === 0 ? (
        <Empty>Sin eventos registrados.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Fechas</th>
                <th>Evento</th>
                <th>Tipo</th>
                <th>Temática</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {items.map((e) => {
                const status = e.endDate < today ? 'pasado' : e.startDate <= today ? 'vigente' : 'próximo'
                return (
                  <tr key={e.id} className={!e.enabled || status === 'pasado' ? 'row--off' : ''}>
                    <td>{formatDateRange(e.startDate, e.endDate)}</td>
                    <td>
                      <strong>{e.name}</strong> {status === 'vigente' && <Badge tone="ok">Vigente</Badge>}
                      {!e.enabled && <Badge>Desactivado</Badge>}
                      {e.notes && <div className="muted small">{e.notes}</div>}
                    </td>
                    <td>{EVENT_TYPES[e.type]}</td>
                    <td>{e.theme ?? '—'}</td>
                    <td className="actions">
                      <button className="button button--small button--ghost" onClick={() => setEditing(e)}>
                        Editar
                      </button>
                      <ConfirmButton onConfirm={() => run(() => remove(e.id), 'Evento eliminado')} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <EventEditor event={editing} themes={config.tags.themes} onClose={() => setEditing(null)} onSave={(e) => save(e, !editing.id).then(() => notify('Evento guardado'))} />}
    </>
  )
}

function EventEditor({ event, themes, onClose, onSave }) {
  const [draft, setDraft] = useState(event)
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  return (
    <EditorModal title={event.id ? 'Editar evento' : 'Nuevo evento'} onClose={onClose} onSubmit={() => onSave(draft)}>
      <Field label="Nombre" wide>
        <input value={draft.name} onChange={(e) => set({ name: e.target.value })} required maxLength={120} />
      </Field>
      <Field label="Tipo" hint="“Exámenes” activa la regla de concentración.">
        <select value={draft.type} onChange={(e) => set({ type: e.target.value })}>
          {Object.entries(EVENT_TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Temática musical" hint="Para festividades: qué canciones temáticas preferir.">
        <select value={draft.theme ?? ''} onChange={(e) => set({ theme: e.target.value || null })}>
          <option value="">Ninguna</option>
          {themes.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </Field>
      <Field label="Inicio">
        <input type="date" value={draft.startDate} onChange={(e) => set({ startDate: e.target.value })} required />
      </Field>
      <Field label="Fin">
        <input type="date" value={draft.endDate} onChange={(e) => set({ endDate: e.target.value })} required />
      </Field>
      <Field label="Notas" wide>
        <input value={draft.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={300} />
      </Field>
      <Toggle label="Activo" checked={draft.enabled} onChange={(enabled) => set({ enabled })} />
    </EditorModal>
  )
}
