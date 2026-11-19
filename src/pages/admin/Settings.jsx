import { useEffect, useRef, useState } from 'react'
import { api } from '../../client/api.js'
import { NO_VOTE_RULES, TIE_BREAKS } from '../../shared/rounds.js'
import { VOICES } from '../../shared/defaults.js'
import { Field, PageHeader, TagPicker, Toggle, useAction, useAdmin } from './ui.jsx'

export function Settings() {
  const { config, reloadConfig, notify } = useAdmin()
  const [draft, setDraft] = useState(config)
  const [playlists, setPlaylists] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const setCampus = (patch) => setDraft((d) => ({ ...d, campus: { ...d.campus, ...patch } }))
  const setTags = (patch) => setDraft((d) => ({ ...d, tags: { ...d.tags, ...patch } }))

  useEffect(() => {
    api('/admin/playlists').then(setPlaylists).catch(() => {})
  }, [])

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const saved = await api('/admin/config', { method: 'PUT', body: draft })
      setDraft(saved)
      await reloadConfig()
      notify('Configuración guardada. Los cambios ya están en vigor.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title="Configuración" description="Parámetros generales. Los cambios se aplican de inmediato, sin tocar el código." />
      <form className="settings" onSubmit={submit}>
        <section className="card">
          <h2 className="card__title">Radio y ubicación</h2>
          <div className="form-grid">
            <Field label="Nombre de la radio">
              <input value={draft.campus.name} onChange={(e) => setCampus({ name: e.target.value })} required maxLength={60} />
            </Field>
            <PlaceSearch
              place={draft.campus.place}
              onPick={(p) =>
                setCampus({
                  place: [p.name, p.region.split(', ').at(-1)].filter(Boolean).join(', '),
                  latitude: p.latitude,
                  longitude: p.longitude,
                  timezone: p.timezone,
                })
              }
            />
            <Field label="Zona horaria" hint="Formato IANA, por ejemplo America/Mexico_City.">
              <input value={draft.campus.timezone} onChange={(e) => setCampus({ timezone: e.target.value })} required />
            </Field>
            <Field label="Latitud" hint="Para consultar la temperatura local.">
              <input type="number" step="any" value={draft.campus.latitude} onChange={(e) => setCampus({ latitude: e.target.value })} required />
            </Field>
            <Field label="Longitud">
              <input type="number" step="any" value={draft.campus.longitude} onChange={(e) => setCampus({ longitude: e.target.value })} required />
            </Field>
          </div>
        </section>

        <section className="card">
          <h2 className="card__title">Rondas de votación</h2>
          <div className="form-grid">
            <Field label="Duración máxima de la ronda (segundos)" hint="Si la canción es más corta, la ronda cierra antes.">
              <input type="number" min="30" max="900" value={draft.roundSeconds} onChange={(e) => set({ roundSeconds: Number(e.target.value) })} />
            </Field>
            <Field label="Tiempo para mostrar resultados (segundos)" hint="Margen entre el cierre y el final de la canción.">
              <input type="number" min="5" max="120" value={draft.resultsSeconds} onChange={(e) => set({ resultsSeconds: Number(e.target.value) })} />
            </Field>
            <Field label="Si hay empate, gana…">
              <select value={draft.tieBreak} onChange={(e) => set({ tieBreak: e.target.value })}>
                {Object.entries(TIE_BREAKS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Si nadie vota, suena…">
              <select value={draft.noVotes} onChange={(e) => set({ noVotes: e.target.value })}>
                {Object.entries(NO_VOTE_RULES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Máximo de votos por red y ronda" hint="0 = sin límite. Ojo: en el wifi del campus muchas personas comparten la misma IP.">
              <input type="number" min="0" value={draft.maxVotesPerIp} onChange={(e) => set({ maxVotesPerIp: Number(e.target.value) })} />
            </Field>
            <div className="field">
              <Toggle label="Mostrar conteo en vivo durante la ronda" checked={draft.showLiveCounts} onChange={(showLiveCounts) => set({ showLiveCounts })} />
            </div>
          </div>
        </section>

        <section className="card">
          <h2 className="card__title">Selección musical</h2>
          <div className="form-grid">
            <Field label="No repetir las últimas N canciones">
              <input type="number" min="0" max="200" value={draft.recentSongs} onChange={(e) => set({ recentSongs: Number(e.target.value) })} />
            </Field>
            <Field label="Ni lo que sonó en los últimos (minutos)">
              <input type="number" min="0" max="1440" value={draft.recentMinutes} onChange={(e) => set({ recentMinutes: Number(e.target.value) })} />
            </Field>
            <Field label="Lista de respaldo autorizada" hint="Se usa si no hay canciones elegibles suficientes.">
              <select value={draft.backupPlaylistId ?? ''} onChange={(e) => set({ backupPlaylistId: e.target.value || null })}>
                <option value="">Ninguna (usar todo el catálogo autorizado)</option>
                {playlists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Si falta un dato del contexto (clima)…">
              <select value={draft.missingData} onChange={(e) => set({ missingData: e.target.value })}>
                <option value="respaldo">Usar la lista de respaldo</option>
                <option value="ignorar">Ignorar solo las reglas que dependen de ese dato</option>
              </select>
            </Field>
            <Field label={`Variedad: ${draft.variety}`} hint="0 = siempre la más afín; más alto = más sorpresa.">
              <input type="range" min="0" max="5" step="0.5" value={draft.variety} onChange={(e) => set({ variety: Number(e.target.value) })} />
            </Field>
            <div className="field">
              <Toggle label="Evitar dos opciones del mismo artista" checked={draft.avoidSameArtist} onChange={(avoidSameArtist) => set({ avoidSameArtist })} />
            </div>
            <Field label="Temáticas de temporada" hint="Sus canciones solo se ofrecen mientras hay una festividad activa con esa temática." wide>
              <TagPicker label="De temporada" options={draft.tags.themes} value={draft.seasonalThemes} onChange={(seasonalThemes) => set({ seasonalThemes })} allowCustom={false} />
            </Field>
            <Field label="Restricciones bloqueadas (contenido no autorizado)" wide>
              <TagPicker label="Bloqueadas" options={draft.tags.restrictions} value={draft.blockedRestrictions} onChange={(blockedRestrictions) => set({ blockedRestrictions })} allowCustom={false} />
            </Field>
          </div>
        </section>

        <section className="card">
          <h2 className="card__title">Anuncios y pantalla</h2>
          <div className="form-grid">
            <div className="field field--wide">
              <Toggle
                label="Un anuncio entre cada canción (si todos sonaron hace poco, rotan)"
                checked={draft.announcementEverySong}
                onChange={(announcementEverySong) => set({ announcementEverySong })}
              />
              <Toggle
                label="La voz IA presenta cada canción antes de que suene"
                checked={draft.songIntros}
                onChange={(songIntros) => set({ songIntros })}
              />
            </div>
            <Field label="Canciones mínimas entre anuncios" hint="Solo aplica si el anuncio entre cada canción está apagado.">
              <input type="number" min="0" max="50" value={draft.minSongsBetweenAnnouncements} onChange={(e) => set({ minSongsBetweenAnnouncements: Number(e.target.value) })} />
            </Field>
            <Field label="Voz predeterminada">
              <select value={draft.voice} onChange={(e) => set({ voice: e.target.value })}>
                {VOICES.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="Información institucional (una por línea, máximo 12)" hint="Se muestra en la franja inferior de la pantalla." wide>
              <textarea rows={4} value={draft.ticker.join('\n')} onChange={(e) => set({ ticker: e.target.value.split('\n') })} />
            </Field>
          </div>
        </section>

        <section className="card">
          <h2 className="card__title">Vocabulario de etiquetas</h2>
          <p className="muted small">Las opciones que aparecen al etiquetar canciones y crear reglas.</p>
          <div className="form-grid">
            {[
              ['genres', 'Géneros'],
              ['moods', 'Ambientes'],
              ['themes', 'Temáticas'],
              ['restrictions', 'Restricciones'],
            ].map(([key, label]) => (
              <Field key={key} label={label} hint="Toca una etiqueta para quitarla; escribe para agregar." wide>
                <TagPicker label={label} options={[]} value={draft.tags[key]} onChange={(value) => setTags({ [key]: value })} />
              </Field>
            ))}
          </div>
        </section>

        <div className="sticky-save">
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button--primary" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar configuración'}
          </button>
        </div>
      </form>

      <Backups onRestored={async (fresh) => {
        await reloadConfig()
        setDraft(fresh)
      }} />
    </>
  )
}

/** Busca la ciudad del campus para la temperatura local (llena latitud, longitud y zona horaria). */
function PlaceSearch({ place, onPick }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)

  async function search() {
    setError(null)
    try {
      setResults(await api(`/admin/places?q=${encodeURIComponent(query)}`))
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="field field--wide">
      <span className="field__label">Ciudad para la temperatura</span>
      <span className="field__hint">Actual: {place || 'sin nombre (coordenadas manuales)'}</span>
      <div className="input-with-button">
        <input
          type="search"
          value={query}
          placeholder="Buscar ciudad, por ejemplo Miramar"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              search()
            }
          }}
        />
        <button type="button" className="button button--small" onClick={search} disabled={query.trim().length < 2}>
          Buscar
        </button>
      </div>
      {error && <span className="form-error">{error}</span>}
      {results && (
        <ul className="place-results">
          {results.length === 0 && <li className="muted small">Sin resultados.</li>}
          {results.map((r) => (
            <li key={`${r.latitude},${r.longitude}`}>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  onPick(r)
                  setResults(null)
                  setQuery('')
                }}
              >
                {r.name}
              </button>{' '}
              <span className="muted small">
                {[r.region, r.country].filter(Boolean).join(', ')} · {r.latitude.toFixed(3)}, {r.longitude.toFixed(3)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <span className="field__hint">Elige una y pulsa “Guardar configuración”: la temperatura se actualiza en ese momento.</span>
    </div>
  )
}

function Backups({ onRestored }) {
  const run = useAction()
  const input = useRef(null)

  async function download() {
    const response = await run(() => api('/admin/backup', { raw: true }))
    if (!response) return
    const blob = await response.blob()
    const name = response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? 'radio-campus-respaldo.json'
    const url = URL.createObjectURL(blob)
    const a = Object.assign(document.createElement('a'), { href: url, download: name })
    a.click()
    URL.revokeObjectURL(url)
  }

  async function restore(file) {
    if (!file) return
    let data
    try {
      data = JSON.parse(await file.text())
    } catch {
      return run(() => Promise.reject(new Error('El archivo no es JSON válido.')))
    }
    if (!window.confirm('Esto reemplaza canciones, listas, reglas, eventos, anuncios y configuración. El historial de votos se conserva. ¿Continuar?')) return
    const result = await run(() => api('/admin/restore', { method: 'POST', body: data }))
    if (result) {
      run(async () => onRestored(await api('/admin/config')), `Respaldo restaurado: ${result.songs} canciones, ${result.rules} reglas.`)
    }
    input.current.value = ''
  }

  async function resetDemo() {
    if (!window.confirm('Se reemplazarán catálogo, reglas, eventos, anuncios y configuración por los datos de ejemplo. ¿Continuar?')) return
    await run(() => api('/admin/reset-demo', { method: 'POST' }), 'Datos de ejemplo cargados')
    onRestored(await api('/admin/config'))
  }

  return (
    <section className="card">
      <h2 className="card__title">Respaldo y restablecimiento</h2>
      <p className="muted small">
        Descarga un respaldo antes de cambios grandes. Para restablecer el servicio tras un error de configuración, restaura el último respaldo bueno.
      </p>
      <div className="button-row">
        <button className="button" onClick={download}>
          Descargar respaldo (.json)
        </button>
        <label className="button">
          Restaurar desde archivo…
          <input ref={input} type="file" accept="application/json,.json" hidden onChange={(e) => restore(e.target.files[0])} />
        </label>
        <button className="button button--danger" onClick={resetDemo}>
          Restablecer datos de ejemplo
        </button>
      </div>
    </section>
  )
}
