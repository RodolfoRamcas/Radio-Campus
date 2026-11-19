export function mmss(seconds) {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function remainingSeconds(until, now) {
  return Math.max(0, Math.ceil((until - now) / 1000))
}

export function formatDateTime(ms, timeZone) {
  return new Intl.DateTimeFormat('es-MX', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms))
}

export function formatDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d))
}

export function formatDateRange(start, end) {
  return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`
}

export const thumbnail = (youtubeId, quality = 'hqdefault') => `https://i.ytimg.com/vi/${youtubeId}/${quality}.jpg`

export const percent = (part, total) => (total ? Math.round((part / total) * 100) : 0)

export const RESOLUTION_LABELS = {
  votos: 'Por votación',
  empate: 'Empate',
  'sin-votos': 'Sin votos',
}

export const SOURCE_LABELS = {
  votacion: 'Ganó la votación',
  desempate: 'Ganó por desempate',
  'sin-votos': 'Ronda sin votos',
  manual: 'Programada por la administración',
  automatica: 'Selección automática',
  respaldo: 'Selección de respaldo',
  programado: 'Anuncio programado',
}

export const FALLBACK_LABELS = {
  'sin-candidatas': 'No había suficientes canciones elegibles',
  'dato-faltante': 'Falta un dato del contexto (clima)',
  'sin-votos': 'Ronda sin votos',
}

export const fallbackLabel = (code) => (code ? FALLBACK_LABELS[code.split('+')[0]] ?? code : null)
