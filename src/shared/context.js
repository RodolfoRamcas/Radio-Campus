// Convierte hora, temperatura y calendario en un "contexto", y decide qué reglas aplican.
import { daypartOf, inTimeWindow, zonedParts } from './time.js'

export const EVENT_TYPES = { festividad: 'Festividad', examenes: 'Exámenes', evento: 'Evento institucional' }
export const CONDITION_TYPES = { horario: 'Horario', temperatura: 'Temperatura', evento: 'Calendario', siempre: 'Siempre' }

export function buildContext({ now, timezone, temperature = null, events = [] }) {
  const t = zonedParts(now, timezone)
  const hasTemperature = typeof temperature === 'number' && Number.isFinite(temperature)
  return {
    now,
    date: t.date,
    time: t.time,
    local: t.local,
    minutes: t.minutes,
    weekday: t.weekday,
    daypart: daypartOf(t.minutes),
    temperature: hasTemperature ? temperature : null,
    events: events
      .filter((e) => e.enabled !== false && e.startDate <= t.date && t.date <= e.endDate)
      .map(({ id, name, type, theme }) => ({ id, name, type, theme: theme || null })),
  }
}

/** Contexto para una fecha y hora arbitrarias (simulador del panel). */
export function contextAt({ date, time, temperature = null, events = [] }) {
  const [h, m] = time.split(':').map(Number)
  const minutes = h * 60 + m
  const hasTemperature = typeof temperature === 'number' && Number.isFinite(temperature)
  return {
    now: Date.parse(`${date}T${time}:00Z`),
    date,
    time,
    local: `${date}T${time}`,
    minutes,
    weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
    daypart: daypartOf(minutes),
    temperature: hasTemperature ? temperature : null,
    events: events
      .filter((e) => e.enabled !== false && e.startDate <= date && date <= e.endDate)
      .map(({ id, name, type, theme }) => ({ id, name, type, theme: theme || null })),
  }
}

/** 'aplica' | 'no-aplica' | 'sin-datos' (la regla depende de un dato que no llegó). */
export function ruleStatus(rule, ctx) {
  const when = rule.when ?? {}
  switch (when.type) {
    case 'siempre':
      return 'aplica'
    case 'horario': {
      const dayOk = !when.days?.length || when.days.includes(ctx.weekday)
      return dayOk && inTimeWindow(ctx.minutes, when.from, when.to) ? 'aplica' : 'no-aplica'
    }
    case 'temperatura': {
      if (ctx.temperature === null) return 'sin-datos'
      const { min, max } = when
      const ok = (min === null || min === undefined || ctx.temperature >= min) &&
        (max === null || max === undefined || ctx.temperature <= max)
      return ok ? 'aplica' : 'no-aplica'
    }
    case 'evento':
      return ctx.events.some((e) => (!when.eventType || e.type === when.eventType) && (!when.theme || e.theme === when.theme))
        ? 'aplica'
        : 'no-aplica'
    default:
      return 'no-aplica'
  }
}

/** Texto corto para listas: "Lun–Vie 07:00–11:00", "≥ 28 °C", "Exámenes". */
export function describeCondition(when = {}) {
  switch (when.type) {
    case 'siempre':
      return 'Siempre'
    case 'horario': {
      const hours = when.from && when.to ? `${when.from}–${when.to}` : 'todo el día'
      const days = when.days?.length && when.days.length < 7
        ? when.days.map((d) => ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][d]).join(', ') + ' · '
        : ''
      return days + hours
    }
    case 'temperatura': {
      const { min, max } = when
      if (min != null && max != null) return `${min}–${max} °C`
      if (min != null) return `≥ ${min} °C`
      if (max != null) return `≤ ${max} °C`
      return 'Cualquier temperatura'
    }
    case 'evento':
      return [when.eventType ? EVENT_TYPES[when.eventType] : 'Cualquier evento', when.theme].filter(Boolean).join(' · ')
    default:
      return '—'
  }
}
