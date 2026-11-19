import { DatabaseSync } from 'node:sqlite'
import { nodeSqlite } from '../server/db.js'
import { RadioEngine } from '../server/engine.js'

/** Generador pseudoaleatorio con semilla: las pruebas dan siempre el mismo resultado. */
export function seeded(seed = 42) {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/** Reloj controlable. 2026-11-11 10:00 en Ciudad de México = 16:00 UTC. */
export function fakeClock(iso = '2026-11-11T16:00:00Z') {
  let now = Date.parse(iso)
  const clock = () => now
  clock.advance = (ms) => {
    now += ms
  }
  clock.set = (value) => {
    now = Date.parse(value)
  }
  return clock
}

export function makeEngine({ clock = fakeClock(), temperature = 21, services = {}, rng = seeded() } = {}) {
  const db = nodeSqlite(new DatabaseSync(':memory:'))
  const engine = new RadioEngine({
    db,
    clock,
    rng,
    sessionSecret: 'secreto-de-prueba',
    services: {
      temperature: async () => {
        if (temperature === null) throw new Error('sin red')
        return temperature
      },
      ...services,
    },
  })
  engine.init()
  return { engine, db, clock }
}
