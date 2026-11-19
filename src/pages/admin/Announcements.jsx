import { useEffect, useRef, useState } from 'react'
import { api } from '../../client/api.js'
import { speak } from '../../client/speech.js'
import { announcementStatus, MAX_ANNOUNCEMENT_CHARS, STATUS_LABELS } from '../../shared/announcements.js'
import { VOICES } from '../../shared/defaults.js'
import { DAY_LABELS } from '../../shared/time.js'
import { Badge, ConfirmButton, DaysPicker, EditorModal, Empty, Field, Loading, PageHeader, Toggle, useAction, useAdmin, useCollection } from './ui.jsx'

const STATUS_TONES = { borrador: 'warn', desactivado: 'neutral', programado: 'info', vigente: 'ok', vencido: 'bad' }

function schedule(a) {
  const parts = []
  if (a.startsAt || a.endsAt) parts.push(`${a.startsAt?.replace('T', ' ') ?? 'ya'} → ${a.endsAt?.replace('T', ' ') ?? 'sin fin'}`)
  if (a.days.length && a.days.length < 7) parts.push(a.days.map((d) => DAY_LABELS[d]).join(', '))
  if (a.fromTime && a.toTime) parts.push(`${a.fromTime}–${a.toTime}`)
  parts.push(`cada ${a.everyMinutes} min`)
  return parts.join(' · ')
}

/** Reproduce la vista previa con la voz de Gemini o, si no está configurada, con la del navegador. */
function usePreview() {
  const [state, setState] = useState(null)
  const stopRef = useRef(() => {})
  useEffect(() => () => stopRef.current(), [])

  async function play(text, voice) {
    stopRef.current()
    setState({ status: 'generando' })
    try {
      const response = await api('/admin/tts', { method: 'POST', body: { text, voice }, raw: true })
      const url = URL.createObjectURL(await response.blob())
      const audio = new Audio(url)
      stopRef.current = () => {
        audio.pause()
        URL.revokeObjectURL(url)
      }
      audio.onended = () => setState({ status: 'listo', source: 'Gemini' })
      await audio.play()
      setState({ status: 'sonando', source: 'Voz IA (Gemini)' })
    } catch (e) {
      // Sin clave o sin cuota: la pantalla usará la voz del navegador, así que la vista previa también.
      stopRef.current = speak(text, { onEnd: () => setState({ status: 'listo', source: 'navegador' }) })
      setState({ status: 'sonando', source: 'Voz del navegador', note: e.message })
    }
  }
  return { state, play, stop: () => (stopRef.current(), setState(null)) }
}

export function Announcements() {
  const { items, error, save, remove } = useCollection('announcements')
  const { state, config, notify } = useAdmin()
  const run = useAction()
  const [editing, setEditing] = useState(null)

  if (!items || !state) return <Loading error={error} />
  const ctx = state.contextDetail

  async function saveAnnouncement(a, isNew) {
    const result = await save(a, isNew)
    if (result.audio?.status === 'error') notify(`Anuncio guardado. Voz IA no disponible: ${result.audio.error}`, 'error')
    else if (result.item.approved) notify('Anuncio guardado y convertido a voz')
    else notify('Borrador guardado. Apruébalo para que pueda sonar.')
  }

  return (
    <>
      <PageHeader title="Anuncios y locución" description="Textos autorizados que se convierten a voz y suenan entre canciones, nunca encima de la música.">
        <button
          className="button button--primary"
          onClick={() =>
            setEditing({ title: '', text: '', approved: false, enabled: true, priority: 3, startsAt: null, endsAt: null, days: [], fromTime: null, toTime: null, everyMinutes: 30, voice: null })
          }
        >
          Nuevo anuncio
        </button>
      </PageHeader>

      {items.length === 0 ? (
        <Empty>Sin anuncios.</Empty>
      ) : (
        <div className="cards">
          {items.map((a) => {
            const status = announcementStatus(a, ctx)
            return (
              <article key={a.id} className={`card ${status === 'vencido' ? 'card--off' : ''}`}>
                <h2 className="card__title">
                  {a.title} <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>
                </h2>
                <p>{a.text}</p>
                <p className="small muted">
                  Prioridad {a.priority} · {schedule(a)}
                </p>
                <div className="button-row">
                  <button className="button button--small button--ghost" onClick={() => setEditing(a)}>
                    {a.approved ? 'Editar' : 'Revisar'}
                  </button>
                  {status === 'vigente' || status === 'programado' ? (
                    <button
                      className="button button--small button--ghost"
                      onClick={() => run(() => api('/admin/control', { method: 'POST', body: { action: 'announce', announcementId: a.id } }), 'Sonará al terminar la canción actual')}
                    >
                      Reproducir al terminar la canción
                    </button>
                  ) : null}
                  <ConfirmButton onConfirm={() => run(() => remove(a.id), 'Anuncio eliminado')} />
                </div>
              </article>
            )
          })}
        </div>
      )}

      {editing && (
        <AnnouncementEditor
          announcement={editing}
          defaultVoice={config.voice}
          ttsConfigured={state.services.tts}
          onClose={() => setEditing(null)}
          onSave={(a) => saveAnnouncement(a, !editing.id)}
        />
      )}
    </>
  )
}

function AnnouncementEditor({ announcement, defaultVoice, ttsConfigured, onClose, onSave }) {
  const [draft, setDraft] = useState(announcement)
  const preview = usePreview()
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const left = MAX_ANNOUNCEMENT_CHARS - draft.text.length

  return (
    <EditorModal
      title={announcement.id ? 'Editar anuncio' : 'Nuevo anuncio'}
      size="wide"
      onClose={() => {
        preview.stop()
        onClose()
      }}
      onSubmit={() => onSave(draft)}
      extraActions={
        <button type="button" className="button button--ghost" disabled={!draft.text.trim() || preview.state?.status === 'generando'} onClick={() => preview.play(draft.text, draft.voice || defaultVoice)}>
          {preview.state?.status === 'generando' ? 'Generando voz…' : 'Escuchar vista previa'}
        </button>
      }
    >
      <Field label="Título (aparece en la pantalla)" wide>
        <input value={draft.title} onChange={(e) => set({ title: e.target.value })} required maxLength={120} />
      </Field>
      <Field label="Texto que se lee en voz alta" hint={`${left} caracteres disponibles. Escribe números y fechas con letra para que la voz los lea bien.`} wide>
        <textarea rows={4} value={draft.text} onChange={(e) => set({ text: e.target.value })} required maxLength={MAX_ANNOUNCEMENT_CHARS} />
      </Field>
      {preview.state && (
        <p className="field--wide small">
          {preview.state.status === 'generando' ? 'Generando audio…' : `Vista previa: ${preview.state.source}.`}
          {preview.state.note && <span className="muted"> ({preview.state.note})</span>}
        </p>
      )}
      <Field label="Voz" hint={ttsConfigured ? 'Voces de Gemini.' : 'Sin GEMINI_API_KEY: la pantalla usará la voz del navegador.'}>
        <select value={draft.voice ?? ''} onChange={(e) => set({ voice: e.target.value || null })}>
          <option value="">Predeterminada ({defaultVoice})</option>
          {VOICES.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </Field>
      <Field label="Prioridad (1–10)" hint="Si coinciden varios, suena primero el de mayor prioridad.">
        <input type="number" min="1" max="10" value={draft.priority} onChange={(e) => set({ priority: Number(e.target.value) })} />
      </Field>
      <Field label="Vigente desde" hint="Vacío = desde ya.">
        <input type="datetime-local" value={draft.startsAt ?? ''} onChange={(e) => set({ startsAt: e.target.value || null })} />
      </Field>
      <Field label="Vigente hasta" hint="Después de esta fecha no vuelve a sonar.">
        <input type="datetime-local" value={draft.endsAt ?? ''} onChange={(e) => set({ endsAt: e.target.value || null })} />
      </Field>
      <Field label="Horario diario: desde">
        <input type="time" value={draft.fromTime ?? ''} onChange={(e) => set({ fromTime: e.target.value || null })} />
      </Field>
      <Field label="Horario diario: hasta">
        <input type="time" value={draft.toTime ?? ''} onChange={(e) => set({ toTime: e.target.value || null })} />
      </Field>
      <Field label="Frecuencia: como máximo una vez cada (minutos)">
        <input type="number" min="5" max="1440" value={draft.everyMinutes} onChange={(e) => set({ everyMinutes: Number(e.target.value) })} />
      </Field>
      <Field label="Días (vacío = todos)">
        <DaysPicker value={draft.days} onChange={(days) => set({ days })} />
      </Field>
      <div className="field field--wide">
        <Toggle label="Texto revisado y aprobado para transmitirse" checked={draft.approved} onChange={(approved) => set({ approved })} />
        <Toggle label="Activo" checked={draft.enabled} onChange={(enabled) => set({ enabled })} />
      </div>
    </EditorModal>
  )
}
