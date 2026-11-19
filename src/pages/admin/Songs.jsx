import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../client/api.js'
import { loadYouTubeApi, YT_ERRORS } from '../../client/youtube.js'
import { mmss, thumbnail } from '../../client/format.js'
import { guessFromVideoTitle, parseDuration, parseYouTubeId } from '../../shared/youtube.js'
import { Badge, ConfirmButton, EditorModal, Empty, Field, Loading, PageHeader, TagPicker, Toggle, useAction, useAdmin, useCollection } from './ui.jsx'

const EMPTY = { youtubeId: '', title: '', artist: '', duration: '', genre: '', energy: 3, moods: [], themes: [], restrictions: [], enabled: true }

export function Songs() {
  const { items, error, save, remove } = useCollection('songs')
  const { config, notify } = useAdmin()
  const run = useAction()
  const [editing, setEditing] = useState(null)
  const [query, setQuery] = useState('')
  const [genre, setGenre] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (items ?? []).filter(
      (s) => (!genre || s.genre === genre) && (!q || [s.title, s.artist, ...s.moods, ...s.themes].join(' ').toLowerCase().includes(q)),
    )
  }, [items, query, genre])

  if (!items) return <Loading error={error} />
  const genres = [...new Set(items.map((s) => s.genre))].sort()
  const blocked = new Set(config.blockedRestrictions)

  return (
    <>
      <PageHeader title="Canciones" description={`${items.length} en el catálogo. Cada una se reproduce desde YouTube; no se guardan archivos de audio.`}>
        <button className="button button--primary" onClick={() => setEditing({ ...EMPTY })}>
          Agregar canción
        </button>
      </PageHeader>

      <div className="filters">
        <input type="search" placeholder="Buscar por título, artista, ambiente…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={genre} onChange={(e) => setGenre(e.target.value)}>
          <option value="">Todos los géneros</option>
          {genres.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </div>

      {visible.length === 0 ? (
        <Empty>No hay canciones que coincidan.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Canción</th>
                <th>Género</th>
                <th>Energía</th>
                <th>Ambiente · Temática</th>
                <th>Estado</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.id} className={!s.enabled ? 'row--off' : ''}>
                  <td>
                    <div className="media-row media-row--small">
                      <img src={thumbnail(s.youtubeId, 'default')} alt="" loading="lazy" />
                      <div>
                        <strong>{s.title}</strong>
                        <div className="muted small">
                          {s.artist} · {mmss(s.duration)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>{s.genre}</td>
                  <td>
                    <span className="energy" aria-label={`Energía ${s.energy} de 5`}>
                      {'●'.repeat(s.energy)}
                      <span className="energy__off">{'●'.repeat(5 - s.energy)}</span>
                    </span>
                  </td>
                  <td className="small">
                    {s.moods.join(', ')}
                    {s.themes.length > 0 && <div className="muted">{s.themes.join(', ')}</div>}
                  </td>
                  <td>
                    {!s.enabled && <Badge>Desactivada</Badge>}
                    {s.restrictions.map((r) => (
                      <Badge key={r} tone={blocked.has(r) ? 'bad' : 'warn'}>
                        {r}
                        {blocked.has(r) ? ' · bloqueada' : ''}
                      </Badge>
                    ))}
                    {s.errorCount > 0 && <Badge tone="bad">{s.errorCount} fallas</Badge>}
                  </td>
                  <td className="actions">
                    <button className="button button--small button--ghost" onClick={() => setEditing(s)}>
                      Editar
                    </button>
                    <ConfirmButton onConfirm={() => run(() => remove(s.id), 'Canción eliminada')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <SongEditor
          song={editing}
          isNew={!editing.id}
          tags={config.tags}
          onClose={() => setEditing(null)}
          onSave={(song) => save(song, !editing.id).then(() => notify('Canción guardada'))}
        />
      )}
    </>
  )
}

function SongEditor({ song, isNew, tags, onClose, onSave }) {
  const [draft, setDraft] = useState({ ...song, duration: song.duration ? mmss(song.duration) : '' })
  const [link, setLink] = useState(isNew ? '' : song.youtubeId)
  const [video, setVideo] = useState(isNew ? null : { youtubeId: song.youtubeId })
  const [lookup, setLookup] = useState(null)
  const [ai, setAi] = useState(null)
  // Lo que la persona edita a mano nunca lo pisa el autollenado.
  const touched = useRef(new Set())

  const set = (patch) => {
    Object.keys(patch).forEach((k) => touched.current.add(k))
    setDraft((d) => ({ ...d, ...patch }))
  }
  const fill = (patch, { force = false } = {}) =>
    setDraft((d) => {
      const next = { ...d }
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === '') continue
        if (force || !touched.current.has(key)) next[key] = value
      }
      return next
    })

  async function suggest(videoTitle, channel, options) {
    setAi({ status: 'pensando' })
    try {
      const s = await api('/admin/songs/suggest', { method: 'POST', body: { videoTitle, channel } })
      fill({ title: s.title, artist: s.artist, genre: s.genre, energy: s.energy, moods: s.moods.length ? s.moods : null, themes: s.themes, restrictions: s.restrictions }, options)
      setAi({ status: 'ok', confidence: s.confidence })
    } catch (e) {
      setAi({ status: 'error', message: e.message })
    }
  }

  // Al pegar un enlace válido se consulta solo: título, artista, duración y etiquetas.
  useEffect(() => {
    if (!isNew) return
    const id = parseYouTubeId(link)
    if (!id) {
      setVideo(null)
      setLookup(link.trim() ? { status: 'error', message: 'Pega un enlace de YouTube, por ejemplo youtube.com/watch?v=… o youtu.be/…' } : null)
      return
    }
    if (video?.youtubeId === id) return
    let cancelled = false
    setLookup({ status: 'buscando' })
    setAi(null)
    const timer = setTimeout(async () => {
      try {
        const info = await api(`/admin/youtube?url=${encodeURIComponent(id)}`)
        if (cancelled) return
        if (info.existing) {
          setVideo(null)
          setLookup({ status: 'error', message: `Ya está en el catálogo como “${info.existing.title}” de ${info.existing.artist}.` })
          return
        }
        setVideo(info)
        setLookup({ status: 'ok', message: `“${info.title}” · ${info.channel}` })
        const guess = guessFromVideoTitle(info.title, info.channel)
        setDraft((d) => ({ ...d, youtubeId: id }))
        fill({ title: guess.title, artist: guess.artist, duration: info.duration ? mmss(info.duration) : null })
        suggest(info.title, info.channel)
      } catch (e) {
        if (cancelled) return
        setVideo(null)
        setLookup({ status: 'error', message: e.message })
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link])

  function submit() {
    if (isNew && !video) throw new Error('Primero pega un enlace de YouTube válido.')
    const duration = parseDuration(draft.duration)
    if (!duration) throw new Error('Duración no válida. Usa minutos:segundos, por ejemplo 3:25.')
    return onSave({ ...draft, duration, energy: Number(draft.energy) })
  }

  const busy = lookup?.status === 'buscando' || ai?.status === 'pensando'

  return (
    <EditorModal title={isNew ? 'Agregar canción' : 'Editar canción'} size="wide" onClose={onClose} onSubmit={submit}>
      <Field label="Enlace de YouTube" hint={isNew ? 'Pégalo y el resto se llena solo.' : undefined} wide>
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          disabled={!isNew}
          placeholder="https://www.youtube.com/watch?v=…"
          autoFocus={isNew}
        />
        {lookup?.status === 'buscando' && <span className="field__hint">Consultando YouTube…</span>}
        {lookup?.status === 'error' && <span className="form-error">{lookup.message}</span>}
        {lookup?.status === 'ok' && <span className="field__hint">Encontrado: {lookup.message}</span>}
      </Field>

      {video && (
        <PlaybackCheck
          youtubeId={video.youtubeId}
          onDuration={(seconds) => fill({ duration: mmss(seconds) })}
        />
      )}

      {(video || !isNew) && (
        <>
          <div className="field field--wide autofill">
            {ai?.status === 'pensando' && <span className="field__hint">La IA está revisando la canción para sugerir título, artista y etiquetas…</span>}
            {ai?.status === 'ok' && (
              <span className="field__hint">
                <Badge tone="info">Sugerido por IA</Badge>
                {ai.confidence === 'baja' ? 'La IA no conoce bien esta canción: revisa con cuidado.' : 'Revisa antes de guardar; lo que cambies a mano se respeta.'}
              </span>
            )}
            {ai?.status === 'error' && (
              <span className="field__hint">
                No se pudieron sugerir etiquetas: {ai.message}{' '}
                {video?.title && (
                  <button type="button" className="link-button small" onClick={() => suggest(video.title, video.channel)}>
                    Reintentar
                  </button>
                )}
              </span>
            )}
            {!isNew && ai?.status !== 'pensando' && (
              <button type="button" className="link-button small" onClick={() => suggest(`${draft.artist} - ${draft.title}`, '', { force: true })}>
                Volver a sugerir etiquetas con IA
              </button>
            )}
          </div>

          <Field label="Título">
            <input value={draft.title} onChange={(e) => set({ title: e.target.value })} required maxLength={120} />
          </Field>
          <Field label="Artista">
            <input value={draft.artist} onChange={(e) => set({ artist: e.target.value })} required maxLength={120} />
          </Field>
          <Field label="Duración (min:seg)" hint="Se detecta sola. El servidor la vuelve a ajustar con la duración real al reproducirla.">
            <input value={draft.duration} onChange={(e) => set({ duration: e.target.value })} required placeholder="3:25" inputMode="numeric" />
          </Field>
          <Field label="Género">
            <input list="genres" value={draft.genre} onChange={(e) => set({ genre: e.target.value })} required />
            <datalist id="genres">
              {tags.genres.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </Field>
          <Field label={`Energía: ${draft.energy} de 5`} hint="1 = muy tranquila · 5 = muy intensa">
            <input type="range" min="1" max="5" value={draft.energy} onChange={(e) => set({ energy: Number(e.target.value) })} />
          </Field>
          <Toggle label="Disponible para la programación" checked={draft.enabled} onChange={(enabled) => set({ enabled })} />
          <Field label="Ambiente" wide>
            <TagPicker label="Ambiente" options={tags.moods} value={draft.moods} onChange={(moods) => set({ moods })} />
          </Field>
          <Field label="Temática" hint="Solo si es de temporada o de una fecha especial (Navidad, Día de Muertos…)." wide>
            <TagPicker label="Temática" options={tags.themes} value={draft.themes} onChange={(themes) => set({ themes })} />
          </Field>
          <Field label="Restricciones" hint="Las restricciones bloqueadas en Configuración nunca se ofrecen ni se reproducen." wide>
            <TagPicker label="Restricciones" options={tags.restrictions} value={draft.restrictions} onChange={(restrictions) => set({ restrictions })} />
          </Field>
          {busy && <p className="field--wide small muted">Puedes ir editando mientras termina el autollenado.</p>}
        </>
      )}
    </EditorModal>
  )
}

/** Reproduce el video en miniatura para comprobar que de verdad suena embebido, y lee su duración. */
function PlaybackCheck({ youtubeId, onDuration }) {
  const host = useRef(null)
  const [status, setStatus] = useState(null)
  const durationCallback = useRef(onDuration)
  durationCallback.current = onDuration

  useEffect(() => {
    let player
    let poll
    let cancelled = false
    setStatus('cargando')
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return
        player = new YT.Player(host.current, {
          width: '100%',
          height: '100%',
          videoId: youtubeId,
          playerVars: { rel: 0, playsinline: 1, origin: location.origin },
          events: {
            onReady: (e) => {
              setStatus('listo')
              // La duración puede tardar en estar disponible: se consulta unos segundos.
              let tries = 0
              poll = setInterval(() => {
                const d = e.target.getDuration?.() ?? 0
                if (d > 0 || ++tries > 30) {
                  clearInterval(poll)
                  if (d > 0) durationCallback.current(Math.round(d))
                }
              }, 500)
            },
            onStateChange: (e) => {
              if (e.data === YT.PlayerState.PLAYING) {
                setStatus('suena')
                durationCallback.current(Math.round(e.target.getDuration()))
              }
            },
            onError: (e) => setStatus(YT_ERRORS[e.data] ?? `Error ${e.data}`),
          },
        })
      })
      .catch((e) => setStatus(e.message))
    return () => {
      cancelled = true
      clearInterval(poll)
      player?.destroy?.()
    }
  }, [youtubeId])

  return (
    <div className="field field--wide">
      <div className="preview">
        <div className="preview__video">
          <div ref={host} />
        </div>
        <p className="small">
          {status === 'cargando' && 'Cargando reproductor…'}
          {status === 'listo' && 'Dale play si quieres comprobar que suena desde aquí.'}
          {status === 'suena' && <Badge tone="ok">Reproducción comprobada</Badge>}
          {status && !['cargando', 'listo', 'suena'].includes(status) && <span className="form-error">{status}</span>}
        </p>
      </div>
    </div>
  )
}
