// Parámetros generales por defecto. Todo se puede cambiar desde el panel de administración.

export const DEFAULT_CONFIG = {
  campus: {
    name: 'Radio Campus',
    // Ubicación para la temperatura local. Se cambia en Configuración con el buscador de ciudad.
    place: 'Miramar, Tamaulipas',
    latitude: 22.36094,
    longitude: -97.89997,
    timezone: 'America/Monterrey',
  },
  roundSeconds: 120,
  resultsSeconds: 20,
  tieBreak: 'contexto',
  noVotes: 'contexto',
  maxVotesPerIp: 0,
  showLiveCounts: false,
  recentSongs: 12,
  recentMinutes: 90,
  avoidSameArtist: true,
  variety: 1.5,
  blockedRestrictions: ['explicita'],
  // Canciones con estas temáticas solo se ofrecen mientras hay un evento activo con la misma temática.
  seasonalThemes: ['navidad', 'dia-de-muertos', 'fiestas-patrias'],
  backupPlaylistId: 'pl-respaldo',
  missingData: 'respaldo',
  minSongsBetweenAnnouncements: 1,
  // Entre canción y canción suena al menos un anuncio (rotan si todos sonaron hace poco).
  announcementEverySong: true,
  // La voz IA presenta cada canción antes de que suene.
  songIntros: true,
  voice: 'Kore',
  ticker: [
    'Escanea el código QR y elige la próxima canción.',
    'Biblioteca central: abierta de 7:00 a 21:00.',
    'Consulta tus calificaciones solo en los canales oficiales de la universidad.',
  ],
  tags: {
    genres: ['pop', 'rock', 'rock en español', 'pop latino', 'reguetón', 'cumbia', 'electrónica', 'funk', 'ranchera', 'mariachi', 'clásica', 'instrumental'],
    moods: ['tranquila', 'alegre', 'motivadora', 'romántica', 'melancólica', 'festiva', 'intensa', 'bailable', 'concentración'],
    themes: ['navidad', 'dia-de-muertos', 'fiestas-patrias', 'amor-y-amistad', 'bienvenida'],
    restrictions: ['explicita', 'tema-sensible', 'solo-eventos'],
  },
}

export const VOICES = ['Kore', 'Puck', 'Charon', 'Aoede', 'Zephyr', 'Fenrir', 'Sulafat']

/** Mezcla config guardada con los valores por defecto, para que una versión nueva no rompa una config vieja. */
export function withDefaults(saved = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    campus: { ...DEFAULT_CONFIG.campus, ...saved.campus },
    tags: { ...DEFAULT_CONFIG.tags, ...saved.tags },
  }
}
