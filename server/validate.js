// Validación de lo que llega desde el panel. Nada se guarda sin pasar por aquí.
import { EVENT_TYPES } from '../src/shared/context.js'
import { MAX_ANNOUNCEMENT_CHARS } from '../src/shared/announcements.js'
import { NO_VOTE_RULES, TIE_BREAKS } from '../src/shared/rounds.js'
import { VOICES } from '../src/shared/defaults.js'
import { parseYouTubeId } from './services.js'

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

const bad = (message) => new HttpError(400, message)

function text(value, label, { max = 120, required = true } = {}) {
  const out = String(value ?? '').trim()
  if (required && !out) throw bad(`Falta ${label}.`)
  if (out.length > max) throw bad(`${label} admite hasta ${max} caracteres.`)
  return out
}

function int(value, label, min, max, fallback) {
  if ((value === null || value === undefined || value === '') && fallback !== undefined) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} debe ser un entero entre ${min} y ${max}.`)
  return n
}

function optionalInt(value, label, min, max) {
  return value === null || value === undefined || value === '' ? null : int(value, label, min, max)
}

function optionalNumber(value, label) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) throw bad(`${label} debe ser un número.`)
  return n
}

function tagList(value, label, max = 12) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw bad(`${label} debe ser una lista.`)
  const out = [...new Set(value.map((v) => String(v).trim().toLowerCase()).filter(Boolean))]
  if (out.length > max) throw bad(`${label} admite hasta ${max} elementos.`)
  if (out.some((v) => v.length > 40)) throw bad(`Cada elemento de ${label} admite hasta 40 caracteres.`)
  return out
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/

function time(value, label) {
  if (!value) return null
  if (!HHMM.test(value)) throw bad(`${label} debe tener el formato HH:MM.`)
  return value
}

function days(value) {
  if (!value) return []
  if (!Array.isArray(value) || value.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw bad('Días no válidos.')
  return [...new Set(value)].sort()
}

const bool = (value, fallback) => (value === undefined ? fallback : Boolean(value))

export function normalizeSong(input, existing) {
  const youtubeId = parseYouTubeId(input.youtubeId ?? existing?.youtubeId)
  if (!youtubeId) throw bad('El identificador o enlace de YouTube no es válido.')
  return {
    id: existing?.id ?? `yt-${youtubeId}`,
    youtubeId,
    title: text(input.title, 'el título'),
    artist: text(input.artist, 'el artista'),
    duration: int(input.duration, 'La duración (segundos)', 10, 3600),
    genre: text(input.genre, 'el género', { max: 40 }).toLowerCase(),
    energy: int(input.energy, 'La energía', 1, 5),
    moods: tagList(input.moods, 'Ambientes'),
    themes: tagList(input.themes, 'Temáticas'),
    restrictions: tagList(input.restrictions, 'Restricciones'),
    enabled: bool(input.enabled, true),
    errorCount: existing?.errorCount ?? 0,
    createdAt: existing?.createdAt,
  }
}

export function normalizePlaylist(input, existing, songIds) {
  if (!Array.isArray(input.songIds ?? [])) throw bad('La lista de canciones no es válida.')
  return {
    id: existing?.id ?? input.id,
    name: text(input.name, 'el nombre'),
    description: text(input.description, 'la descripción', { max: 300, required: false }),
    songIds: [...new Set(input.songIds ?? [])].filter((id) => songIds.has(id)),
  }
}

export function normalizeRule(input, existing, playlistIds) {
  const when = input.when ?? {}
  let condition
  switch (when.type) {
    case 'siempre':
      condition = { type: 'siempre' }
      break
    case 'horario':
      condition = { type: 'horario', days: days(when.days), from: time(when.from, 'La hora de inicio'), to: time(when.to, 'La hora de fin') }
      break
    case 'temperatura': {
      const min = optionalNumber(when.min, 'La temperatura mínima')
      const max = optionalNumber(when.max, 'La temperatura máxima')
      if (min === null && max === null) throw bad('Indica una temperatura mínima, máxima o ambas.')
      if (min !== null && max !== null && min > max) throw bad('La temperatura mínima no puede ser mayor que la máxima.')
      condition = { type: 'temperatura', min, max }
      break
    }
    case 'evento':
      if (when.eventType && !EVENT_TYPES[when.eventType]) throw bad('Tipo de evento no válido.')
      condition = { type: 'evento', eventType: when.eventType || null, theme: when.theme ? String(when.theme).trim().toLowerCase() : null }
      break
    default:
      throw bad('Tipo de condición no válido.')
  }

  const e = input.effect ?? {}
  const energyMin = optionalInt(e.energyMin, 'La energía mínima', 1, 5)
  const energyMax = optionalInt(e.energyMax, 'La energía máxima', 1, 5)
  if (energyMin !== null && energyMax !== null && energyMin > energyMax) throw bad('La energía mínima no puede ser mayor que la máxima.')
  if (e.playlistId && !playlistIds.has(e.playlistId)) throw bad('La lista elegida no existe.')

  return {
    id: existing?.id ?? input.id,
    name: text(input.name, 'el nombre'),
    priority: int(input.priority, 'La prioridad', 0, 100),
    enabled: bool(input.enabled, true),
    exclusive: bool(input.exclusive, false),
    when: condition,
    effect: {
      genres: tagList(e.genres, 'Géneros', 20),
      moods: tagList(e.moods, 'Ambientes'),
      themes: tagList(e.themes, 'Temáticas'),
      energyMin,
      energyMax,
      playlistId: e.playlistId || null,
      requireTheme: Boolean(e.requireTheme),
      useEventTheme: Boolean(e.useEventTheme),
    },
  }
}

export function normalizeEvent(input, existing) {
  if (!DATE.test(input.startDate ?? '') || !DATE.test(input.endDate ?? '')) throw bad('Las fechas deben tener el formato AAAA-MM-DD.')
  if (input.startDate > input.endDate) throw bad('La fecha de inicio no puede ser posterior a la de fin.')
  if (!EVENT_TYPES[input.type]) throw bad('Tipo de evento no válido.')
  return {
    id: existing?.id ?? input.id,
    name: text(input.name, 'el nombre'),
    type: input.type,
    theme: input.theme ? String(input.theme).trim().toLowerCase() : null,
    startDate: input.startDate,
    endDate: input.endDate,
    notes: text(input.notes, 'las notas', { max: 300, required: false }),
    enabled: bool(input.enabled, true),
  }
}

export function normalizeAnnouncement(input, existing, now) {
  const startsAt = input.startsAt || null
  const endsAt = input.endsAt || null
  for (const [value, label] of [[startsAt, 'El inicio'], [endsAt, 'El fin']]) {
    if (value && !DATETIME.test(value)) throw bad(`${label} de la vigencia debe tener el formato AAAA-MM-DDTHH:MM.`)
  }
  if (startsAt && endsAt && startsAt > endsAt) throw bad('La vigencia termina antes de empezar.')
  if (input.voice && !VOICES.includes(input.voice)) throw bad('Voz no disponible.')
  return {
    id: existing?.id ?? input.id,
    title: text(input.title, 'el título'),
    text: text(input.text, 'el texto', { max: MAX_ANNOUNCEMENT_CHARS }),
    approved: bool(input.approved, false),
    enabled: bool(input.enabled, true),
    priority: int(input.priority, 'La prioridad', 1, 10, 1),
    startsAt,
    endsAt,
    days: days(input.days),
    fromTime: time(input.fromTime, 'La hora de inicio'),
    toTime: time(input.toTime, 'La hora de fin'),
    everyMinutes: int(input.everyMinutes, 'La frecuencia', 5, 1440, 30),
    voice: input.voice || null,
    updatedAt: now,
  }
}

export function normalizeConfig(input, current, playlistIds) {
  const c = { ...current }
  const campus = input.campus ?? current.campus
  c.campus = {
    name: text(campus.name, 'el nombre de la radio', { max: 60 }),
    place: text(campus.place, 'el nombre de la ubicación', { max: 80, required: false }),
    latitude: optionalNumber(campus.latitude, 'La latitud') ?? current.campus.latitude,
    longitude: optionalNumber(campus.longitude, 'La longitud') ?? current.campus.longitude,
    timezone: text(campus.timezone, 'la zona horaria', { max: 60 }),
  }
  if (Math.abs(c.campus.latitude) > 90 || Math.abs(c.campus.longitude) > 180) throw bad('Coordenadas fuera de rango.')
  try {
    new Intl.DateTimeFormat('es', { timeZone: c.campus.timezone })
  } catch {
    throw bad('Zona horaria no válida (ejemplo: America/Mexico_City).')
  }
  c.roundSeconds = int(input.roundSeconds ?? current.roundSeconds, 'La duración de la ronda', 30, 900)
  c.resultsSeconds = int(input.resultsSeconds ?? current.resultsSeconds, 'El tiempo de resultados', 5, 120)
  c.tieBreak = input.tieBreak ?? current.tieBreak
  if (!TIE_BREAKS[c.tieBreak]) throw bad('Regla de desempate no válida.')
  c.noVotes = input.noVotes ?? current.noVotes
  if (!NO_VOTE_RULES[c.noVotes]) throw bad('Regla para rondas sin votos no válida.')
  c.maxVotesPerIp = int(input.maxVotesPerIp ?? current.maxVotesPerIp, 'El límite por red', 0, 100000)
  c.showLiveCounts = bool(input.showLiveCounts, current.showLiveCounts)
  c.recentSongs = int(input.recentSongs ?? current.recentSongs, 'Canciones sin repetir', 0, 200)
  c.recentMinutes = int(input.recentMinutes ?? current.recentMinutes, 'Minutos sin repetir', 0, 1440)
  c.avoidSameArtist = bool(input.avoidSameArtist, current.avoidSameArtist)
  c.variety = optionalNumber(input.variety, 'La variedad') ?? current.variety
  c.blockedRestrictions = tagList(input.blockedRestrictions ?? current.blockedRestrictions, 'Restricciones bloqueadas')
  c.seasonalThemes = tagList(input.seasonalThemes ?? current.seasonalThemes, 'Temáticas de temporada', 30)
  c.backupPlaylistId = input.backupPlaylistId ?? current.backupPlaylistId
  if (c.backupPlaylistId && !playlistIds.has(c.backupPlaylistId)) throw bad('La lista de respaldo no existe.')
  c.missingData = input.missingData ?? current.missingData
  if (!['respaldo', 'ignorar'].includes(c.missingData)) throw bad('Opción de datos faltantes no válida.')
  c.announcementEverySong = bool(input.announcementEverySong, current.announcementEverySong)
  c.songIntros = bool(input.songIntros, current.songIntros)
  c.minSongsBetweenAnnouncements = int(input.minSongsBetweenAnnouncements ?? current.minSongsBetweenAnnouncements, 'Canciones entre anuncios', 0, 50)
  c.voice = input.voice ?? current.voice
  if (!VOICES.includes(c.voice)) throw bad('Voz no disponible.')
  const ticker = input.ticker ?? current.ticker
  if (!Array.isArray(ticker)) throw bad('La información institucional debe ser una lista.')
  c.ticker = ticker.map((t) => String(t ?? '').trim()).filter(Boolean).map((t) => text(t, 'el mensaje', { max: 160 }))
  if (c.ticker.length > 12) throw bad('La información institucional admite hasta 12 mensajes.')
  const tags = input.tags ?? current.tags
  c.tags = {
    genres: tagList(tags.genres, 'Géneros', 60),
    moods: tagList(tags.moods, 'Ambientes', 60),
    themes: tagList(tags.themes, 'Temáticas', 60),
    restrictions: tagList(tags.restrictions, 'Restricciones', 30),
  }
  return c
}
