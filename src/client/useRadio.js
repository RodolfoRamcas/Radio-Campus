// Conexión en tiempo real con el servidor (WebSocket), con reconexión automática.
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * @param {'screen'|'vote'|'admin'} role
 * @returns {{ state, connection: 'conectando'|'conectado'|'reconectando'|'sin-red', isPlayer, canPlay, send, offset }}
 */
export function useRadio(role, { enabled = true, query = '' } = {}) {
  const [state, setState] = useState(null)
  const [connection, setConnection] = useState('conectando')
  const [isPlayer, setIsPlayer] = useState(false)
  const [playerAccess, setPlayerAccess] = useState({ canPlay: false, denied: false, accessKnown: false })
  const [offset, setOffset] = useState(0)
  const socket = useRef(null)
  const reconnectNow = useRef(() => {})

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let attempt = 0
    let retryTimer
    let pingTimer

    const receive = (s) => {
      setOffset(s.serverNow - Date.now())
      setState(s)
    }

    // Primer pintado rápido por HTTP mientras abre el WebSocket.
    if (role !== 'admin') {
      fetch('/api/state')
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => s && !stopped && receive(s))
        .catch(() => {})
    }

    const connect = () => {
      clearTimeout(retryTimer)
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${protocol}://${location.host}/api/ws?role=${role}${query}`)
      socket.current = ws
      setPlayerAccess({ canPlay: false, denied: false, accessKnown: false })
      ws.onopen = () => {
        attempt = 0
        setConnection('conectado')
        clearInterval(pingTimer)
        pingTimer = setInterval(() => ws.readyState === 1 && ws.send('{"type":"ping"}'), 25_000)
      }
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data)
        if (message.type === 'state') receive(message.state)
        else if (message.type === 'player') {
          setIsPlayer(message.active)
          setPlayerAccess({ canPlay: Boolean(message.canPlay), denied: Boolean(message.denied), accessKnown: true })
        }
      }
      ws.onclose = () => {
        clearInterval(pingTimer)
        if (socket.current === ws) socket.current = null
        setIsPlayer(false)
        if (stopped) return
        setConnection(navigator.onLine === false ? 'sin-red' : 'reconectando')
        retryTimer = setTimeout(connect, Math.min(15_000, 800 * 2 ** attempt++))
      }
    }
    reconnectNow.current = () => {
      if (socket.current?.readyState === 1) socket.current.send('{"type":"sync"}')
      else {
        attempt = 0
        connect()
      }
    }

    const onOnline = () => reconnectNow.current()
    const onOffline = () => setConnection('sin-red')
    const onVisible = () => document.visibilityState === 'visible' && reconnectNow.current()
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)
    connect()

    return () => {
      stopped = true
      clearTimeout(retryTimer)
      clearInterval(pingTimer)
      socket.current?.close()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [role, enabled, query])

  const send = useCallback((message) => {
    const ws = socket.current
    if (ws?.readyState !== 1) return false
    ws.send(JSON.stringify(message))
    return true
  }, [])

  return { state, setState, connection, isPlayer, ...playerAccess, send, offset }
}

/** Hora del servidor, actualizada varias veces por segundo para los temporizadores. */
export function useServerNow(offset, interval = 250) {
  const [now, setNow] = useState(() => Date.now() + offset)
  useEffect(() => {
    setNow(Date.now() + offset)
    const id = setInterval(() => setNow(Date.now() + offset), interval)
    return () => clearInterval(id)
  }, [offset, interval])
  return now
}
