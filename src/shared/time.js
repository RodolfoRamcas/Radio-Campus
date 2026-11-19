// Fechas y horas en la zona horaria del campus, no en la del servidor ni en la del navegador.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

const formatters = new Map()
function formatterFor(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
      }),
    )
  }
  return formatters.get(timeZone)
}

/** { date: 'AAAA-MM-DD', time: 'HH:MM', minutes, weekday (0 = domingo), local: 'AAAA-MM-DDTHH:MM' } */
export function zonedParts(ms, timeZone) {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  const date = `${parts.year}-${parts.month}-${parts.day}`
  const time = `${parts.hour}:${parts.minute}`
  return {
    date,
    time,
    local: `${date}T${time}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: WEEKDAYS.indexOf(parts.weekday),
  }
}

export function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + (m || 0)
}

/** Ventana diaria [from, to). Si `to` es menor que `from`, cruza la medianoche (22:00–02:00). */
export function inTimeWindow(minutes, from, to) {
  if (!from || !to) return true
  const a = toMinutes(from)
  const b = toMinutes(to)
  if (a === b) return true
  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b
}

export function daypartOf(minutes) {
  if (minutes >= 6 * 60 && minutes < 12 * 60) return 'mañana'
  if (minutes >= 12 * 60 && minutes < 16 * 60) return 'mediodía'
  if (minutes >= 16 * 60 && minutes < 20 * 60) return 'tarde'
  return 'noche'
}
