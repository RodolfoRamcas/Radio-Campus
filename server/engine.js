// Motor de la radio: fuente única de verdad para la programación, las rondas y los votos.
//
// Las transiciones de estado son síncronas a propósito: así dos peticiones simultáneas nunca
// avanzan la programación dos veces. Lo asíncrono (clima, voz) se hace aparte y solo actualiza caché.
import { buildContext, contextAt, ruleStatus } from '../src/shared/context.js'
import { selectSongs, contextScores } from '../src/shared/selection.js'
import { resolveRound, roundClosesAt } from '../src/shared/rounds.js'
import { announcementStatus, estimateSpeechMs, pickAnnouncement } from '../src/shared/announcements.js'
import { withDefaults } from '../src/shared/defaults.js'
import { zonedParts } from '../src/shared/time.js'
import { ENTITIES, deleteEntity, getEntity, listEntities, migrate, readKv, saveEntity, writeKv } from './db.js'
import { SEED_EVENTS, SEED_PLAYLISTS, SEED_RULES, seedAnnouncements, seedSongs } from './seed.js'
import {
  HttpError,
  normalizeAnnouncement,
  normalizeConfig,
  normalizeEvent,
  normalizePlaylist,
  normalizeRule,
  normalizeSong,
} from './validate.js'
import { randomId } from './auth.js'

const GRACE_MS = 12_000 // margen para que el reproductor avise el final antes de avanzar por reloj
const PLAYER_TIMEOUT_MS = 45_000
const WEATHER_TTL_MS = 15 * 60_000
const WEATHER_STALE_MS = 60 * 60_000 // una lectura vieja sigue sirviendo hasta una hora
const MAX_CONSECUTIVE_ERRORS = 4
const MIN_ROUND_MS = 25_000

const INITIAL_STATE = {
  paused: false,
  pausedAt: null,
  pauseReason: null,
  now: null,
  round: null,
  queue: [],
  songsSinceAnnouncement: 0,
  consecutiveErrors: 0,
  player: { connected: false, lastSeen: 0, status: 'desconectado', message: null },
  lastError: null,
}

/** Hash corto (FNV-1a) para saber si el audio guardado corresponde al texto actual. */
// Sube la versión cuando cambie cómo se pide la voz: el audio en caché se regenera.
const SPEECH_VERSION = 2
const speechHash = (voice, text) => textHash(`v${SPEECH_VERSION}|${voice}|${text}`)

function textHash(value) {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export class RadioEngine {
  /**
   * @param {object} options
   * @param {object} options.db  interfaz all/get/run (server/db.js)
   * @param {object} options.services  { temperature(campus), speak(text, { voice }), youtube(url) }
   */
  constructor({ db, clock = Date.now, rng = Math.random, services = {}, sessionSecret = null }) {
    this.db = db
    this.clock = clock
    this.rng = rng
    this.services = services
    this.sessionSecret = sessionSecret
    this.loginAttempts = new Map()
  }

  init() {
    migrate(this.db)
    if (!readKv(this.db, 'seeded')) this.loadDemoData()
    this.config = withDefaults(readKv(this.db, 'config', {}))
    this.state = { ...INITIAL_STATE, ...readKv(this.db, 'state', {}) }
    this.weather = readKv(this.db, 'weather', { temperature: null, readAt: 0, checkedAt: 0, error: null })
    this.secret = this.sessionSecret || readKv(this.db, 'secret')
    if (!this.secret) {
      this.secret = randomId(32)
      writeKv(this.db, 'secret', this.secret)
    }
    this.playerToken = readKv(this.db, 'playerToken') ?? this.rotatePlayerToken()
  }

  /** Token del enlace de la pantalla reproductora. Sin él, /pantalla solo muestra. */
  rotatePlayerToken() {
    this.playerToken = randomId(18)
    writeKv(this.db, 'playerToken', this.playerToken)
    return this.playerToken
  }

  isPlayerToken(token) {
    return typeof token === 'string' && token.length > 0 && token === this.playerToken
  }

  save() {
    writeKv(this.db, 'state', this.state)
  }

  audit(action, detail = '') {
    this.db.run('INSERT INTO audit (at, action, detail) VALUES (?, ?, ?)', this.clock(), action, String(detail).slice(0, 300))
  }

  // --- Datos -----------------------------------------------------------------------------

  list(name) {
    return listEntities(this.db, name)
  }

  getSong(id) {
    return getEntity(this.db, 'songs', id)
  }

  playlistsById() {
    return Object.fromEntries(this.list('playlists').map((p) => [p.id, p]))
  }

  recentPlays() {
    return this.db.all(
      "SELECT ref_id AS songId, started_at AS startedAt FROM plays WHERE kind = 'song' ORDER BY started_at DESC, id DESC LIMIT 200",
    )
  }

  /** Veces que sonó cada canción. Lee play_stats (una fila por canción), no el historial completo. */
  playCounts() {
    return Object.fromEntries(this.db.all("SELECT ref_id, plays FROM play_stats WHERE kind = 'song'").map((r) => [r.ref_id, r.plays]))
  }

  // --- Contexto ----------------------------------------------------------------------------

  /** Temperatura vigente, o null si la fuente no responde desde hace más de una hora. */
  temperature() {
    const { temperature, readAt } = this.weather
    return temperature !== null && this.clock() - readAt < WEATHER_STALE_MS ? temperature : null
  }

  async refreshWeather({ force = false } = {}) {
    const now = this.clock()
    const { latitude, longitude } = this.config.campus
    // La caché es de un lugar: si la ubicación cambió, la lectura anterior ya no sirve.
    const samePlace = this.weather.latitude === latitude && this.weather.longitude === longitude
    if (!samePlace) this.weather = { temperature: null, readAt: 0, checkedAt: 0, error: null }
    if (!force && now - this.weather.checkedAt < WEATHER_TTL_MS) return
    if (!this.services.temperature) return
    this.weather = { ...this.weather, checkedAt: now }
    try {
      const temperature = await this.services.temperature(this.config.campus)
      this.weather = { temperature, readAt: this.clock(), checkedAt: now, error: null, latitude, longitude }
    } catch (error) {
      this.weather = { ...this.weather, latitude, longitude, error: error.message || 'No se pudo consultar el clima.' }
    }
    writeKv(this.db, 'weather', this.weather)
  }

  context() {
    return buildContext({
      now: this.clock(),
      timezone: this.config.campus.timezone,
      temperature: this.temperature(),
      events: this.list('events'),
    })
  }

  select(count, { forceBackup = false } = {}) {
    const exclude = [
      this.state.now?.kind === 'song' ? this.state.now.songId : null,
      ...this.state.queue.filter((q) => q.kind === 'song').map((q) => q.songId),
    ].filter(Boolean)
    return selectSongs({
      songs: this.list('songs'),
      rules: this.list('rules'),
      playlists: this.playlistsById(),
      context: this.context(),
      config: this.config,
      recentPlays: this.recentPlays(),
      exclude,
      count,
      playCounts: this.playCounts(),
      rng: this.rng,
      forceBackup,
    })
  }

  // --- Programación ------------------------------------------------------------------------

  playerActive() {
    const p = this.state.player
    return p.connected && this.clock() - p.lastSeen < PLAYER_TIMEOUT_MS
  }

  /** Momento en que el servidor avanza por su cuenta si el reproductor no avisa. */
  dueAt(current) {
    if (!this.playerActive()) return current.endsAt
    return current.endsAt + (current.kind === 'song' ? GRACE_MS : 5000)
  }

  nextWakeAt() {
    if (this.state.paused) return null
    const times = []
    if (this.state.round?.status === 'open') times.push(this.state.round.closesAt)
    if (this.state.now) times.push(this.dueAt(this.state.now))
    else times.push(this.clock() + 60_000)
    return Math.min(...times)
  }

  async tick() {
    await this.refreshWeather()
    return this.step()
  }

  /** Procesa todo lo que ya venció. Devuelve true si algo cambió. */
  step() {
    if (this.state.paused) return false
    let changed = false
    for (let guard = 0; guard < 12; guard++) {
      const now = this.clock()
      const { round, now: current } = this.state
      if (round?.status === 'open' && now >= round.closesAt) {
        this.closeRound()
      } else if (!current || now >= this.dueAt(current)) {
        const hadCurrent = Boolean(current)
        this.advance(current?.kind === 'song' && !current.confirmed && this.playerActive() ? 'sin-confirmar' : 'completa')
        if (!hadCurrent && !this.state.now) break // catálogo vacío: no insistir
      } else {
        break
      }
      changed = true
    }
    if (changed) this.save()
    return changed
  }

  insertPlay({ kind, refId, title, source, roundId = null }) {
    const now = this.clock()
    this.db.run(
      `INSERT INTO play_stats (kind, ref_id, plays, last_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(kind, ref_id) DO UPDATE SET plays = plays + 1, last_at = excluded.last_at`,
      kind, refId, now,
    )
    return this.db.get(
      `INSERT INTO plays (kind, ref_id, title, source, round_id, started_at, status)
       VALUES (?, ?, ?, ?, ?, ?, 'reproduciendo') RETURNING id`,
      kind, refId, title, source, roundId, now,
    ).id
  }

  startItem(item) {
    const now = this.clock()
    if (item.kind === 'song') {
      const song = this.getSong(item.songId)
      if (!song || !song.enabled) return false
      // Antes de la canción, la voz IA la presenta. La canción queda pendiente dentro de la presentación.
      if (this.config.songIntros && !item.introDone) return this.startIntro(song, item)
      const playId = this.insertPlay({ kind: 'song', refId: song.id, title: `${song.title} — ${song.artist}`, source: item.source, roundId: item.roundId })
      this.state.now = {
        kind: 'song',
        playId,
        songId: song.id,
        source: item.source,
        startedAt: now,
        duration: song.duration,
        endsAt: now + song.duration * 1000,
        confirmed: false,
      }
      this.state.songsSinceAnnouncement += 1
      this.openRoundIfNeeded()
      return true
    }

    const announcement = getEntity(this.db, 'announcements', item.announcementId)
    if (!announcement) return false
    const status = announcementStatus(announcement, this.context())
    // Los vencidos y los no aprobados nunca suenan, aunque se hayan puesto en cola a mano.
    if (status === 'vencido' || status === 'borrador') return false
    const audio = this.audioInfo(announcement)
    const durationMs = audio ? audio.durationMs : estimateSpeechMs(announcement.text)
    const playId = this.insertPlay({ kind: 'announcement', refId: announcement.id, title: announcement.title, source: item.source })
    this.state.now = {
      kind: 'announcement',
      playId,
      announcementId: announcement.id,
      source: item.source,
      startedAt: now,
      duration: durationMs / 1000,
      endsAt: now + durationMs + 1500,
      hasAudio: Boolean(audio),
      audioVersion: audio?.hash ?? null,
      confirmed: false,
    }
    this.state.songsSinceAnnouncement = 0
    return true
  }

  startIntro(song, item) {
    const now = this.clock()
    const text = this.introText(song, item.source)
    const voice = this.config.voice
    const cached = this.speechInfo(text, voice)
    const durationMs = cached ? cached.durationMs : estimateSpeechMs(text)
    const playId = this.insertPlay({ kind: 'intro', refId: song.id, title: `Presentación: ${song.title}`, source: item.source })
    this.state.now = {
      kind: 'intro',
      playId,
      songId: song.id,
      pendingItem: item,
      text,
      speechHash: cached ? cached.hash : null,
      source: item.source,
      startedAt: now,
      duration: durationMs / 1000,
      endsAt: now + durationMs + 1000,
      confirmed: false,
    }
    return true
  }

  /** Lo que dice la voz antes de cada canción. Pocas variantes: así el audio generado se reutiliza. */
  introText(song, source) {
    const station = this.config.campus.name
    if (source === 'votacion') return `¡Ustedes lo eligieron! En ${station} suena ${song.title}, de ${song.artist}.`
    if (source === 'desempate') return `Hubo empate en la votación, y la ganadora es ${song.title}, de ${song.artist}.`
    return `A continuación en ${station}: ${song.title}, de ${song.artist}.`
  }

  finishCurrent(status, detail = null) {
    const current = this.state.now
    if (!current) return
    this.db.run('UPDATE plays SET ended_at = ?, status = ?, detail = ? WHERE id = ?', this.clock(), status, detail, current.playId)
    // Una reproducción fallida no cuenta como "sonó".
    const refId = current.kind === 'announcement' ? current.announcementId : current.songId
    if (status === 'error') this.db.run('UPDATE play_stats SET plays = MAX(plays - 1, 0) WHERE kind = ? AND ref_id = ?', current.kind, refId)
    this.state.now = null
  }

  nextItem(previous) {
    // Después de la presentación suena la canción que presentó.
    if (previous?.kind === 'intro' && previous.pendingItem) return { ...previous.pendingItem, introDone: true }
    const queue = this.state.queue
    if (queue[0]?.kind === 'announcement') return queue.shift()
    if (previous?.kind === 'song') {
      const lastPlays = new Map(
        this.db
          .all("SELECT ref_id, last_at FROM play_stats WHERE kind = 'announcement' AND plays > 0")
          .map((r) => [r.ref_id, r.last_at]),
      )
      const due = pickAnnouncement(this.list('announcements'), this.context(), {
        lastPlays,
        songsSinceAnnouncement: this.state.songsSinceAnnouncement,
        minSongsBetween: this.config.minSongsBetweenAnnouncements,
        always: this.config.announcementEverySong,
      })
      if (due) return { kind: 'announcement', announcementId: due.id, source: 'programado' }
    }
    const index = queue.findIndex((q) => q.kind === 'song')
    if (index >= 0) return queue.splice(index, 1)[0]
    const { songs, trace } = this.select(1)
    return songs[0] ? { kind: 'song', songId: songs[0].id, source: trace.fallback ? 'respaldo' : 'automatica' } : null
  }

  advance(status = 'completa', detail = null) {
    if (this.state.round?.status === 'open') this.closeRound()
    let previous = this.state.now
    this.finishCurrent(status, detail)
    // La siguiente canción se decide ya: así su presentación se genera mientras suena el anuncio.
    if (previous?.kind === 'song') this.ensureNextSongQueued()
    for (let attempt = 0; attempt < 6; attempt++) {
      const item = this.nextItem(previous)
      if (!item) return
      if (this.startItem(item)) return
      previous = null
    }
  }

  ensureNextSongQueued() {
    if (this.state.queue.some((q) => q.kind === 'song')) return
    const { songs, trace } = this.select(1)
    if (songs[0]) this.state.queue.push({ key: randomId(6), kind: 'song', songId: songs[0].id, source: trace.fallback ? 'respaldo' : 'automatica' })
  }

  openRoundIfNeeded() {
    const current = this.state.now
    const round = this.state.round
    if (!current || current.kind !== 'song' || this.state.paused) return
    if (round?.status === 'open' || round?.playId === current.playId) return
    // Si la administración ya programó la siguiente canción, no tiene sentido votar.
    if (this.state.queue.some((q) => q.kind === 'song')) return
    const now = this.clock()
    if (current.endsAt - now < this.config.resultsSeconds * 1000 + MIN_ROUND_MS) return

    const { songs, trace } = this.select(2)
    if (songs.length < 2) return
    const closesAt = roundClosesAt({
      startedAt: now,
      endsAt: current.endsAt,
      roundSeconds: this.config.roundSeconds,
      resultsSeconds: this.config.resultsSeconds,
    })
    const options = songs.map((s) => s.id)
    const { id } = this.db.get(
      'INSERT INTO rounds (play_id, options, opened_at, closes_at, trace) VALUES (?, ?, ?, ?, ?) RETURNING id',
      current.playId, JSON.stringify(options), now, closesAt, JSON.stringify(trace),
    )
    this.state.round = { id, playId: current.playId, options, openedAt: now, closesAt, status: 'open', trace }
  }

  voteCounts(roundId, size = 2) {
    const counts = Array(size).fill(0)
    for (const row of this.db.all('SELECT choice, COUNT(*) AS n FROM votes WHERE round_id = ? GROUP BY choice', roundId)) {
      if (row.choice < size) counts[row.choice] = row.n
    }
    return counts
  }

  closeRound() {
    const round = this.state.round
    if (!round || round.status !== 'open') return
    const now = this.clock()
    const counts = this.voteCounts(round.id, round.options.length)
    const songs = round.options.map((id) => this.getSong(id))
    const playCounts = this.playCounts()
    const result = resolveRound({
      counts,
      config: this.config,
      scores: contextScores(songs.filter(Boolean), { rules: this.list('rules'), context: this.context(), playlists: this.playlistsById() }),
      playCounts: round.options.map((id) => playCounts[id] ?? 0),
      rng: this.rng,
    })
    let winnerSongId = result.winner !== null ? round.options[result.winner] : null
    if (!winnerSongId) winnerSongId = this.select(1, { forceBackup: true }).songs[0]?.id ?? round.options[0]

    this.db.run(
      'UPDATE rounds SET closed_at = ?, counts = ?, winner_song_id = ?, resolution = ?, strategy = ? WHERE id = ?',
      now, JSON.stringify(counts), winnerSongId, result.resolution, result.strategy, round.id,
    )
    Object.assign(round, {
      status: 'closed',
      closedAt: now,
      counts,
      winner: result.winner,
      winnerSongId,
      resolution: result.resolution,
      strategy: result.strategy,
    })
    const source = { votos: 'votacion', empate: 'desempate', 'sin-votos': 'sin-votos' }[result.resolution]
    this.state.queue.push({ key: randomId(6), kind: 'song', songId: winnerSongId, source, roundId: round.id })
  }

  // --- Votos ------------------------------------------------------------------------------

  vote({ roundId, choice, voter, ipHash }) {
    const round = this.state.round
    if (this.state.paused) throw new HttpError(409, 'La programación está en pausa. Intenta en un momento.')
    if (!round || round.id !== roundId) throw new HttpError(409, 'Esa ronda ya no está activa. Recarga para ver la actual.')
    if (round.status !== 'open' || this.clock() >= round.closesAt) throw new HttpError(409, 'La votación de esta ronda ya cerró.')
    if (!Number.isInteger(choice) || choice < 0 || choice >= round.options.length) throw new HttpError(400, 'Opción no válida.')

    const existing = this.db.get('SELECT choice FROM votes WHERE round_id = ? AND voter = ?', roundId, voter)
    if (existing) throw new HttpError(409, 'Ya votaste en esta ronda.', { choice: existing.choice })
    if (this.config.maxVotesPerIp > 0 && ipHash) {
      const { n } = this.db.get('SELECT COUNT(*) AS n FROM votes WHERE round_id = ? AND ip_hash = ?', roundId, ipHash)
      if (n >= this.config.maxVotesPerIp) throw new HttpError(429, 'Se alcanzó el límite de votos desde esta red para esta ronda.')
    }
    this.db.run('INSERT INTO votes (round_id, voter, choice, ip_hash, created_at) VALUES (?, ?, ?, ?, ?)', roundId, voter, choice, ipHash ?? null, this.clock())
    return { choice, roundId }
  }

  myVote(roundId, voter) {
    return this.db.get('SELECT choice FROM votes WHERE round_id = ? AND voter = ?', roundId, voter)?.choice ?? null
  }

  // --- Reproductor --------------------------------------------------------------------------

  setPlayerConnected(connected) {
    const p = this.state.player
    this.state.player = { ...p, connected, lastSeen: this.clock(), status: connected ? 'esperando' : 'desconectado', message: null }
    this.save()
  }

  /** Eventos que manda la pantalla que reproduce el audio. */
  playerEvent(event) {
    const current = this.state.now
    const now = this.clock()
    const lastSaved = this.state.player.lastSeen
    this.state.player = { ...this.state.player, connected: true, lastSeen: now }
    // Los latidos llegan cada 15 s; guardarlos todos gastaría escrituras sin necesidad.
    const persistBeat = () => now - lastSaved > 60_000 && this.save()
    if (!current || event.playId !== current.playId) {
      persistBeat()
      return false
    }
    if (event.type === 'heartbeat') {
      if (this.state.player.status === 'desconectado') this.state.player.status = 'esperando'
      persistBeat()
      return true
    }

    switch (event.type) {
      case 'playing': {
        const duration = Number(event.duration)
        const position = Math.max(0, Number(event.currentTime) || 0)
        if (Number.isFinite(duration) && duration > 0) {
          current.endsAt = now + Math.max(0, duration - position) * 1000
          current.duration = duration
          if (current.kind === 'song' && Math.abs(duration - (this.getSong(current.songId)?.duration ?? 0)) > 2) {
            // La duración real manda: así los temporizadores quedan exactos la próxima vez.
            this.db.run('UPDATE songs SET duration = ? WHERE id = ?', Math.round(duration), current.songId)
          }
          const round = this.state.round
          if (round?.status === 'open' && round.playId === current.playId) {
            const latest = current.endsAt - this.config.resultsSeconds * 1000
            round.closesAt = Math.max(Math.min(round.closesAt, latest), Math.min(round.openedAt + 15_000, latest))
            this.db.run('UPDATE rounds SET closes_at = ? WHERE id = ?', round.closesAt, round.id)
          }
        }
        if (!current.confirmed && current.kind === 'song') this.db.run('UPDATE songs SET error_count = 0 WHERE id = ?', current.songId)
        current.confirmed = true
        this.state.consecutiveErrors = 0
        this.state.player = { ...this.state.player, status: 'reproduciendo', message: null }
        break
      }
      case 'ended':
        this.advance('completa')
        break
      case 'error': {
        const message = String(event.message ?? 'Error de reproducción').slice(0, 200)
        if (current.kind === 'song') this.db.run('UPDATE songs SET error_count = error_count + 1 WHERE id = ?', current.songId)
        this.state.consecutiveErrors += 1
        this.state.player = { ...this.state.player, status: 'error', message }
        this.state.lastError = { at: now, message }
        this.audit('falla-reproduccion', message)
        if (this.state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          this.finishCurrent('error', message)
          this.pause(`Se pausó sola: ${MAX_CONSECUTIVE_ERRORS} reproducciones seguidas fallaron. Revisa la conexión o el servicio de streaming.`)
        } else {
          this.advance('error', message)
        }
        break
      }
      default:
        return false
    }
    this.save()
    return true
  }

  // --- Intervención manual ----------------------------------------------------------------------

  pause(reason = null) {
    if (this.state.paused) return
    this.state.paused = true
    this.state.pausedAt = this.clock()
    this.state.pauseReason = reason
    this.audit('pausa', reason ?? 'manual')
    this.save()
  }

  resume() {
    if (!this.state.paused) return
    const delta = this.clock() - this.state.pausedAt
    if (this.state.now) this.state.now.endsAt += delta
    if (this.state.round?.status === 'open') {
      this.state.round.closesAt += delta
      this.db.run('UPDATE rounds SET closes_at = ? WHERE id = ?', this.state.round.closesAt, this.state.round.id)
    }
    Object.assign(this.state, { paused: false, pausedAt: null, pauseReason: null, consecutiveErrors: 0 })
    this.openRoundIfNeeded()
    this.audit('reanudar')
    this.step()
    this.save()
  }

  skip() {
    this.audit('saltar', this.state.now?.kind ?? '')
    const paused = this.state.paused
    this.state.paused = false
    this.advance('saltada')
    this.state.paused = paused
    if (paused) this.state.pausedAt = this.clock()
    this.save()
  }

  closeRoundNow() {
    if (this.state.round?.status !== 'open') throw new HttpError(409, 'No hay una ronda abierta.')
    this.closeRound()
    this.audit('cerrar-ronda')
    this.save()
  }

  enqueueSong(songId, position = 'end') {
    const song = this.getSong(songId)
    if (!song) throw new HttpError(404, 'La canción no existe.')
    if (!song.enabled) throw new HttpError(409, 'La canción está desactivada.')
    const item = { key: randomId(6), kind: 'song', songId, source: 'manual' }
    if (position === 'next') this.state.queue.unshift(item)
    else this.state.queue.push(item)
    this.audit('cola-agregar', song.title)
    this.save()
  }

  enqueueAnnouncement(announcementId) {
    const a = getEntity(this.db, 'announcements', announcementId)
    if (!a) throw new HttpError(404, 'El anuncio no existe.')
    const status = announcementStatus(a, this.context())
    if (status === 'vencido') throw new HttpError(409, 'El anuncio está vencido.')
    if (status === 'borrador') throw new HttpError(409, 'Aprueba el anuncio antes de programarlo.')
    this.state.queue.unshift({ key: randomId(6), kind: 'announcement', announcementId, source: 'manual' })
    this.audit('anuncio-ahora', a.title)
    this.save()
  }

  removeFromQueue(key) {
    const before = this.state.queue.length
    this.state.queue = this.state.queue.filter((q) => q.key !== key)
    if (before === this.state.queue.length) throw new HttpError(404, 'Ese elemento ya no está en la cola.')
    this.openRoundIfNeeded()
    this.save()
  }

  moveInQueue(key, direction) {
    const q = this.state.queue
    const i = q.findIndex((item) => item.key === key)
    const j = i + (direction === 'up' ? -1 : 1)
    if (i < 0 || j < 0 || j >= q.length) return
    ;[q[i], q[j]] = [q[j], q[i]]
    this.save()
  }

  // --- Panel: catálogo y configuración ---------------------------------------------------------

  saveItem(name, input) {
    const existing = input.id ? getEntity(this.db, name, input.id) : null
    const now = this.clock()
    let value
    switch (name) {
      case 'songs':
        value = normalizeSong(input, existing)
        if (!existing && getEntity(this.db, 'songs', value.id)) throw new HttpError(409, 'Esa canción ya está en el catálogo.')
        value.createdAt ??= now
        break
      case 'playlists':
        value = normalizePlaylist(input, existing, new Set(this.list('songs').map((s) => s.id)))
        break
      case 'rules':
        value = normalizeRule(input, existing, new Set(this.list('playlists').map((p) => p.id)))
        break
      case 'events':
        value = normalizeEvent(input, existing)
        break
      case 'announcements':
        value = normalizeAnnouncement(input, existing, now)
        break
      default:
        throw new HttpError(404, 'Colección desconocida.')
    }
    value.id ??= `${name.slice(0, 2)}-${randomId(6)}`
    const saved = saveEntity(this.db, name, value)
    this.audit(`${existing ? 'editar' : 'crear'}-${name}`, saved.title ?? saved.name ?? saved.id)
    if (name === 'songs' || name === 'rules' || name === 'events' || name === 'playlists') this.openRoundIfNeeded()
    this.save()
    return saved
  }

  deleteItem(name, id) {
    if (!ENTITIES[name]) throw new HttpError(404, 'Colección desconocida.')
    const existing = getEntity(this.db, name, id)
    if (!existing) throw new HttpError(404, 'No existe.')
    if (name === 'playlists' && this.config.backupPlaylistId === id) {
      throw new HttpError(409, 'Es la lista de respaldo. Elige otra en Configuración antes de borrarla.')
    }
    if (name === 'songs') {
      for (const playlist of this.list('playlists')) {
        if (playlist.songIds.includes(id)) saveEntity(this.db, 'playlists', { ...playlist, songIds: playlist.songIds.filter((s) => s !== id) })
      }
      this.state.queue = this.state.queue.filter((q) => q.songId !== id)
    }
    if (name === 'announcements') {
      this.db.run('DELETE FROM announcement_audio WHERE announcement_id = ?', id)
      this.state.queue = this.state.queue.filter((q) => q.announcementId !== id)
    }
    deleteEntity(this.db, name, id)
    this.audit(`borrar-${name}`, existing.title ?? existing.name ?? id)
    this.save()
  }

  saveConfig(input) {
    const previous = this.config
    this.config = normalizeConfig(input, this.config, new Set(this.list('playlists').map((p) => p.id)))
    writeKv(this.db, 'config', this.config)
    const moved = ['latitude', 'longitude'].some((k) => previous.campus[k] !== this.config.campus[k])
    if (moved) this.weather = { temperature: null, readAt: 0, checkedAt: 0, error: null }
    this.audit('configuracion')
    return this.config
  }

  loadDemoData() {
    const now = this.clock()
    for (const table of ['songs', 'playlists', 'rules', 'events', 'announcements', 'announcement_audio']) this.db.run(`DELETE FROM ${table}`)
    for (const song of seedSongs(now)) saveEntity(this.db, 'songs', song)
    for (const playlist of SEED_PLAYLISTS) saveEntity(this.db, 'playlists', playlist)
    for (const rule of SEED_RULES) saveEntity(this.db, 'rules', rule)
    for (const event of SEED_EVENTS) saveEntity(this.db, 'events', event)
    for (const a of seedAnnouncements(now)) saveEntity(this.db, 'announcements', a)
    writeKv(this.db, 'config', {})
    writeKv(this.db, 'seeded', true)
    this.config = withDefaults({})
    if (this.state) {
      this.state.queue = []
      this.save()
    }
  }

  // --- Respaldo de configuración -------------------------------------------------------------

  exportBackup() {
    return {
      format: 'radio-campus',
      version: 1,
      exportedAt: new Date(this.clock()).toISOString(),
      config: this.config,
      songs: this.list('songs'),
      playlists: this.list('playlists'),
      rules: this.list('rules'),
      events: this.list('events'),
      announcements: this.list('announcements'),
    }
  }

  /** Reemplaza catálogo y configuración. Primero valida todo; si algo falla, no toca nada. */
  importBackup(data) {
    if (data?.format !== 'radio-campus') throw new HttpError(400, 'El archivo no es un respaldo de Radio Campus.')
    const now = this.clock()
    const songs = (data.songs ?? []).map((s) => ({ ...normalizeSong(s, { id: s.id, createdAt: s.createdAt ?? now }), createdAt: s.createdAt ?? now }))
    const songIds = new Set(songs.map((s) => s.id))
    const playlists = (data.playlists ?? []).map((p) => normalizePlaylist(p, { id: p.id }, songIds))
    const playlistIds = new Set(playlists.map((p) => p.id))
    const rules = (data.rules ?? []).map((r) => normalizeRule(r, { id: r.id }, playlistIds))
    const events = (data.events ?? []).map((e) => normalizeEvent(e, { id: e.id }))
    const announcements = (data.announcements ?? []).map((a) => normalizeAnnouncement(a, { id: a.id }, now))
    const config = normalizeConfig(data.config ?? {}, withDefaults({}), playlistIds)

    for (const table of ['songs', 'playlists', 'rules', 'events', 'announcements']) this.db.run(`DELETE FROM ${table}`)
    songs.forEach((s) => saveEntity(this.db, 'songs', s))
    playlists.forEach((p) => saveEntity(this.db, 'playlists', p))
    rules.forEach((r) => saveEntity(this.db, 'rules', r))
    events.forEach((e) => saveEntity(this.db, 'events', e))
    announcements.forEach((a) => saveEntity(this.db, 'announcements', a))
    this.config = config
    writeKv(this.db, 'config', config)
    this.state.queue = this.state.queue.filter((q) => (q.kind === 'song' ? songIds.has(q.songId) : announcements.some((a) => a.id === q.announcementId)))
    this.audit('restaurar-respaldo', `${songs.length} canciones`)
    this.save()
    return { songs: songs.length, playlists: playlists.length, rules: rules.length, events: events.length, announcements: announcements.length }
  }

  // --- Locución ----------------------------------------------------------------------------

  voiceFor(announcement) {
    return announcement.voice || this.config.voice
  }

  audioInfo(announcement) {
    const hash = speechHash(this.voiceFor(announcement), announcement.text)
    const row = this.db.get('SELECT duration_ms, text_hash FROM announcement_audio WHERE announcement_id = ?', announcement.id)
    return row && row.text_hash === hash ? { durationMs: row.duration_ms, hash } : null
  }

  // Voz de las presentaciones: caché por texto (la misma frase no se genera dos veces).

  speechInfo(text, voice) {
    const hash = speechHash(voice, text)
    const row = this.db.get('SELECT duration_ms FROM speech_cache WHERE hash = ?', hash)
    return row ? { hash, durationMs: row.duration_ms } : null
  }

  getSpeech(hash) {
    const row = this.db.get('SELECT wav FROM speech_cache WHERE hash = ?', hash)
    return row ? new Uint8Array(row.wav) : null
  }

  /** Presentaciones que conviene tener listas: la de la próxima canción en cola. */
  pendingSpeech() {
    if (!this.config.songIntros || !this.services.ttsConfigured) return []
    const next = this.state.queue.find((q) => q.kind === 'song')
    const current = this.state.now?.kind === 'intro' && !this.state.now.speechHash ? this.state.now : null
    const out = []
    for (const item of [current?.pendingItem, next].filter(Boolean)) {
      const song = this.getSong(item.songId)
      if (!song) continue
      const text = this.introText(song, item.source)
      if (!this.speechInfo(text, this.config.voice)) out.push({ text, voice: this.config.voice })
    }
    return out
  }

  /** Anuncios aprobados y vigentes que aún no tienen su audio IA (por ejemplo, creados antes de configurar la clave). */
  announcementsMissingAudio() {
    if (!this.services.ttsConfigured) return []
    const ctx = this.context()
    return this.list('announcements')
      .filter((a) => ['vigente', 'programado'].includes(announcementStatus(a, ctx)) && !this.audioInfo(a))
      .map((a) => a.id)
  }

  async generateSpeech(text, voice) {
    if (this.speechInfo(text, voice)) return
    const { wav, durationMs } = await this.services.speak(text, { voice })
    const now = this.clock()
    this.db.run(
      `INSERT INTO speech_cache (hash, text, duration_ms, wav, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(hash) DO NOTHING`,
      speechHash(voice, text), text, durationMs, wav, now,
    )
    // Se conservan las 400 más recientes (cada una pesa unos cientos de KB).
    this.db.run('DELETE FROM speech_cache WHERE hash NOT IN (SELECT hash FROM speech_cache ORDER BY created_at DESC LIMIT 400)')
    // Si la presentación ya empezó con voz del navegador, no se cambia a media frase.
  }

  getAudio(announcementId) {
    const a = getEntity(this.db, 'announcements', announcementId)
    if (!a || !a.approved || !this.audioInfo(a)) return null
    const row = this.db.get('SELECT wav FROM announcement_audio WHERE announcement_id = ?', announcementId)
    return row ? new Uint8Array(row.wav) : null
  }

  async generateAudio(announcementId) {
    const a = getEntity(this.db, 'announcements', announcementId)
    if (!a) throw new HttpError(404, 'El anuncio no existe.')
    if (this.audioInfo(a)) return { status: 'ok', cached: true }
    if (!this.services.speak) throw new HttpError(503, 'La síntesis de voz no está configurada.')
    const voice = this.voiceFor(a)
    const { wav, durationMs } = await this.services.speak(a.text, { voice })
    if (wav.byteLength > 1_900_000) throw new HttpError(413, 'El audio generado es demasiado largo. Acorta el texto.')
    this.db.run(
      `INSERT INTO announcement_audio (announcement_id, text_hash, duration_ms, wav, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(announcement_id) DO UPDATE SET text_hash = excluded.text_hash, duration_ms = excluded.duration_ms, wav = excluded.wav, created_at = excluded.created_at`,
      a.id, speechHash(voice, a.text), durationMs, wav, this.clock(),
    )
    return { status: 'ok', cached: false, durationMs }
  }

  // --- Simulador, historial y estadísticas --------------------------------------------------

  simulate({ date, time, temperature }) {
    const t = temperature === '' || temperature === null || temperature === undefined ? null : Number(temperature)
    const ctx = contextAt({ date, time, temperature: Number.isFinite(t) ? t : null, events: this.list('events') })
    const rules = this.list('rules')
    const result = selectSongs({
      songs: this.list('songs'),
      rules,
      playlists: this.playlistsById(),
      context: ctx,
      config: this.config,
      count: 4,
      rng: this.rng,
    })
    return {
      context: ctx,
      rules: rules.map((r) => ({ id: r.id, name: r.name, priority: r.priority, enabled: r.enabled, status: r.enabled ? ruleStatus(r, ctx) : 'desactivada' })),
      options: result.songs.map((s) => this.songBrief(s)),
      trace: result.trace,
    }
  }

  history({ limit = 50 } = {}) {
    const titles = new Map(this.list('songs').map((s) => [s.id, `${s.title} — ${s.artist}`]))
    const rounds = this.db.all('SELECT * FROM rounds ORDER BY id DESC LIMIT ?', limit).map((r) => ({
      id: r.id,
      openedAt: r.opened_at,
      closedAt: r.closed_at,
      options: JSON.parse(r.options).map((id) => titles.get(id) ?? id),
      counts: r.counts ? JSON.parse(r.counts) : null,
      winner: r.winner_song_id ? titles.get(r.winner_song_id) ?? r.winner_song_id : null,
      resolution: r.resolution,
      strategy: r.strategy,
      trace: r.trace ? JSON.parse(r.trace) : null,
    }))
    const plays = this.db.all('SELECT * FROM plays ORDER BY id DESC LIMIT ?', limit).map((p) => ({
      id: p.id, kind: p.kind, title: p.title, source: p.source, startedAt: p.started_at, endedAt: p.ended_at, status: p.status, detail: p.detail,
    }))
    const audit = this.db.all('SELECT * FROM audit ORDER BY id DESC LIMIT ?', limit)
    return { rounds, plays, audit }
  }

  stats({ days = 30 } = {}) {
    const since = this.clock() - days * 86_400_000
    const totals = this.db.get(
      `SELECT COUNT(*) AS rounds,
              SUM(CASE WHEN resolution = 'sin-votos' THEN 1 ELSE 0 END) AS empty,
              SUM(CASE WHEN resolution = 'empate' THEN 1 ELSE 0 END) AS ties
         FROM rounds WHERE closed_at IS NOT NULL AND opened_at >= ?`,
      since,
    )
    const votes = this.db.get('SELECT COUNT(*) AS votes, COUNT(DISTINCT voter) AS voters FROM votes WHERE created_at >= ?', since)
    const byHour = Array(24).fill(0)
    for (const { created_at } of this.db.all('SELECT created_at FROM votes WHERE created_at >= ?', since)) {
      byHour[Math.floor(zonedParts(created_at, this.config.campus.timezone).minutes / 60)] += 1
    }
    const titles = new Map(this.list('songs').map((s) => [s.id, { title: s.title, artist: s.artist }]))
    const named = (rows) => rows.map((r) => ({ ...(titles.get(r.id) ?? { title: r.id, artist: '' }), count: r.n }))
    const topWinners = named(
      this.db.all(
        "SELECT winner_song_id AS id, COUNT(*) AS n FROM rounds WHERE resolution = 'votos' AND opened_at >= ? GROUP BY winner_song_id ORDER BY n DESC LIMIT 8",
        since,
      ),
    )
    const topPlayed = named(
      this.db.all(
        "SELECT ref_id AS id, COUNT(*) AS n FROM plays WHERE kind = 'song' AND status != 'error' AND started_at >= ? GROUP BY ref_id ORDER BY n DESC LIMIT 8",
        since,
      ),
    )
    const perRound = this.db
      .all(
        `SELECT r.id, r.opened_at AS openedAt, (SELECT COUNT(*) FROM votes v WHERE v.round_id = r.id) AS votes
           FROM rounds r WHERE r.closed_at IS NOT NULL ORDER BY r.id DESC LIMIT 30`,
      )
      .reverse()
    const rounds = totals.rounds ?? 0
    return {
      days,
      rounds,
      emptyRounds: totals.empty ?? 0,
      ties: totals.ties ?? 0,
      votes: votes.votes,
      voters: votes.voters,
      avgVotes: rounds ? Math.round((votes.votes / rounds) * 10) / 10 : 0,
      byHour,
      perRound,
      topWinners,
      topPlayed,
    }
  }

  // --- Lo que ve cada pantalla -----------------------------------------------------------------

  songBrief(songOrId) {
    const s = typeof songOrId === 'string' ? this.getSong(songOrId) : songOrId
    if (!s) return null
    return { id: s.id, title: s.title, artist: s.artist, youtubeId: s.youtubeId, duration: s.duration, genre: s.genre, energy: s.energy }
  }

  publicState() {
    const now = this.clock()
    const ctx = this.context()
    const { now: current, round, queue } = this.state

    let nowPlaying = null
    if (current?.kind === 'song') {
      nowPlaying = { kind: 'song', playId: current.playId, song: this.songBrief(current.songId), startedAt: current.startedAt, endsAt: current.endsAt, duration: current.duration, source: current.source }
    } else if (current?.kind === 'announcement') {
      const a = getEntity(this.db, 'announcements', current.announcementId)
      nowPlaying = {
        kind: 'announcement',
        playId: current.playId,
        announcement: a && { id: a.id, title: a.title, text: a.text },
        audioUrl: current.hasAudio ? `/api/announcements/${current.announcementId}/audio?v=${current.audioVersion}` : null,
        startedAt: current.startedAt,
        endsAt: current.endsAt,
      }
    }

    if (current?.kind === 'intro') {
      nowPlaying = {
        kind: 'intro',
        playId: current.playId,
        song: this.songBrief(current.songId),
        text: current.text,
        audioUrl: current.speechHash ? `/api/speech/${current.speechHash}` : null,
        source: current.source,
        startedAt: current.startedAt,
        endsAt: current.endsAt,
      }
    }

    let publicRound = null
    if (round) {
      const closed = round.status === 'closed'
      const counts = closed ? round.counts : this.voteCounts(round.id, round.options.length)
      publicRound = {
        id: round.id,
        status: round.status,
        openedAt: round.openedAt,
        closesAt: round.closesAt,
        options: round.options.map((id) => this.songBrief(id)),
        totalVotes: counts.reduce((a, b) => a + b, 0),
        counts: closed || this.config.showLiveCounts ? counts : null,
        winner: closed ? round.winner : null,
        winnerSong: closed ? this.songBrief(round.winnerSongId) : null,
        resolution: closed ? round.resolution : null,
      }
    }

    const nextSong = queue.find((q) => q.kind === 'song')
    const announcements = this.list('announcements')
    return {
      serverNow: now,
      station: this.config.campus.name,
      place: this.config.campus.place ?? null,
      paused: this.state.paused,
      pauseReason: this.state.pauseReason,
      nowPlaying,
      round: publicRound,
      upNext: nextSong ? { ...this.songBrief(nextSong.songId), source: nextSong.source } : null,
      context: {
        time: ctx.time,
        date: ctx.date,
        daypart: ctx.daypart,
        temperature: ctx.temperature,
        events: ctx.events.map((e) => e.name),
        rules: this.list('rules')
          .filter((r) => r.enabled && ruleStatus(r, ctx) === 'aplica')
          .map((r) => r.name),
        fallback: round?.trace?.fallback ?? null,
      },
      ticker: this.config.ticker,
      notices: announcements.filter((a) => announcementStatus(a, ctx) === 'vigente').slice(0, 5).map((a) => ({ id: a.id, title: a.title, text: a.text })),
      upcomingEvents: this.list('events')
        .filter((e) => e.enabled && e.endDate >= ctx.date)
        .slice(0, 4)
        .map((e) => ({ name: e.name, type: e.type, startDate: e.startDate, endDate: e.endDate })),
      player: {
        active: this.playerActive(),
        status: this.playerActive() ? this.state.player.status : 'desconectado',
        message: this.state.player.message,
      },
    }
  }

  adminState() {
    const ctx = this.context()
    const round = this.state.round
    return {
      ...this.publicState(),
      liveCounts: round ? (round.status === 'closed' ? round.counts : this.voteCounts(round.id, round.options.length)) : null,
      roundTrace: round?.trace ?? null,
      queue: this.state.queue.map((q) =>
        q.kind === 'song'
          ? { key: q.key, kind: 'song', source: q.source, song: this.songBrief(q.songId) }
          : { key: q.key, kind: 'announcement', source: q.source, title: getEntity(this.db, 'announcements', q.announcementId)?.title },
      ),
      weather: { ...this.weather, current: this.temperature() },
      contextDetail: ctx,
      lastError: this.state.lastError,
      services: {
        tts: Boolean(this.services.ttsConfigured),
        weather: this.temperature() !== null,
      },
    }
  }

  // --- Inicio de sesión (límite de intentos en memoria) ---------------------------------------

  loginAllowed(ip) {
    const entry = this.loginAttempts.get(ip)
    return !entry || entry.count < 5 || this.clock() > entry.until
  }

  loginFailed(ip) {
    const now = this.clock()
    const entry = this.loginAttempts.get(ip)
    const fresh = !entry || now > entry.until
    this.loginAttempts.set(ip, { count: fresh ? 1 : entry.count + 1, until: now + 10 * 60_000 })
  }

  loginSucceeded(ip) {
    this.loginAttempts.delete(ip)
  }
}
