// Reproductores de la pantalla que tiene el audio. Avisan al servidor cuándo empieza,
// termina o falla cada elemento; el servidor decide qué sigue.
import { useEffect, useRef, useState } from 'react'
import { loadYouTubeApi, YT_ERRORS } from '../client/youtube.js'
import { speak } from '../client/speech.js'

const report = (send, event) => send({ type: 'player', event })

export function SongPlayer({ nowPlaying, paused, offset, send, onProblem }) {
  const host = useRef(null)
  const player = useRef(null)
  const loadedPlayId = useRef(null)
  const latest = useRef({ nowPlaying, paused })
  latest.current = { nowPlaying, paused }
  const [ready, setReady] = useState(false)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    let destroyed = false
    loadYouTubeApi()
      .then((YT) => {
        if (destroyed) return
        player.current = new YT.Player(host.current, {
          width: '100%',
          height: '100%',
          playerVars: { autoplay: 1, controls: 0, disablekb: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, origin: location.origin },
          events: {
            onReady: () => setReady(true),
            onAutoplayBlocked: () => setBlocked(true),
            onStateChange: (e) => {
              const playId = loadedPlayId.current
              if (!playId || latest.current.nowPlaying?.playId !== playId) return
              const p = player.current
              if (e.data === YT.PlayerState.PLAYING) {
                setBlocked(false)
                onProblem(null)
                report(send, { type: 'playing', playId, duration: p.getDuration(), currentTime: p.getCurrentTime() })
              } else if (e.data === YT.PlayerState.ENDED) {
                report(send, { type: 'ended', playId })
              }
            },
            onError: (e) => {
              const playId = loadedPlayId.current
              const message = YT_ERRORS[e.data] ?? `YouTube devolvió el error ${e.data}.`
              onProblem(message)
              if (playId) report(send, { type: 'error', playId, message })
            },
          },
        })
      })
      .catch((error) => onProblem(error.message))
    return () => {
      destroyed = true
      player.current?.destroy?.()
      player.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cambio de canción: se carga en el punto exacto donde va la transmisión.
  useEffect(() => {
    const p = player.current
    if (!ready || !p) return
    if (nowPlaying?.kind !== 'song') {
      if (loadedPlayId.current) p.stopVideo()
      loadedPlayId.current = null
      return
    }
    if (loadedPlayId.current === nowPlaying.playId) return
    loadedPlayId.current = nowPlaying.playId
    const elapsed = nowPlaying.duration - (nowPlaying.endsAt - (Date.now() + offset)) / 1000
    p.loadVideoById({ videoId: nowPlaying.song.youtubeId, startSeconds: elapsed > 3 ? elapsed : 0 })
    if (latest.current.paused) p.pauseVideo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, nowPlaying?.playId])

  useEffect(() => {
    const p = player.current
    if (!ready || !p || nowPlaying?.kind !== 'song') return
    if (paused) p.pauseVideo()
    else p.playVideo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, ready])

  // Latido: le dice al servidor que este reproductor sigue vivo.
  useEffect(() => {
    const id = setInterval(() => {
      const playId = latest.current.nowPlaying?.playId ?? null
      report(send, { type: 'heartbeat', playId, currentTime: player.current?.getCurrentTime?.() ?? null })
    }, 15_000)
    return () => clearInterval(id)
  }, [send])

  return (
    <div className="yt">
      <div ref={host} />
      {blocked && (
        <button className="yt__unblock" onClick={() => player.current?.playVideo()}>
          El navegador bloqueó el audio. Toca aquí para reproducir.
        </button>
      )}
    </div>
  )
}

/** Dos tonos cortos antes de cada anuncio, como en la radio. */
function chime() {
  return new Promise((resolve) => {
    try {
      const ctx = new AudioContext()
      const gain = ctx.createGain()
      gain.connect(ctx.destination)
      ;[880, 660].forEach((freq, i) => {
        const osc = ctx.createOscillator()
        osc.frequency.value = freq
        osc.connect(gain)
        const t = ctx.currentTime + i * 0.28
        gain.gain.setValueAtTime(0.0001, t)
        gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.26)
        osc.start(t)
        osc.stop(t + 0.27)
      })
      setTimeout(() => {
        ctx.close()
        resolve()
      }, 700)
    } catch {
      resolve()
    }
  })
}

/** Locución: anuncios del campus y presentaciones de canciones. */
export function AnnouncementPlayer({ nowPlaying, paused, send, onProblem }) {
  useEffect(() => {
    const isAnnouncement = nowPlaying?.kind === 'announcement'
    if ((!isAnnouncement && nowPlaying?.kind !== 'intro') || paused) return
    const text = isAnnouncement ? nowPlaying.announcement?.text : nowPlaying.text
    if (!text) return
    const { playId, audioUrl } = nowPlaying
    let stopped = false
    let stop = () => {}

    const done = () => !stopped && report(send, { type: 'ended', playId })
    const browserVoice = () => {
      stop = speak(text, {
        onStart: () => report(send, { type: 'playing', playId }),
        onEnd: done,
        onError: (e) => {
          onProblem(`No se pudo leer el anuncio: ${e.message}`)
          if (!stopped) report(send, { type: 'error', playId, message: 'La síntesis de voz del navegador falló.' })
        },
      })
    }

    // La campanita distingue los avisos; las presentaciones entran directo, como en la radio.
    ;(isAnnouncement ? chime() : Promise.resolve()).then(() => {
      if (stopped) return
      if (!audioUrl) return browserVoice()
      const audio = new Audio(audioUrl)
      audio.onloadedmetadata = () => report(send, { type: 'playing', playId, duration: audio.duration, currentTime: 0 })
      audio.onended = done
      audio.onerror = () => !stopped && browserVoice()
      audio.play().catch(() => !stopped && browserVoice())
      stop = () => {
        audio.onended = audio.onerror = null
        audio.pause()
      }
    })
    return () => {
      stopped = true
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowPlaying?.playId, paused])

  return null
}
