import { useEffect, useMemo, useState } from 'react'
import { api } from '../../client/api.js'
import { useServerNow } from '../../client/useRadio.js'
import { mmss, percent, remainingSeconds, thumbnail, SOURCE_LABELS, fallbackLabel, formatDateTime } from '../../client/format.js'
import { Badge, PageHeader, useAction, useAdmin, Field } from './ui.jsx'

const PLAYER_LABELS = {
  reproduciendo: ['ok', 'Reproduciendo'],
  esperando: ['warn', 'Conectado, esperando reproducción'],
  error: ['bad', 'Error de reproducción'],
  desconectado: ['bad', 'Sin pantalla reproductora'],
}

export function Live() {
  const { state } = useAdmin()
  const run = useAction()
  const control = (body, success) => run(() => api('/admin/control', { method: 'POST', body }), success)

  if (!state) return <p className="muted">Conectando con la radio…</p>

  return (
    <>
      <PageHeader title="En vivo" description="Lo que está sonando, la votación en curso y la cola de reproducción.">
        {state.paused ? (
          <button className="button button--primary" onClick={() => control({ action: 'resume' }, 'Programación reanudada')}>
            Reanudar programación
          </button>
        ) : (
          <button className="button" onClick={() => control({ action: 'pause' }, 'Programación en pausa')}>
            Pausar programación
          </button>
        )}
        <button className="button" onClick={() => control({ action: 'skip' }, 'Saltando al siguiente elemento')}>
          Saltar
        </button>
      </PageHeader>

      {state.paused && (
        <div className="callout callout--warn">
          <strong>Programación en pausa.</strong> {state.pauseReason ?? 'La música está detenida y la votación congelada.'}
        </div>
      )}
      {!state.player.active && (
        <div className="callout callout--bad callout--action">
          <span>
            <strong>No hay audio.</strong> Ninguna pantalla está reproduciendo: las canciones avanzan por reloj, en silencio.
          </span>
          <a className="button button--primary" href="/pantalla" target="_blank" rel="noreferrer">
            Abrir pantalla con audio
          </a>
        </div>
      )}
      {state.lastError && Date.now() - state.lastError.at < 15 * 60_000 && (
        <div className="callout callout--bad">
          <strong>Última falla ({formatDateTime(state.lastError.at)}):</strong> {state.lastError.message}
        </div>
      )}

      <div className="live-grid">
        <NowCard state={state} />
        <RoundCard state={state} onClose={() => control({ action: 'close-round' }, 'Ronda cerrada')} />
        <QueueCard state={state} control={control} />
        <ContextCard state={state} />
      </div>
    </>
  )
}

function NowCard({ state }) {
  const now = useServerNow(state.serverNow - Date.now(), 1000)
  const item = state.nowPlaying
  const [tone, label] = PLAYER_LABELS[state.player.status] ?? ['neutral', state.player.status]
  return (
    <section className="card">
      <h2 className="card__title">Ahora</h2>
      {!item && <p className="muted">Nada en reproducción.</p>}
      {item?.kind === 'song' && (
        <div className="media-row">
          <img src={thumbnail(item.song.youtubeId, 'mqdefault')} alt="" />
          <div>
            <strong>{item.song.title}</strong>
            <p className="muted">{item.song.artist}</p>
            <p className="small">
              {mmss(Math.max(0, item.duration - (item.endsAt - now) / 1000))} / {mmss(item.duration)} · {SOURCE_LABELS[item.source] ?? item.source}
            </p>
          </div>
        </div>
      )}
      {item?.kind === 'intro' && item.song && (
        <div className="media-row">
          <img src={thumbnail(item.song.youtubeId, 'mqdefault')} alt="" />
          <div>
            <Badge tone="info">Presentación</Badge> <strong>{item.song.title}</strong>
            <p className="muted">“{item.text}”</p>
            <p className="small">{item.audioUrl ? 'Voz generada con IA' : 'Voz del navegador (el audio IA aún no estaba listo)'}</p>
          </div>
        </div>
      )}
      {item?.kind === 'announcement' && (
        <div>
          <Badge tone="info">Anuncio</Badge> <strong>{item.announcement?.title}</strong>
          <p className="muted">{item.announcement?.text}</p>
          <p className="small">{item.audioUrl ? 'Voz generada con IA' : 'Voz del navegador (sin audio generado)'}</p>
        </div>
      )}
      <p className="status-line">
        <Badge tone={tone}>{label}</Badge>
        {state.player.message && <span className="small">{state.player.message}</span>}
      </p>
      {!state.player.active && (
        <p className="small muted">Mientras no haya pantalla reproductora, la programación avanza por reloj sin sonido.</p>
      )}
    </section>
  )
}

function RoundCard({ state, onClose }) {
  const now = useServerNow(state.serverNow - Date.now(), 500)
  const round = state.round
  if (!round) {
    return (
      <section className="card">
        <h2 className="card__title">Votación</h2>
        <p className="muted">No hay ronda. Se abre una con cada canción, salvo que ya haya una canción programada en la cola.</p>
      </section>
    )
  }
  const counts = state.liveCounts ?? [0, 0]
  const total = counts.reduce((a, b) => a + b, 0)
  const open = round.status === 'open'
  return (
    <section className="card">
      <h2 className="card__title">
        Ronda #{round.id}{' '}
        {open ? <Badge tone="ok">Abierta · cierra en {mmss(remainingSeconds(round.closesAt, now))}</Badge> : <Badge>Cerrada</Badge>}
      </h2>
      <ul className="bars" aria-label="Votos por opción">
        {round.options.map((song, i) => (
          <li key={song.id} className={`bars__row ${!open && round.winner === i ? 'bars__row--win' : ''}`}>
            <span className="bars__label">
              {i === 0 ? 'A' : 'B'} · {song.title} <span className="muted">— {song.artist}</span>
            </span>
            <span className={`bars__track bars__track--${i === 0 ? 'a' : 'b'}`}>
              <span style={{ width: `${percent(counts[i], total)}%` }} title={`${counts[i]} votos`} />
            </span>
            <span className="bars__value">{counts[i]}</span>
          </li>
        ))}
      </ul>
      <p className="small">
        {total} votos{!open && round.resolution && <> · {round.resolution === 'votos' ? 'Ganó por votos' : round.resolution === 'empate' ? 'Empate resuelto por regla' : 'Sin votos: decidió la regla configurada'}</>}
      </p>
      {state.roundTrace && <TraceSummary trace={state.roundTrace} />}
      {open && (
        <button className="button button--small" onClick={onClose}>
          Cerrar ronda ahora
        </button>
      )}
    </section>
  )
}

export function TraceSummary({ trace }) {
  return (
    <details className="trace">
      <summary>¿Por qué estas opciones?</summary>
      {trace.fallback && <p>Selección de respaldo: {fallbackLabel(trace.fallback)}.</p>}
      {trace.applied.length > 0 && <p>Reglas aplicadas: {trace.applied.map((r) => `${r.name} (${r.priority})`).join(', ')}.</p>}
      {trace.relaxed.length > 0 && <p>Reglas relajadas por falta de canciones: {trace.relaxed.map((r) => r.name).join(', ')}.</p>}
      {trace.exclusive && <p>“{trace.exclusive}” es exclusiva: las reglas de menor prioridad no se evaluaron.</p>}
      {trace.missing.length > 0 && <p>Sin datos para: {trace.missing.join(', ')}.</p>}
      {!trace.fallback && !trace.applied.length && <p>Ninguna regla aplicó: se eligió del catálogo autorizado.</p>}
    </details>
  )
}

function QueueCard({ state, control }) {
  const [songs, setSongs] = useState([])
  const [announcements, setAnnouncements] = useState([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    api('/admin/songs').then(setSongs).catch(() => {})
    api('/admin/announcements').then(setAnnouncements).catch(() => {})
  }, [])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return songs.filter((s) => s.enabled && (!q || `${s.title} ${s.artist}`.toLowerCase().includes(q))).slice(0, 50)
  }, [songs, query])

  return (
    <section className="card">
      <h2 className="card__title">Cola de reproducción</h2>
      {state.queue.length === 0 ? (
        <p className="muted">Vacía. Al terminar la canción suena la ganadora de la ronda o una selección automática.</p>
      ) : (
        <ol className="queue">
          {state.queue.map((item, i) => (
            <li key={item.key}>
              <span>
                {item.kind === 'song' ? (
                  <>
                    <strong>{item.song?.title}</strong> <span className="muted">— {item.song?.artist}</span>
                  </>
                ) : (
                  <>
                    <Badge tone="info">Anuncio</Badge> {item.title}
                  </>
                )}
                <span className="small muted"> · {SOURCE_LABELS[item.source] ?? item.source}</span>
              </span>
              <span className="queue__actions">
                <button className="icon-button" disabled={i === 0} onClick={() => control({ action: 'move', key: item.key, direction: 'up' })} aria-label="Subir">
                  ↑
                </button>
                <button className="icon-button" disabled={i === state.queue.length - 1} onClick={() => control({ action: 'move', key: item.key, direction: 'down' })} aria-label="Bajar">
                  ↓
                </button>
                <button className="icon-button" onClick={() => control({ action: 'remove', key: item.key }, 'Quitado de la cola')} aria-label="Quitar">
                  ×
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="inline-form">
        <span className="field__label" id="picker-label">
          Programar una canción
        </span>
        <input
          type="search"
          aria-labelledby="picker-label"
          placeholder="Buscar por título o artista…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {/* Cada canción trae sus propios botones: un clic y queda programada. */}
        <ul className="picker" aria-labelledby="picker-label">
          {matches.length === 0 && <li className="picker__empty muted small">Ninguna canción coincide.</li>}
          {matches.map((s) => (
            <li key={s.id} className="picker__row">
              <img src={thumbnail(s.youtubeId, 'default')} alt="" loading="lazy" />
              <span className="picker__text">
                <strong>{s.title}</strong>
                <span className="muted small">{s.artist}</span>
              </span>
              <span className="picker__actions">
                <button
                  type="button"
                  className="button button--small"
                  onClick={() => control({ action: 'enqueue', songId: s.id, position: 'next' }, `“${s.title}” sonará a continuación`)}
                >
                  Siguiente
                </button>
                <button
                  type="button"
                  className="button button--small button--ghost"
                  onClick={() => control({ action: 'enqueue', songId: s.id, position: 'end' }, `“${s.title}” agregada al final de la cola`)}
                >
                  Al final
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="inline-form">
        <Field label="Intercalar un anuncio al terminar la canción">
          <select defaultValue="" onChange={(e) => e.target.value && control({ action: 'announce', announcementId: e.target.value }, 'Anuncio programado').then(() => (e.target.value = ''))}>
            <option value="">Elegir anuncio aprobado…</option>
            {announcements
              .filter((a) => a.approved && a.enabled)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
          </select>
        </Field>
      </div>
    </section>
  )
}

function ContextCard({ state }) {
  const ctx = state.contextDetail
  const { weather } = state
  const run = useAction()
  return (
    <section className="card">
      <h2 className="card__title">Contexto actual</h2>
      <dl className="facts">
        <dt>Hora del campus</dt>
        <dd>
          {ctx.time} · {ctx.daypart}
        </dd>
        <dt>Temperatura</dt>
        <dd>
          {weather.current !== null ? `${weather.current} °C` : <Badge tone="warn">No disponible</Badge>}
          {weather.error && <span className="small muted"> · {weather.error}</span>}{' '}
          <button className="link-button small" onClick={() => run(() => api('/admin/weather/refresh', { method: 'POST' }), 'Clima actualizado')}>
            actualizar
          </button>
        </dd>
        <dt>Calendario</dt>
        <dd>{ctx.events.length ? ctx.events.map((e) => e.name).join(', ') : 'Sin eventos hoy'}</dd>
        <dt>Reglas activas</dt>
        <dd>{state.context.rules.length ? state.context.rules.join(', ') : 'Ninguna'}</dd>
        <dt>Voz IA</dt>
        <dd>{state.services.tts ? <Badge tone="ok">Gemini configurado</Badge> : <Badge tone="warn">Sin clave: voz del navegador</Badge>}</dd>
      </dl>
    </section>
  )
}
