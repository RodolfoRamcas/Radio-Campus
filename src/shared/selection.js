// Algoritmo de selección musical contextual.
//
// 1. Filtra lo no autorizado (restricciones bloqueadas, canciones desactivadas), lo reciente y
//    lo de temporada fuera de su festividad (nada de villancicos en noviembre).
// 2. Recorre las reglas que aplican, de mayor a menor prioridad. Cada una acota el conjunto
//    (géneros, energía, lista, temática obligatoria) solo si quedan canciones suficientes;
//    si no, se "relaja" y se anota. Una regla exclusiva detiene a las de menor prioridad.
// 3. Ordena lo que queda por afinidad (ambiente, temática, energía) con algo de variedad.
// 4. Si no hay suficientes candidatas, o falta un dato y así está configurado, usa la
//    lista de respaldo autorizada.
import { ruleStatus } from './context.js'

const DAY = 86_400_000

const intersects = (a = [], b = []) => a.some((x) => b.includes(x))

/** Efecto de la regla en este contexto (las reglas de calendario pueden heredar la temática del evento). */
export function effectFor(rule, ctx) {
  const effect = { genres: [], moods: [], themes: [], energyMin: null, energyMax: null, playlistId: null, requireTheme: false, ...rule.effect }
  if (effect.useEventTheme) {
    const themes = ctx.events
      .filter((e) => !rule.when?.eventType || e.type === rule.when.eventType)
      .map((e) => e.theme)
      .filter(Boolean)
    effect.themes = [...new Set([...effect.themes, ...themes])]
  }
  return effect
}

function passes(song, effect, playlists) {
  if (effect.genres.length && !effect.genres.includes(song.genre)) return false
  if (effect.energyMin != null && song.energy < effect.energyMin) return false
  if (effect.energyMax != null && song.energy > effect.energyMax) return false
  if (effect.playlistId) {
    const list = playlists[effect.playlistId]
    if (list && !list.songIds.includes(song.id)) return false
  }
  if (effect.requireTheme && effect.themes.length && !intersects(song.themes, effect.themes)) return false
  return true
}

function affinity(song, preferences, playCounts) {
  let total = 0
  for (const { effect, weight } of preferences) {
    if (effect.themes.length && intersects(song.themes, effect.themes)) total += 2 * weight
    if (effect.moods.length && intersects(song.moods, effect.moods)) total += weight
    if (effect.energyMin != null || effect.energyMax != null) {
      const mid = ((effect.energyMin ?? 1) + (effect.energyMax ?? 5)) / 2
      total += (1 - Math.abs(song.energy - mid) / 4) * weight * 0.5
    }
  }
  return total - Math.min(playCounts[song.id] ?? 0, 20) * 0.05
}

/** Elige `count` canciones distintas, evitando repetir artista si se puede. */
function pickDistinct(ranked, count, avoidSameArtist) {
  const picked = []
  for (const song of ranked) {
    if (picked.length === count) break
    if (avoidSameArtist && picked.some((p) => p.artist === song.artist)) continue
    picked.push(song)
  }
  for (const song of ranked) {
    if (picked.length === count) break
    if (!picked.includes(song)) picked.push(song)
  }
  return picked
}

export function isRecent(songId, recentPlays, now, config) {
  return recentPlays.some(
    (p, i) => p.songId === songId && (i < config.recentSongs || now - p.startedAt < config.recentMinutes * 60_000),
  )
}

/**
 * @param {object} input
 * @param {Array} input.songs  catálogo completo
 * @param {Array} input.rules
 * @param {object} input.playlists  { [id]: { songIds } }
 * @param {object} input.context  de buildContext()
 * @param {object} input.config  parámetros generales
 * @param {Array} input.recentPlays  [{ songId, startedAt }] del más reciente al más antiguo
 * @param {Array} input.exclude  ids que no pueden salir (la actual, las que ya están en cola)
 */
export function selectSongs({
  songs,
  rules,
  playlists = {},
  context,
  config,
  recentPlays = [],
  exclude = [],
  count = 2,
  playCounts = {},
  rng = Math.random,
  forceBackup = false,
}) {
  const blocked = new Set(config.blockedRestrictions ?? [])
  const excluded = new Set(exclude)
  const seasonal = new Set(config.seasonalThemes ?? [])
  const activeThemes = new Set(context.events.map((e) => e.theme).filter(Boolean))
  const inSeason = (s) => !s.themes.some((t) => seasonal.has(t)) || s.themes.some((t) => activeThemes.has(t))
  const authorized = songs.filter(
    (s) => s.enabled && !s.restrictions.some((r) => blocked.has(r)) && !excluded.has(s.id) && inSeason(s),
  )
  const fresh = authorized.filter((s) => !isRecent(s.id, recentPlays, context.now, config))

  const evaluated = rules
    .filter((r) => r.enabled)
    .sort((a, b) => b.priority - a.priority)
    .map((rule) => ({ rule, status: ruleStatus(rule, context) }))

  const trace = {
    applied: [],
    relaxed: [],
    missing: evaluated.filter((e) => e.status === 'sin-datos').map((e) => e.rule.name),
    exclusive: null,
    fallback: null,
  }
  const brief = (rule) => ({ id: rule.id, name: rule.name, priority: rule.priority })

  const backup = (reason) => {
    trace.fallback = reason
    const list = playlists[config.backupPlaylistId]
    const inBackup = list ? authorized.filter((s) => list.songIds.includes(s.id)) : []
    const lastPlayed = (id) => recentPlays.find((p) => p.songId === id)?.startedAt ?? context.now - 365 * DAY
    // Primero lo que no ha sonado hace poco; si no alcanza, lo menos reciente; y como último recurso, cualquier autorizada.
    const order = (list) =>
      list.map((s) => ({ s, key: lastPlayed(s.id) + rng() * 60_000 })).sort((a, b) => a.key - b.key).map((x) => x.s)
    let pool = order(inBackup.filter((s) => fresh.includes(s)))
    if (pool.length < count) pool = order(inBackup)
    if (pool.length < count) {
      trace.fallback = `${reason}+catalogo`
      pool = [...pool, ...order(authorized.filter((s) => !pool.includes(s)))]
    }
    return { songs: pickDistinct(pool, count, config.avoidSameArtist), trace }
  }

  if (forceBackup) return backup('sin-votos')
  if (trace.missing.length && config.missingData === 'respaldo') return backup('dato-faltante')
  if (fresh.length < count) return backup('sin-candidatas')

  let pool = fresh
  const preferences = []
  for (const { rule, status } of evaluated) {
    if (status !== 'aplica') continue
    const effect = effectFor(rule, context)
    const narrowed = pool.filter((s) => passes(s, effect, playlists))
    if (narrowed.length >= count) {
      pool = narrowed
      trace.applied.push(brief(rule))
      preferences.push({ effect, weight: 1 + rule.priority / 25 })
    } else {
      trace.relaxed.push(brief(rule))
    }
    if (rule.exclusive) {
      trace.exclusive = rule.name
      break
    }
  }

  const variety = config.variety ?? 1.5
  const ranked = pool
    .map((song) => ({ song, score: affinity(song, preferences, playCounts) + rng() * variety }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.song)

  return { songs: pickDistinct(ranked, count, config.avoidSameArtist), trace }
}

/** Puntuación de afinidad sin azar: sirve para desempatar "por contexto". */
export function contextScores(songList, { rules, context, playlists = {} }) {
  const preferences = []
  for (const rule of [...rules].filter((r) => r.enabled).sort((a, b) => b.priority - a.priority)) {
    if (ruleStatus(rule, context) !== 'aplica') continue
    preferences.push({ effect: effectFor(rule, context), weight: 1 + rule.priority / 25 })
    if (rule.exclusive) break
  }
  return songList.map((song) => {
    let score = affinity(song, preferences, {})
    for (const { effect, weight } of preferences) if (passes(song, effect, playlists)) score += weight
    return score
  })
}
