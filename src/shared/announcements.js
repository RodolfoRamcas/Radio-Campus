// Programación de anuncios: vigencia, días, franja horaria, frecuencia y prioridad.
import { inTimeWindow } from './time.js'

export const MAX_ANNOUNCEMENT_CHARS = 400

/** 'borrador' | 'desactivado' | 'programado' (aún no empieza) | 'vigente' | 'vencido' */
export function announcementStatus(a, ctx) {
  if (a.endsAt && ctx.local > a.endsAt) return 'vencido'
  if (!a.approved) return 'borrador'
  if (!a.enabled) return 'desactivado'
  if (a.startsAt && ctx.local < a.startsAt) return 'programado'
  return 'vigente'
}

export const STATUS_LABELS = {
  borrador: 'Pendiente de revisión',
  desactivado: 'Desactivado',
  programado: 'Programado',
  vigente: 'Vigente',
  vencido: 'Vencido',
}

/** ¿Puede sonar ahora? Solo los aprobados, vigentes, dentro de su día y franja, y respetando su frecuencia. */
export function isDue(a, ctx, lastPlayedAt) {
  if (announcementStatus(a, ctx) !== 'vigente') return false
  if (a.days?.length && !a.days.includes(ctx.weekday)) return false
  if (!inTimeWindow(ctx.minutes, a.fromTime, a.toTime)) return false
  if (lastPlayedAt && ctx.now - lastPlayedAt < (a.everyMinutes ?? 30) * 60_000) return false
  return true
}

/**
 * Anuncio a intercalar entre canciones, o null.
 * @param {Map<string, number>} lastPlays  id -> última vez que sonó (ms)
 */
export function pickAnnouncement(announcements, ctx, { lastPlays, songsSinceAnnouncement, minSongsBetween, always = false }) {
  if (!always && songsSinceAnnouncement < minSongsBetween) return null
  const due = announcements.filter((a) => isDue(a, ctx, lastPlays.get(a.id)))
  if (due.length) {
    due.sort((a, b) => b.priority - a.priority || (lastPlays.get(a.id) ?? 0) - (lastPlays.get(b.id) ?? 0))
    return due[0]
  }
  if (!always) return null
  // "Siempre uno": si todos sonaron hace poco, rota entre los vigentes a esta hora; primero el que lleva más sin sonar.
  const eligible = announcements.filter((a) => isDue(a, ctx, null))
  eligible.sort((a, b) => (lastPlays.get(a.id) ?? 0) - (lastPlays.get(b.id) ?? 0) || b.priority - a.priority)
  return eligible[0] ?? null
}

/** Duración aproximada de la locución cuando aún no hay audio generado (unos 14 caracteres por segundo). */
export const estimateSpeechMs = (text) => Math.max(4000, Math.round((text.length / 14) * 1000) + 1500)
