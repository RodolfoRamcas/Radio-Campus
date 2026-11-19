// Página móvil de votación (se abre desde el QR, sin instalar nada).
import { useEffect, useState } from 'react'
import { useRadio, useServerNow } from '../client/useRadio.js'
import { api } from '../client/api.js'
import { mmss, percent, remainingSeconds, thumbnail } from '../client/format.js'
import { ConnectionBadge } from '../components/ConnectionBadge.jsx'
import '../styles/vote.css'

const storageKey = (roundId) => `radio-campus:voto:${roundId}`

function readStoredVote(roundId) {
  try {
    const value = localStorage.getItem(storageKey(roundId))
    return value === null ? null : Number(value)
  } catch {
    return null
  }
}

function storeVote(roundId, choice) {
  try {
    localStorage.setItem(storageKey(roundId), String(choice))
  } catch {
    // modo privado: el servidor igual recuerda el voto por la cookie
  }
}

export function Vote() {
  const { state, connection, offset } = useRadio('vote')
  const now = useServerNow(offset, 500)
  const round = state?.round
  const [myVote, setMyVote] = useState(null)
  const [sending, setSending] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    document.title = 'Vota la siguiente canción'
  }, [])

  // Al cambiar de ronda, recupera el voto (del navegador y, por si acaso, del servidor).
  useEffect(() => {
    setError(null)
    if (!round) return setMyVote(null)
    setMyVote(readStoredVote(round.id))
    let cancelled = false
    api(`/vote?round=${round.id}`)
      .then(({ choice }) => {
        if (cancelled || choice === null) return
        storeVote(round.id, choice)
        setMyVote(choice)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [round?.id])

  async function vote(choice) {
    setSending(choice)
    setError(null)
    try {
      await api('/vote', { method: 'POST', body: { roundId: round.id, choice } })
      storeVote(round.id, choice)
      setMyVote(choice)
      navigator.vibrate?.(40)
    } catch (e) {
      if (e.data?.choice !== undefined) {
        storeVote(round.id, e.data.choice)
        setMyVote(e.data.choice)
      } else {
        setError(e.message)
      }
    } finally {
      setSending(null)
    }
  }

  if (!state) {
    return (
      <div className="vote">
        <p className="vote__loading">Conectando…</p>
      </div>
    )
  }

  const open = round?.status === 'open' && !state.paused && now < round.closesAt
  const song = state.nowPlaying?.kind === 'song' ? state.nowPlaying.song : null

  return (
    <div className="vote">
      <header className="vote__head">
        <span className="vote__station">{state.station}</span>
        <ConnectionBadge connection={connection} />
      </header>

      <section className="vote__now">
        <span className="eyebrow">Ahora suena</span>
        {song ? (
          <p>
            <strong>{song.title}</strong> · {song.artist}
          </p>
        ) : state.nowPlaying?.kind === 'intro' && state.nowPlaying.song ? (
          <p>
            A continuación: <strong>{state.nowPlaying.song.title}</strong> · {state.nowPlaying.song.artist}
          </p>
        ) : state.nowPlaying?.kind === 'announcement' ? (
          <p>Aviso del campus: {state.nowPlaying.announcement?.title}</p>
        ) : (
          <p>—</p>
        )}
      </section>

      {!round && <p className="vote__notice">No hay votación en este momento. La siguiente empieza con la próxima canción.</p>}

      {round && (
        <section className="vote__round">
          <div className="vote__title">
            <h1>{open ? '¿Qué suena después?' : round.status === 'open' ? 'Votación en pausa' : 'Resultados'}</h1>
            {open && <span className="vote__timer">{mmss(remainingSeconds(round.closesAt, now))}</span>}
          </div>

          {myVote !== null && open && (
            <p className="vote__ok" role="status">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              ¡Voto registrado! Elegiste <strong>{round.options[myVote]?.title}</strong>.
            </p>
          )}

          <div className="vote__options">
            {round.options.map((option, i) => {
              const chosen = myVote === i
              const share = round.counts ? percent(round.counts[i], round.totalVotes) : null
              const winner = round.status === 'closed' && round.winner === i
              return (
                <button
                  key={option.id}
                  className={`vote-option ${chosen ? 'vote-option--chosen' : ''} ${winner ? 'vote-option--winner' : ''}`}
                  onClick={() => vote(i)}
                  disabled={!open || myVote !== null || sending !== null}
                  aria-pressed={chosen}
                >
                  <img src={thumbnail(option.youtubeId, 'mqdefault')} alt="" />
                  <span className="vote-option__text">
                    <strong>{option.title}</strong>
                    <span>{option.artist}</span>
                    {share !== null && (
                      <span className={`result result--${i === 0 ? 'a' : 'b'}`}>
                        <span className="result__bar">
                          <span style={{ width: `${share}%` }} />
                        </span>
                        <span className="result__value">{share}%</span>
                      </span>
                    )}
                  </span>
                  <span className="vote-option__tag">
                    {sending === i ? 'Enviando…' : winner ? 'Ganadora' : chosen ? 'Tu voto' : open && myVote === null ? 'Votar' : ''}
                  </span>
                </button>
              )
            })}
          </div>

          {error && (
            <p className="vote__error" role="alert">
              {error}
            </p>
          )}
          <p className="vote__count">
            {round.totalVotes} {round.totalVotes === 1 ? 'persona ha votado' : 'personas han votado'}
          </p>
          {round.status === 'closed' && <p className="vote__notice">La siguiente ronda empieza con la próxima canción. Esta página se actualiza sola.</p>}
        </section>
      )}
    </div>
  )
}
