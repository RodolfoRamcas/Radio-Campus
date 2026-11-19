// Pantalla pública del campus (formato horizontal, legible a distancia).
import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { useRadio, useServerNow } from '../client/useRadio.js'
import { mmss, percent, remainingSeconds, thumbnail, formatDateRange, SOURCE_LABELS } from '../client/format.js'
import { AnnouncementPlayer, SongPlayer } from '../components/Players.jsx'
import { ConnectionBadge } from '../components/ConnectionBadge.jsx'
import '../styles/screen.css'

const voteUrl = () => `${location.origin}/votar`

function useQrSvg(text) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0d12', light: '#ffffff' } })
      .then(setSvg)
      .catch(() => setSvg(''))
  }, [text])
  return svg
}

export function Screen() {
  const { state, connection, isPlayer, canPlay, accessKnown, send, offset } = useRadio('screen')
  // 'auto': se ofrece si nadie más tiene el audio · 'open': la persona lo pidió · 'closed': solo mostrar
  const [gate, setGate] = useState('auto')
  const wasPlayer = useRef(false)
  const previous = useRef({ isPlayer: false })

  // Si se corta la red, al reconectar vuelve a tomar el audio sin que nadie tenga que dar clic.
  // Si otra pantalla lo tomó (la conexión sigue abierta), no lo reclama: evita que dos pantallas se lo peleen.
  useEffect(() => {
    const lostWhileConnected = previous.current.isPlayer && !isPlayer && connection === 'conectado'
    previous.current = { isPlayer }
    if (isPlayer) wasPlayer.current = true
    else if (lostWhileConnected) wasPlayer.current = false
    else if (wasPlayer.current && canPlay && connection === 'conectado') send({ type: 'claim-player' })
  }, [isPlayer, canPlay, connection, send])
  const now = useServerNow(offset)
  const [problem, setProblem] = useState(null)
  const qr = useQrSvg(voteUrl())

  useEffect(() => {
    document.title = state?.station ? `${state.station} · Pantalla` : 'Pantalla'
  }, [state?.station])

  if (!state) {
    return (
      <div className="screen screen--loading">
        <div className="screen__boot">Conectando con la radio…</div>
      </div>
    )
  }

  const { nowPlaying, round, paused } = state
  const playerElsewhere = state.player.active && !isPlayer

  return (
    <div className="screen">
      <header className="screen__top">
        <div className="brand">
          <span className={`onair ${paused ? 'onair--off' : ''}`}>{paused ? 'En pausa' : 'Al aire'}</span>
          <span className="brand__name">{state.station}</span>
        </div>
        <ContextStrip context={state.context} place={state.place} />
        <div className="screen__status">
          <PlayerStatus player={state.player} isPlayer={isPlayer} problem={problem} />
          <ConnectionBadge connection={connection} />
        </div>
      </header>

      <main className="screen__main">
        <section className="stage-card">
          {nowPlaying?.kind === 'announcement' ? (
            <AnnouncementCard nowPlaying={nowPlaying} />
          ) : nowPlaying?.kind === 'intro' ? (
            <IntroCard nowPlaying={nowPlaying} />
          ) : (
            <NowPlaying nowPlaying={nowPlaying} now={now} isPlayer={isPlayer} upNext={state.upNext} paused={paused}>
              {isPlayer && <SongPlayer nowPlaying={nowPlaying} paused={paused} offset={offset} send={send} onProblem={setProblem} />}
            </NowPlaying>
          )}
          {/* Durante un anuncio el video se desmonta: así nunca se encima con la locución. */}
          {isPlayer && <AnnouncementPlayer nowPlaying={nowPlaying} paused={paused} send={send} onProblem={setProblem} />}
        </section>

        <section className="vote-card">
          <RoundPanel round={round} now={now} paused={paused} />
          <div className="qr">
            <div className="qr__code" dangerouslySetInnerHTML={{ __html: qr }} aria-label="Código QR para votar" />
            <div className="qr__text">
              <strong>Vota desde tu celular</strong>
              <span>Escanea el código o entra a</span>
              <code>{voteUrl().replace(/^https?:\/\//, '')}</code>
            </div>
          </div>
        </section>
      </main>

      <Ticker state={state} />

      {accessKnown && !isPlayer && (gate === 'open' || (gate === 'auto' && !playerElsewhere)) && (
        <AudioGate disabled={connection !== 'conectado' || !canPlay} onClaim={() => send({ type: 'claim-player' })} onDismiss={() => setGate('closed')} />
      )}
      {!isPlayer && gate !== 'open' && (playerElsewhere || gate === 'closed') && (
        <button className="claim-here" onClick={() => send({ type: 'claim-player' })}>
          {playerElsewhere ? 'Reproducir el audio aquí' : 'Activar audio'}
        </button>
      )}
      {paused && (
        <div className="screen__paused">
          <strong>Programación en pausa</strong>
          {state.pauseReason && <span>{state.pauseReason}</span>}
        </div>
      )}
    </div>
  )
}

function ContextStrip({ context, place }) {
  const chips = [...context.events, ...context.rules].slice(0, 3)
  return (
    <div className="context">
      <span className="context__clock">{context.time}</span>
      <span className="context__temp">
        {context.temperature !== null ? `${Math.round(context.temperature)} °C` : '— °C'}
        {place && <span className="context__place"> · {place.split(',')[0]}</span>}
      </span>
      {chips.map((c) => (
        <span key={c} className="chip">
          {c}
        </span>
      ))}
    </div>
  )
}

function AudioGate({ disabled, onClaim, onDismiss }) {
  return (
    <div className="screen__gate">
      <button className="gate-button" onClick={onClaim} disabled={disabled}>
        Activar audio en esta pantalla
      </button>
      <p>El navegador exige un clic antes de reproducir sonido. Solo una pantalla reproduce el audio a la vez.</p>
      <button className="gate-skip" onClick={onDismiss}>
        Solo mostrar, sin audio
      </button>
    </div>
  )
}

function PlayerStatus({ player, isPlayer, problem }) {
  if (problem) return <span className="pill pill--bad">{problem}</span>
  if (player.status === 'error' && player.message) return <span className="pill pill--bad">{player.message}</span>
  if (!player.active) return <span className="pill pill--warn">Sin reproductor de audio</span>
  if (isPlayer) return <span className="pill pill--ok">Audio en esta pantalla</span>
  return null
}

function NowPlaying({ nowPlaying, now, isPlayer, upNext, paused, children }) {
  if (!nowPlaying) {
    return (
      <div className="now now--empty">
        <p className="eyebrow">Ahora suena</p>
        <h1 className="now__title">Preparando la programación…</h1>
      </div>
    )
  }
  const { song } = nowPlaying
  const total = nowPlaying.duration
  const left = paused ? null : (nowPlaying.endsAt - now) / 1000
  const elapsed = left === null ? null : Math.min(total, Math.max(0, total - left))
  return (
    <div className="now">
      <div className="now__media">
        {isPlayer ? children : <img src={thumbnail(song.youtubeId)} alt="" />}
      </div>
      <div className="now__info">
        <p className="eyebrow">Ahora suena · {SOURCE_LABELS[nowPlaying.source] ?? ''}</p>
        <h1 className="now__title">{song.title}</h1>
        <p className="now__artist">{song.artist}</p>
        {elapsed !== null && (
          <div className="progress" aria-label="Avance de la canción">
            <div className="progress__bar">
              <span style={{ width: `${(elapsed / total) * 100}%` }} />
            </div>
            <div className="progress__times">
              <span>{mmss(elapsed)}</span>
              <span>{mmss(total)}</span>
            </div>
          </div>
        )}
        {upNext && (
          <p className="now__next">
            Después: <strong>{upNext.title}</strong> · {upNext.artist}
          </p>
        )}
      </div>
    </div>
  )
}

function IntroCard({ nowPlaying }) {
  const { song } = nowPlaying
  if (!song) return null
  return (
    <div className="intro">
      <img className="intro__art" src={thumbnail(song.youtubeId)} alt="" />
      <div className="intro__text">
        <p className="eyebrow">A continuación · {SOURCE_LABELS[nowPlaying.source] ?? ''}</p>
        <h1 className="now__title">{song.title}</h1>
        <p className="now__artist">{song.artist}</p>
      </div>
    </div>
  )
}

function AnnouncementCard({ nowPlaying }) {
  return (
    <div className="announcement">
      <div className="announcement__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
        </svg>
      </div>
      <p className="eyebrow">Aviso del campus</p>
      <h1 className="announcement__title">{nowPlaying.announcement?.title}</h1>
      <p className="announcement__text">{nowPlaying.announcement?.text}</p>
    </div>
  )
}

function TimerRing({ total, left }) {
  const r = 44
  const c = 2 * Math.PI * r
  const fraction = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0
  return (
    <div className="timer" role="timer" aria-label={`Quedan ${mmss(left)}`}>
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} className="timer__track" />
        <circle cx="50" cy="50" r={r} className="timer__fill" strokeDasharray={c} strokeDashoffset={c * (1 - fraction)} />
      </svg>
      <span>{mmss(left)}</span>
    </div>
  )
}

function RoundPanel({ round, now, paused }) {
  if (!round) {
    return (
      <div className="round round--idle">
        <p className="eyebrow">Votación</p>
        <h2>La próxima ronda empieza con la siguiente canción</h2>
      </div>
    )
  }
  const open = round.status === 'open'
  const total = (round.closesAt - round.openedAt) / 1000
  const left = remainingSeconds(round.closesAt, now)
  const counts = round.counts

  return (
    <div className="round">
      <div className="round__head">
        <div>
          <p className="eyebrow">{open ? 'Elige la siguiente canción' : 'Resultados de la ronda'}</p>
          <h2>{open ? (paused ? 'Votación en pausa' : '¿Cuál suena después?') : resultHeadline(round)}</h2>
        </div>
        {open ? <TimerRing total={total} left={left} /> : null}
      </div>
      <ol className="options">
        {round.options.map((song, i) => {
          const isWinner = !open && round.winner === i
          const share = counts ? percent(counts[i], round.totalVotes) : null
          return (
            <li key={song.id} className={`option ${isWinner ? 'option--winner' : ''} ${!open && !isWinner ? 'option--lost' : ''}`}>
              <span className="option__letter">{i === 0 ? 'A' : 'B'}</span>
              <img className="option__art" src={thumbnail(song.youtubeId, 'mqdefault')} alt="" />
              <div className="option__text">
                <strong>{song.title}</strong>
                <span>{song.artist}</span>
                {share !== null && (
                  <div className={`result result--${i === 0 ? 'a' : 'b'}`}>
                    <div className="result__bar">
                      <span style={{ width: `${share}%` }} />
                    </div>
                    <span className="result__value">
                      {share}% · {counts[i]} {counts[i] === 1 ? 'voto' : 'votos'}
                    </span>
                  </div>
                )}
              </div>
              {isWinner && <span className="option__badge">Ganadora</span>}
            </li>
          )
        })}
      </ol>
      <p className="round__foot">
        {round.totalVotes} {round.totalVotes === 1 ? 'voto' : 'votos'}
        {!open && round.winnerSong && round.winner === null && <> · Sonará {round.winnerSong.title} (selección de respaldo)</>}
      </p>
    </div>
  )
}

function resultHeadline(round) {
  if (round.resolution === 'sin-votos') return 'Nadie votó: decide la programación'
  if (round.resolution === 'empate') return '¡Empate! Se resolvió por regla'
  return '¡Tenemos ganadora!'
}

function Ticker({ state }) {
  const items = useMemo(() => {
    const list = [
      ...state.notices.map((n) => ({ key: `n-${n.id}`, label: n.title, text: n.text })),
      ...state.upcomingEvents.map((e) => ({ key: `e-${e.name}`, label: formatDateRange(e.startDate, e.endDate), text: e.name })),
      ...state.ticker.map((t, i) => ({ key: `t-${i}`, label: 'Campus', text: t })),
    ]
    return list.length ? list : [{ key: 'x', label: 'Radio', text: 'Escanea el código QR y vota por la siguiente canción.' }]
  }, [state.notices, state.upcomingEvents, state.ticker])
  const duration = Math.max(30, items.reduce((n, i) => n + i.text.length + i.label.length, 0) / 6)
  return (
    <footer className="ticker">
      <div className="ticker__track" style={{ animationDuration: `${duration}s` }}>
        {[0, 1].map((copy) => (
          <div className="ticker__group" key={copy} aria-hidden={copy === 1}>
            {items.map((item) => (
              <span className="ticker__item" key={item.key}>
                <b>{item.label}</b> {item.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </footer>
  )
}
