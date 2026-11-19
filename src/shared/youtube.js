// Reconoce enlaces de YouTube. Lo usan el servidor (validación) y el panel (autollenado al pegar).

export function parseYouTubeId(input) {
  const text = String(input ?? '').trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text
  try {
    const url = new URL(text)
    if (url.hostname === 'youtu.be') return /^\/[A-Za-z0-9_-]{11}/.test(url.pathname) ? url.pathname.slice(1, 12) : null
    if (url.hostname.endsWith('youtube.com') || url.hostname.endsWith('youtube-nocookie.com')) {
      const v = url.searchParams.get('v')
      if (v) return /^[A-Za-z0-9_-]{11}/.test(v) ? v.slice(0, 11) : null
      const match = url.pathname.match(/\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/)
      return match?.[1] ?? null
    }
  } catch {
    // no es URL
  }
  return null
}

/** "3:26" → 206; "206" → 206; texto inválido → null */
export function parseDuration(text) {
  const value = String(text ?? '').trim()
  if (/^\d+$/.test(value)) return Number(value)
  const match = value.match(/^(\d+):([0-5]\d)$/)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/**
 * Separa "Artista - Canción (Official Video)" en partes. Es solo una primera aproximación:
 * la IA (si está configurada) lo afina después.
 */
export function guessFromVideoTitle(videoTitle, channel = '') {
  const clean = String(videoTitle)
    .replace(/\s*[([][^)\]]*(official|oficial|video|audio|lyric|letra|4k|hd|remaster|visualizer|m\/v)[^)\]]*[)\]]/gi, '')
    .replace(/\s+(official|oficial)\s+(music\s+)?(video|audio)\s*$/i, '')
    .trim()
  const separator = clean.match(/\s[-–—]\s/)
  if (separator) {
    const [artist, ...rest] = clean.split(separator[0])
    return { artist: artist.trim(), title: rest.join(' - ').trim() }
  }
  return { artist: String(channel).replace(/(VEVO|\s*-\s*Topic|Official)$/i, '').trim(), title: clean }
}
