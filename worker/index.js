// Entrada en Cloudflare. /api/* va al Durable Object "Radio"; lo demás son los archivos estáticos.
//
// Hay una sola instancia del Durable Object ("campus"): ahí viven la base de datos SQLite,
// las conexiones WebSocket y la alarma que cierra rondas y avanza la programación.
import { DurableObject } from 'cloudflare:workers'
import { RadioEngine } from '../server/engine.js'
import { handleApi } from '../server/api.js'
import { durableSql } from '../server/db.js'
import { fetchTemperature, lookupYouTube, searchPlaces, suggestSongTags, synthesizeSpeech } from '../server/services.js'
import { parseCookies, verifySession } from '../server/auth.js'

const ROLES = new Set(['screen', 'vote', 'admin'])

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      const stub = env.RADIO.get(env.RADIO.idFromName('campus'))
      return stub.fetch(request)
    }
    return env.ASSETS.fetch(request)
  },
}

export class Radio extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.engine = new RadioEngine({
      db: durableSql(ctx.storage.sql),
      sessionSecret: env.SESSION_SECRET || null,
      services: {
        temperature: (campus) => fetchTemperature(campus),
        youtube: (input) => lookupYouTube(input),
        places: (query) => searchPlaces(query),
        speak: (text, { voice }) => synthesizeSpeech(text, { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_TTS_MODEL, voice }),
        suggest: (input, vocabulary) => suggestSongTags(input, { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, vocabulary }),
        ttsConfigured: Boolean(env.GEMINI_API_KEY),
      },
    })
    // Los clientes mandan "ping" para mantener viva la conexión; se contesta sin despertar al objeto.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'))
    ctx.blockConcurrencyWhile(async () => {
      this.engine.init()
      await this.scheduleAlarm()
    })
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/api/ws') return this.connect(request, url)

    const changed = await this.engine.tick()
    const response = await handleApi(request, {
      engine: this.engine,
      adminPassword: this.env.ADMIN_PASSWORD,
      ip: request.headers.get('CF-Connecting-IP'),
    })
    if (request.method === 'POST' && url.pathname === '/api/vote') this.broadcastSoon()
    else if (request.method !== 'GET' || changed) this.broadcast()
    await this.scheduleAlarm()
    return response
  }

  async alarm() {
    this.alarmAt = undefined // la alarma ya se disparó: la siguiente siempre se programa
    await this.engine.tick()
    this.broadcast()
    await this.scheduleAlarm()
  }

  /** Cada setAlarm() cuenta como una escritura en SQLite: solo se llama cuando la hora cambia. */
  async scheduleAlarm() {
    this.prefetchSpeech()
    const at = this.engine.nextWakeAt()
    if (at === this.alarmAt) return
    this.alarmAt = at
    if (at === null) await this.ctx.storage.deleteAlarm()
    else await this.ctx.storage.setAlarm(Math.max(at, Date.now() + 50))
  }

  /**
   * Genera en segundo plano la presentación de la próxima canción, para que esté lista cuando toque.
   * Si falla (sin cuota, sin red), no reintenta esa frase durante 10 minutos: la pantalla usa la voz del navegador.
   */
  prefetchSpeech() {
    this.speechInFlight ??= new Map()
    const now = Date.now()
    for (const { text, voice } of this.engine.pendingSpeech()) {
      const key = `${voice}|${text}`
      if (this.speechInFlight.has(key) && now - this.speechInFlight.get(key) < 10 * 60_000) continue
      this.speechInFlight.set(key, now)
      this.ctx.waitUntil(
        this.engine
          .generateSpeech(text, voice)
          .then(() => this.speechInFlight.delete(key))
          .catch((error) => console.warn('No se pudo generar la presentación:', error.message)),
      )
    }
    // Un anuncio a la vez, para no gastar la cuota de golpe.
    const id = this.engine.announcementsMissingAudio().find((a) => !(now - (this.speechInFlight.get(`anuncio:${a}`) ?? 0) < 10 * 60_000))
    if (id) {
      this.speechInFlight.set(`anuncio:${id}`, now)
      this.ctx.waitUntil(
        this.engine
          .generateAudio(id)
          .then(() => this.speechInFlight.delete(`anuncio:${id}`))
          .catch((error) => console.warn('No se pudo generar el audio del anuncio:', error.message)),
      )
    }
  }

  // --- WebSockets ---------------------------------------------------------------------------

  async connect(request, url) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Se esperaba una conexión WebSocket.', { status: 426 })
    const role = ROLES.has(url.searchParams.get('role')) ? url.searchParams.get('role') : 'vote'
    if (role === 'admin') {
      const token = parseCookies(request.headers.get('Cookie')).rc_admin
      if (!(await verifySession(this.engine.secret, token, Date.now()))) return new Response('No autorizado.', { status: 401 })
    }
    await this.engine.tick()
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server, [role])
    // Cualquier /pantalla puede tomar el audio; solo una lo reproduce a la vez.
    const canPlay = role === 'screen'
    server.serializeAttachment({ role, player: false, canPlay })
    if (role === 'screen') safeSend(server, { type: 'player', active: false, canPlay })
    server.send(JSON.stringify(this.stateMessage(role)))
    await this.scheduleAlarm()
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws, raw) {
    let message
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
    } catch {
      return
    }
    const attachment = ws.deserializeAttachment() ?? {}

    if (message.type === 'sync') {
      ws.send(JSON.stringify(this.stateMessage(attachment.role)))
      return
    }

    if (message.type === 'claim-player' && attachment.role === 'screen' && !attachment.canPlay) {
      safeSend(ws, { type: 'player', active: false, canPlay: false, denied: true })
      return
    }

    if (message.type === 'claim-player' && attachment.role === 'screen') {
      // Solo una pantalla reproduce audio. La que lo pide al último se queda con él.
      for (const other of this.ctx.getWebSockets('screen')) {
        if (other === ws) continue
        const a = other.deserializeAttachment() ?? {}
        if (a.player) {
          other.serializeAttachment({ ...a, player: false })
          safeSend(other, { type: 'player', active: false, canPlay: a.canPlay })
        }
      }
      ws.serializeAttachment({ ...attachment, player: true })
      safeSend(ws, { type: 'player', active: true, canPlay: true })
      this.engine.setPlayerConnected(true)
      await this.engine.tick()
      this.broadcast()
      await this.scheduleAlarm()
      return
    }

    if (message.type === 'release-player' && attachment.player) {
      ws.serializeAttachment({ ...attachment, player: false })
      this.playerGone(ws)
      return
    }

    if (message.type === 'player' && attachment.player && message.event) {
      await this.engine.refreshWeather()
      const changed = this.engine.playerEvent(message.event)
      this.engine.step()
      if (changed && message.event.type !== 'heartbeat') this.broadcast()
      await this.scheduleAlarm()
    }
  }

  async webSocketClose(ws) {
    if ((ws.deserializeAttachment() ?? {}).player) this.playerGone(ws)
  }

  async webSocketError(ws) {
    if ((ws.deserializeAttachment() ?? {}).player) this.playerGone(ws)
  }

  playerGone(closing) {
    const stillPlaying = this.ctx.getWebSockets('screen').some((s) => s !== closing && (s.deserializeAttachment() ?? {}).player)
    if (stillPlaying) return
    this.engine.setPlayerConnected(false)
    this.broadcast()
    this.scheduleAlarm()
  }

  stateMessage(role) {
    return { type: 'state', state: role === 'admin' ? this.engine.adminState() : this.engine.publicState() }
  }

  broadcast() {
    clearTimeout(this.pending)
    this.pending = null
    const sockets = this.ctx.getWebSockets()
    if (!sockets.length) return
    const publicMessage = JSON.stringify(this.stateMessage('screen'))
    let adminMessage = null
    for (const ws of sockets) {
      const { role } = ws.deserializeAttachment() ?? {}
      if (role === 'admin') safeSendRaw(ws, (adminMessage ??= JSON.stringify(this.stateMessage('admin'))))
      else safeSendRaw(ws, publicMessage)
    }
  }

  /** Con muchos votos seguidos, agrupa las actualizaciones en una sola cada 400 ms. */
  broadcastSoon() {
    if (this.pending) return
    this.pending = setTimeout(() => this.broadcast(), 400)
  }
}

function safeSendRaw(ws, text) {
  try {
    ws.send(text)
  } catch {
    // La conexión se cerró mientras tanto; el cliente se reconecta solo.
  }
}

const safeSend = (ws, data) => safeSendRaw(ws, JSON.stringify(data))
