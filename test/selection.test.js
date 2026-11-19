import test from 'node:test'
import assert from 'node:assert/strict'
import { contextAt, buildContext, ruleStatus } from '../src/shared/context.js'
import { selectSongs } from '../src/shared/selection.js'
import { inTimeWindow, zonedParts } from '../src/shared/time.js'
import { DEFAULT_CONFIG } from '../src/shared/defaults.js'
import { SEED_EVENTS, SEED_PLAYLISTS, SEED_RULES, seedSongs } from '../server/seed.js'
import { seeded } from './helpers.js'

const songs = seedSongs(0)
const byId = new Map(songs.map((s) => [s.id, s]))
const playlists = Object.fromEntries(SEED_PLAYLISTS.map((p) => [p.id, p]))
const config = { ...DEFAULT_CONFIG }

function pick(ctxInput, overrides = {}) {
  return selectSongs({
    songs,
    rules: SEED_RULES,
    playlists,
    context: contextAt({ events: SEED_EVENTS, temperature: 20, ...ctxInput }),
    config,
    rng: seeded(7),
    ...overrides,
  })
}

test('la hora local se calcula en la zona del campus', () => {
  const parts = zonedParts(Date.parse('2026-11-11T16:30:00Z'), 'America/Mexico_City')
  assert.equal(parts.time, '10:30')
  assert.equal(parts.date, '2026-11-11')
  assert.equal(parts.weekday, 3)
})

test('las franjas horarias pueden cruzar la medianoche', () => {
  assert.equal(inTimeWindow(23 * 60, '20:00', '07:00'), true)
  assert.equal(inTimeWindow(3 * 60, '20:00', '07:00'), true)
  assert.equal(inTimeWindow(12 * 60, '20:00', '07:00'), false)
})

test('el catálogo de ejemplo es coherente', () => {
  assert.equal(new Set(songs.map((s) => s.id)).size, songs.length)
  for (const list of SEED_PLAYLISTS) assert.ok(list.songIds.every((id) => byId.has(id)), list.name)
  assert.ok(songs.every((s) => s.energy >= 1 && s.energy <= 5 && /^[\w-]{11}$/.test(s.youtubeId)))
})

test('en exámenes la regla exclusiva manda sobre horario, temperatura y Navidad', () => {
  // 10 de diciembre: hay exámenes Y temporada navideña. Mediodía y calor.
  const { songs: options, trace } = pick({ date: '2026-12-10', time: '13:00', temperature: 31 })
  assert.equal(options.length, 2)
  for (const s of options) {
    assert.ok(['clásica', 'instrumental'].includes(s.genre), s.title)
    assert.ok(s.energy <= 2, s.title)
  }
  assert.equal(trace.exclusive, 'Exámenes: música para concentrarse')
  assert.deepEqual(trace.applied.map((r) => r.id), ['r-examenes'])
})

test('una festividad activa la selección temática', () => {
  const { songs: options, trace } = pick({ date: '2026-12-02', time: '10:00' })
  assert.ok(options.every((s) => s.themes.includes('navidad')), options.map((s) => s.title).join(', '))
  assert.ok(trace.applied.some((r) => r.id === 'r-festividad'))
})

test('la mañana ofrece energía moderada y el mediodía música más dinámica', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const morning = pick({ date: '2026-11-11', time: '09:00' }, { rng: seeded(seed) }).songs
    assert.ok(morning.every((s) => s.energy >= 2 && s.energy <= 4), morning.map((s) => s.title).join())
    const noon = pick({ date: '2026-11-11', time: '13:00' }, { rng: seeded(seed) }).songs
    assert.ok(noon.every((s) => s.energy >= 3), noon.map((s) => s.title).join())
  }
})

test('nunca ofrece contenido con restricciones bloqueadas ni canciones desactivadas', () => {
  const disabled = songs.map((s) => (s.genre === 'funk' ? { ...s, enabled: false } : s))
  for (let seed = 1; seed <= 60; seed++) {
    const { songs: options } = pick({ date: '2026-11-11', time: '13:00' }, { rng: seeded(seed), songs: disabled, count: 4 })
    assert.ok(options.every((s) => !s.restrictions.includes('explicita') && s.enabled))
  }
})

test('las canciones de temporada solo salen durante su festividad', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { songs: options } = pick({ date: '2026-11-11', time: '13:00' }, { rng: seeded(seed), count: 6 })
    assert.ok(options.every((s) => !s.themes.includes('navidad') && !s.themes.includes('fiestas-patrias')), options.map((s) => s.title).join())
  }
  const muertos = pick({ date: '2026-11-01', time: '13:00' }, { count: 6 }).songs
  assert.ok(muertos.some((s) => s.themes.includes('dia-de-muertos')))
  assert.ok(muertos.every((s) => !s.themes.includes('navidad')))
})

test('evita repetir lo que sonó hace poco', () => {
  const now = Date.parse('2026-11-11T19:00:00Z')
  const recentPlays = songs.slice(0, 40).map((s, i) => ({ songId: s.id, startedAt: now - i * 60_000 }))
  const { songs: options, trace } = pick({ date: '2026-11-11', time: '13:00' }, { recentPlays, context: { ...contextAt({ date: '2026-11-11', time: '13:00', temperature: 20, events: [] }), now } })
  assert.equal(trace.fallback, null)
  assert.ok(options.every((s) => !recentPlays.some((p) => p.songId === s.id)))
})

test('si no quedan suficientes canciones elegibles usa la lista de respaldo', () => {
  const now = Date.parse('2026-11-11T19:00:00Z')
  const recentPlays = songs.map((s, i) => ({ songId: s.id, startedAt: now - i * 1000 }))
  const { songs: options, trace } = pick({ date: '2026-11-11', time: '13:00' }, { recentPlays, context: { ...contextAt({ date: '2026-11-11', time: '13:00', temperature: 20, events: [] }), now } })
  assert.equal(trace.fallback, 'sin-candidatas')
  assert.equal(options.length, 2)
  assert.ok(options.every((s) => playlists['pl-respaldo'].songIds.includes(s.id)))
})

test('si falta la temperatura, aplica el respaldo o ignora la regla según la configuración', () => {
  const ctx = { date: '2026-11-11', time: '13:00', temperature: null }
  assert.equal(ruleStatus(SEED_RULES.find((r) => r.id === 'r-calor'), contextAt(ctx)), 'sin-datos')

  const strict = pick(ctx)
  assert.equal(strict.trace.fallback, 'dato-faltante')
  assert.ok(strict.songs.every((s) => playlists['pl-respaldo'].songIds.includes(s.id)))

  const lenient = pick(ctx, { config: { ...config, missingData: 'ignorar' } })
  assert.equal(lenient.trace.fallback, null)
  assert.ok(lenient.trace.missing.includes('Calor: ambiente fresco y alegre'))
})

test('una regla se relaja si dejaría menos opciones que las necesarias', () => {
  const rules = [{ id: 'x', name: 'Solo funk', priority: 50, enabled: true, exclusive: false, when: { type: 'siempre' }, effect: { genres: ['funk'] } }]
  const { songs: options, trace } = pick({ date: '2026-11-11', time: '13:00' }, { rules })
  assert.equal(options.length, 2)
  assert.deepEqual(trace.relaxed.map((r) => r.id), ['x'])
})

test('las dos opciones son de artistas distintos cuando se puede', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const [a, b] = pick({ date: '2026-11-11', time: '21:00' }, { rng: seeded(seed) }).songs
    assert.notEqual(a.artist, b.artist)
  }
})

test('buildContext detecta eventos activos por fecha local', () => {
  // 3 de noviembre 02:00 UTC todavía es 2 de noviembre en CDMX: sigue Día de Muertos.
  const ctx = buildContext({ now: Date.parse('2026-11-03T02:00:00Z'), timezone: 'America/Mexico_City', events: SEED_EVENTS })
  assert.equal(ctx.date, '2026-11-02')
  assert.deepEqual(ctx.events.map((e) => e.id), ['e-muertos'])
})
