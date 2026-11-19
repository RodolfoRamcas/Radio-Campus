import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveRound, roundClosesAt } from '../src/shared/rounds.js'
import { announcementStatus, isDue, pickAnnouncement } from '../src/shared/announcements.js'
import { contextAt } from '../src/shared/context.js'

const config = (tieBreak, noVotes = 'contexto') => ({ tieBreak, noVotes })

test('gana la opción con más votos', () => {
  assert.deepEqual(resolveRound({ counts: [3, 5], config: config('primera') }), { winner: 1, resolution: 'votos', strategy: null, total: 8 })
})

test('los empates se resuelven con la regla configurada', () => {
  const counts = [4, 4]
  assert.equal(resolveRound({ counts, config: config('primera') }).winner, 0)
  assert.equal(resolveRound({ counts, config: config('contexto'), scores: [1, 9] }).winner, 1)
  assert.equal(resolveRound({ counts, config: config('menos-reproducida'), playCounts: [7, 2] }).winner, 1)
  assert.equal(resolveRound({ counts, config: config('aleatorio'), rng: () => 0.9 }).winner, 1)
  assert.equal(resolveRound({ counts, config: config('aleatorio') }).resolution, 'empate')
})

test('una ronda sin votos usa su propia regla', () => {
  assert.deepEqual(resolveRound({ counts: [0, 0], config: config('primera', 'contexto'), scores: [0, 2] }), {
    winner: 1, resolution: 'sin-votos', strategy: 'contexto', total: 0,
  })
  assert.equal(resolveRound({ counts: [0, 0], config: config('primera', 'respaldo') }).winner, null)
})

test('la votación cierra antes del final para mostrar resultados', () => {
  const startedAt = 0
  assert.equal(roundClosesAt({ startedAt, endsAt: 240_000, roundSeconds: 120, resultsSeconds: 20 }), 120_000)
  assert.equal(roundClosesAt({ startedAt, endsAt: 100_000, roundSeconds: 120, resultsSeconds: 20 }), 80_000)
  assert.equal(roundClosesAt({ startedAt, endsAt: 20_000, roundSeconds: 120, resultsSeconds: 20 }), 15_000)
})

const base = { id: 'a', title: 'A', text: 'Hola', approved: true, enabled: true, priority: 1, startsAt: null, endsAt: null, days: [], fromTime: null, toTime: null, everyMinutes: 30 }
const at = (date, time) => contextAt({ date, time })

test('estado de un anuncio según revisión y vigencia', () => {
  assert.equal(announcementStatus({ ...base, approved: false }, at('2026-11-11', '10:00')), 'borrador')
  assert.equal(announcementStatus({ ...base, endsAt: '2026-11-10T23:00' }, at('2026-11-11', '10:00')), 'vencido')
  assert.equal(announcementStatus({ ...base, startsAt: '2026-11-12T08:00' }, at('2026-11-11', '10:00')), 'programado')
  assert.equal(announcementStatus(base, at('2026-11-11', '10:00')), 'vigente')
})

test('un anuncio respeta días, franja y frecuencia', () => {
  const ctx = at('2026-11-11', '10:00') // miércoles
  assert.equal(isDue({ ...base, days: [1, 2] }, ctx), false)
  assert.equal(isDue({ ...base, fromTime: '12:00', toTime: '14:00' }, ctx), false)
  assert.equal(isDue(base, ctx, ctx.now - 10 * 60_000), false)
  assert.equal(isDue(base, ctx, ctx.now - 31 * 60_000), true)
})

test('nunca elige un anuncio vencido y prefiere el de mayor prioridad', () => {
  const ctx = at('2026-11-11', '10:00')
  const list = [
    { ...base, id: 'vencido', priority: 10, endsAt: '2026-11-01T00:00' },
    { ...base, id: 'bajo', priority: 1 },
    { ...base, id: 'alto', priority: 5 },
  ]
  const options = { lastPlays: new Map(), songsSinceAnnouncement: 3, minSongsBetween: 2 }
  assert.equal(pickAnnouncement(list, ctx, options).id, 'alto')
  assert.equal(pickAnnouncement(list, ctx, { ...options, songsSinceAnnouncement: 1 }), null)
})

test('con "siempre un anuncio", rota aunque todos hayan sonado hace poco', () => {
  const ctx = at('2026-11-11', '10:00')
  const list = [
    { ...base, id: 'a', everyMinutes: 60 },
    { ...base, id: 'b', everyMinutes: 60 },
    { ...base, id: 'vencido', endsAt: '2026-01-01T00:00' },
  ]
  const lastPlays = new Map([['a', ctx.now - 60_000], ['b', ctx.now - 120_000], ['vencido', 0]])
  const options = { lastPlays, songsSinceAnnouncement: 0, minSongsBetween: 3 }
  assert.equal(pickAnnouncement(list, ctx, options), null)
  assert.equal(pickAnnouncement(list, ctx, { ...options, always: true }).id, 'b', 'el que lleva más sin sonar; nunca el vencido')
})
