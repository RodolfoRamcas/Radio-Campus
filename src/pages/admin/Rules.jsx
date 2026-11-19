import { useEffect, useState } from 'react'
import { api } from '../../client/api.js'
import { thumbnail } from '../../client/format.js'
import { CONDITION_TYPES, EVENT_TYPES, describeCondition } from '../../shared/context.js'
import {
  Badge, ConfirmButton, DaysPicker, EditorModal, Empty, Field, Loading, PageHeader, TagPicker, Toggle,
  numberOrNull, useAction, useAdmin, useCollection,
} from './ui.jsx'
import { TraceSummary } from './Live.jsx'

const NEW_RULE = {
  name: '',
  priority: 50,
  enabled: true,
  exclusive: false,
  when: { type: 'horario', days: [], from: '08:00', to: '12:00' },
  effect: { genres: [], moods: [], themes: [], energyMin: null, energyMax: null, playlistId: null, requireTheme: false, useEventTheme: false },
}

function describeEffect(effect, playlists) {
  const parts = []
  if (effect.genres?.length) parts.push(`Géneros: ${effect.genres.join(', ')}`)
  if (effect.energyMin != null || effect.energyMax != null) parts.push(`Energía ${effect.energyMin ?? 1}–${effect.energyMax ?? 5}`)
  if (effect.playlistId) parts.push(`Lista: ${playlists.find((p) => p.id === effect.playlistId)?.name ?? '—'}`)
  if (effect.moods?.length) parts.push(`Prefiere: ${effect.moods.join(', ')}`)
  if (effect.useEventTheme) parts.push('Temática del evento')
  if (effect.themes?.length) parts.push(`Temática: ${effect.themes.join(', ')}${effect.requireTheme ? ' (obligatoria)' : ''}`)
  return parts.join(' · ') || 'Sin efecto'
}

export function Rules() {
  const { items, error, save, remove } = useCollection('rules')
  const { config, state, notify } = useAdmin()
  const run = useAction()
  const [playlists, setPlaylists] = useState([])
  const [editing, setEditing] = useState(null)

  useEffect(() => {
    api('/admin/playlists').then(setPlaylists).catch(() => {})
  }, [])

  if (!items) return <Loading error={error} />
  const active = new Set(state?.context.rules ?? [])

  return (
    <>
      <PageHeader
        title="Reglas contextuales"
        description="Convierten hora, temperatura y calendario en restricciones y preferencias. Se aplican de mayor a menor prioridad; una regla exclusiva ignora a las de menor prioridad."
      >
        <button className="button button--primary" onClick={() => setEditing(structuredClone(NEW_RULE))}>
          Nueva regla
        </button>
      </PageHeader>

      {items.length === 0 ? (
        <Empty>Sin reglas: se ofrece cualquier canción autorizada.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Prioridad</th>
                <th>Regla</th>
                <th>Cuándo</th>
                <th>Efecto</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className={!r.enabled ? 'row--off' : ''}>
                  <td>
                    <span className="priority">{r.priority}</span>
                  </td>
                  <td>
                    <strong>{r.name}</strong>
                    <div>
                      {active.has(r.name) && <Badge tone="ok">Aplica ahora</Badge>}
                      {r.exclusive && <Badge tone="info">Exclusiva</Badge>}
                      {!r.enabled && <Badge>Desactivada</Badge>}
                    </div>
                  </td>
                  <td className="small">
                    {CONDITION_TYPES[r.when.type]}: {describeCondition(r.when)}
                  </td>
                  <td className="small">{describeEffect(r.effect, playlists)}</td>
                  <td className="actions">
                    <button className="button button--small button--ghost" onClick={() => setEditing(structuredClone(r))}>
                      Editar
                    </button>
                    <ConfirmButton onConfirm={() => run(() => remove(r.id), 'Regla eliminada')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Simulator />

      {editing && (
        <RuleEditor
          rule={editing}
          tags={config.tags}
          playlists={playlists}
          onClose={() => setEditing(null)}
          onSave={(rule) => save(rule, !editing.id).then(() => notify('Regla guardada'))}
        />
      )}
    </>
  )
}

function RuleEditor({ rule, tags, playlists, onClose, onSave }) {
  const [draft, setDraft] = useState(rule)
  const when = draft.when
  const effect = draft.effect
  const setWhen = (patch) => setDraft((d) => ({ ...d, when: { ...d.when, ...patch } }))
  const setEffect = (patch) => setDraft((d) => ({ ...d, effect: { ...d.effect, ...patch } }))

  return (
    <EditorModal title={rule.id ? 'Editar regla' : 'Nueva regla'} size="wide" onClose={onClose} onSubmit={() => onSave(draft)}>
      <Field label="Nombre" wide>
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required maxLength={120} />
      </Field>
      <Field label="Prioridad (0–100)" hint="La de mayor número se evalúa primero.">
        <input type="number" min="0" max="100" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} required />
      </Field>
      <div className="field">
        <Toggle label="Activa" checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} />
        <Toggle label="Exclusiva (ignora reglas de menor prioridad)" checked={draft.exclusive} onChange={(exclusive) => setDraft({ ...draft, exclusive })} />
      </div>

      <fieldset className="fieldset field--wide">
        <legend>Cuándo aplica</legend>
        <Field label="Tipo de condición">
          <select value={when.type} onChange={(e) => setDraft({ ...draft, when: { type: e.target.value } })}>
            {Object.entries(CONDITION_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        {when.type === 'horario' && (
          <>
            <Field label="Desde">
              <input type="time" value={when.from ?? ''} onChange={(e) => setWhen({ from: e.target.value })} />
            </Field>
            <Field label="Hasta" hint="Si es menor que “desde”, cruza la medianoche.">
              <input type="time" value={when.to ?? ''} onChange={(e) => setWhen({ to: e.target.value })} />
            </Field>
            <Field label="Días (vacío = todos)" wide>
              <DaysPicker value={when.days ?? []} onChange={(days) => setWhen({ days })} />
            </Field>
          </>
        )}
        {when.type === 'temperatura' && (
          <>
            <Field label="Mínima (°C)">
              <input type="number" step="0.5" value={when.min ?? ''} onChange={(e) => setWhen({ min: numberOrNull(e.target.value) })} />
            </Field>
            <Field label="Máxima (°C)">
              <input type="number" step="0.5" value={when.max ?? ''} onChange={(e) => setWhen({ max: numberOrNull(e.target.value) })} />
            </Field>
          </>
        )}
        {when.type === 'evento' && (
          <>
            <Field label="Tipo de evento">
              <select value={when.eventType ?? ''} onChange={(e) => setWhen({ eventType: e.target.value || null })}>
                <option value="">Cualquiera</option>
                {Object.entries(EVENT_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Solo eventos con temática" hint="Opcional.">
              <select value={when.theme ?? ''} onChange={(e) => setWhen({ theme: e.target.value || null })}>
                <option value="">Cualquier temática</option>
                {tags.themes.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
          </>
        )}
      </fieldset>

      <fieldset className="fieldset field--wide">
        <legend>Qué música permite (restricciones)</legend>
        <Field label="Géneros permitidos (vacío = todos)" wide>
          <TagPicker label="Géneros" options={tags.genres} value={effect.genres ?? []} onChange={(genres) => setEffect({ genres })} allowCustom={false} />
        </Field>
        <Field label="Energía mínima">
          <select value={effect.energyMin ?? ''} onChange={(e) => setEffect({ energyMin: numberOrNull(e.target.value) })}>
            <option value="">Sin mínimo</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </Field>
        <Field label="Energía máxima">
          <select value={effect.energyMax ?? ''} onChange={(e) => setEffect({ energyMax: numberOrNull(e.target.value) })}>
            <option value="">Sin máximo</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </Field>
        <Field label="Solo canciones de la lista">
          <select value={effect.playlistId ?? ''} onChange={(e) => setEffect({ playlistId: e.target.value || null })}>
            <option value="">Cualquier lista</option>
            {playlists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </fieldset>

      <fieldset className="fieldset field--wide">
        <legend>Qué música prefiere (ambiente y temática)</legend>
        <Field label="Ambientes preferidos" wide>
          <TagPicker label="Ambientes" options={tags.moods} value={effect.moods ?? []} onChange={(moods) => setEffect({ moods })} allowCustom={false} />
        </Field>
        <Field label="Temáticas preferidas" wide>
          <TagPicker label="Temáticas" options={tags.themes} value={effect.themes ?? []} onChange={(themes) => setEffect({ themes })} allowCustom={false} />
        </Field>
        {when.type === 'evento' && (
          <Toggle label="Usar la temática del evento activo (por ejemplo, Navidad)" checked={effect.useEventTheme} onChange={(useEventTheme) => setEffect({ useEventTheme })} />
        )}
        <Toggle label="La temática es obligatoria (no solo preferida)" checked={effect.requireTheme} onChange={(requireTheme) => setEffect({ requireTheme })} />
      </fieldset>
    </EditorModal>
  )
}

function Simulator() {
  const { state } = useAdmin()
  const today = state?.contextDetail
  const [input, setInput] = useState({ date: today?.date ?? '2026-12-10', time: today?.time ?? '10:00', temperature: today?.temperature ?? 22 })
  const [result, setResult] = useState(null)
  const run = useAction()

  async function simulate(e) {
    e.preventDefault()
    const data = await run(() => api('/admin/simulate', { method: 'POST', body: input }))
    if (data) setResult(data)
  }

  return (
    <section className="card simulator">
      <h2 className="card__title">Simulador</h2>
      <p className="muted small">Prueba qué se ofrecería en otra fecha, hora o temperatura. No afecta a la radio.</p>
      <form className="inline-fields" onSubmit={simulate}>
        <Field label="Fecha">
          <input type="date" value={input.date} onChange={(e) => setInput({ ...input, date: e.target.value })} required />
        </Field>
        <Field label="Hora">
          <input type="time" value={input.time} onChange={(e) => setInput({ ...input, time: e.target.value })} required />
        </Field>
        <Field label="Temperatura °C (vacío = sin dato)">
          <input type="number" step="0.5" value={input.temperature ?? ''} onChange={(e) => setInput({ ...input, temperature: e.target.value })} />
        </Field>
        <button className="button">Simular</button>
      </form>
      {result && (
        <div className="simulator__result">
          <p className="small">
            {result.context.daypart} · {result.context.events.length ? `Eventos: ${result.context.events.map((e) => e.name).join(', ')}` : 'Sin eventos'}
          </p>
          <ul className="sim-rules">
            {result.rules.map((r) => (
              <li key={r.id}>
                <Badge tone={r.status === 'aplica' ? (result.trace.applied.some((a) => a.id === r.id) ? 'ok' : 'warn') : r.status === 'sin-datos' ? 'bad' : 'neutral'}>
                  {r.status === 'aplica' ? (result.trace.applied.some((a) => a.id === r.id) ? 'aplicada' : 'relajada u omitida') : r.status}
                </Badge>{' '}
                {r.name}
              </li>
            ))}
          </ul>
          <TraceSummary trace={result.trace} />
          <p className="small">Canciones que podrían ofrecerse:</p>
          <ul className="sim-songs">
            {result.options.map((s) => (
              <li key={s.id}>
                <img src={thumbnail(s.youtubeId, 'default')} alt="" />
                <span>
                  <strong>{s.title}</strong> — {s.artist}
                  <span className="muted small">
                    {' '}
                    · {s.genre} · energía {s.energy}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
