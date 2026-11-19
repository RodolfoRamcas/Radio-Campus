import { useEffect, useMemo, useState } from 'react'
import { api } from '../../client/api.js'
import { Badge, ConfirmButton, EditorModal, Empty, Field, Loading, PageHeader, useAction, useAdmin, useCollection } from './ui.jsx'

export function Playlists() {
  const { items, error, save, remove } = useCollection('playlists')
  const { config, notify } = useAdmin()
  const run = useAction()
  const [songs, setSongs] = useState([])
  const [editing, setEditing] = useState(null)

  useEffect(() => {
    api('/admin/songs').then(setSongs).catch(() => {})
  }, [])

  if (!items) return <Loading error={error} />
  const titles = new Map(songs.map((s) => [s.id, `${s.title} — ${s.artist}`]))

  return (
    <>
      <PageHeader title="Listas de reproducción" description="Agrupan canciones. Una regla puede limitarse a una lista, y una lista funciona como selección de respaldo.">
        <button className="button button--primary" onClick={() => setEditing({ name: '', description: '', songIds: [] })}>
          Nueva lista
        </button>
      </PageHeader>
      {items.length === 0 ? (
        <Empty>Aún no hay listas.</Empty>
      ) : (
        <div className="cards">
          {items.map((p) => (
            <article key={p.id} className="card">
              <h2 className="card__title">
                {p.name} {config.backupPlaylistId === p.id && <Badge tone="info">Respaldo autorizado</Badge>}
              </h2>
              {p.description && <p className="muted small">{p.description}</p>}
              <p className="small">{p.songIds.length} canciones</p>
              <ul className="compact-list">
                {p.songIds.slice(0, 6).map((id) => (
                  <li key={id}>{titles.get(id) ?? id}</li>
                ))}
                {p.songIds.length > 6 && <li className="muted">y {p.songIds.length - 6} más…</li>}
              </ul>
              <div className="button-row">
                <button className="button button--small button--ghost" onClick={() => setEditing(p)}>
                  Editar
                </button>
                <ConfirmButton onConfirm={() => run(() => remove(p.id), 'Lista eliminada')} />
              </div>
            </article>
          ))}
        </div>
      )}
      {editing && (
        <PlaylistEditor
          playlist={editing}
          songs={songs}
          onClose={() => setEditing(null)}
          onSave={(p) => save(p, !editing.id).then(() => notify('Lista guardada'))}
        />
      )}
    </>
  )
}

function PlaylistEditor({ playlist, songs, onClose, onSave }) {
  const [draft, setDraft] = useState(playlist)
  const [query, setQuery] = useState('')
  const selected = new Set(draft.songIds)
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return songs.filter((s) => !q || `${s.title} ${s.artist} ${s.genre}`.toLowerCase().includes(q))
  }, [songs, query])
  const toggle = (id) =>
    setDraft((d) => ({ ...d, songIds: selected.has(id) ? d.songIds.filter((x) => x !== id) : [...d.songIds, id] }))

  return (
    <EditorModal title={playlist.id ? 'Editar lista' : 'Nueva lista'} size="wide" onClose={onClose} onSubmit={() => onSave(draft)}>
      <Field label="Nombre">
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required maxLength={120} />
      </Field>
      <Field label="Descripción">
        <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={300} />
      </Field>
      <Field label={`Canciones (${draft.songIds.length} elegidas)`} wide>
        <input type="search" placeholder="Filtrar…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="checklist">
          {visible.map((s) => (
            <label key={s.id} className="checklist__item">
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
              <span>
                {s.title} <span className="muted">— {s.artist} · {s.genre}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>
    </EditorModal>
  )
}
