// Servicios externos. Todos reciben `fetchImpl` para poder probarse sin red.
import { parseYouTubeId } from '../src/shared/youtube.js'

export class ServiceError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// --- Clima: Open-Meteo (gratuito, sin clave) --------------------------------------------

export async function fetchTemperature({ latitude, longitude, timezone }, fetchImpl = fetch) {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.search = new URLSearchParams({ latitude, longitude, timezone, current: 'temperature_2m' })
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new ServiceError(502, `Open-Meteo respondió ${response.status}`)
  const data = await response.json()
  const value = data?.current?.temperature_2m
  if (typeof value !== 'number') throw new ServiceError(502, 'Open-Meteo no devolvió temperatura')
  return Math.round(value * 10) / 10
}

/** Busca ciudades por nombre (geocodificador de Open-Meteo, sin clave). */
export async function searchPlaces(query, fetchImpl = fetch) {
  const name = String(query ?? '').trim().slice(0, 80)
  if (name.length < 2) throw new ServiceError(400, 'Escribe al menos dos letras.')
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search')
  url.search = new URLSearchParams({ name, count: '8', language: 'es', format: 'json' })
  let response
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) })
  } catch {
    throw new ServiceError(504, 'No se pudo consultar el buscador de ciudades.')
  }
  if (!response.ok) throw new ServiceError(502, `El buscador de ciudades respondió ${response.status}.`)
  const data = await response.json()
  return (data.results ?? []).map((r) => ({
    name: r.name,
    region: [r.admin2, r.admin1].filter(Boolean).join(', '),
    country: r.country ?? r.country_code ?? '',
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone,
  }))
}

// --- YouTube: oEmbed confirma que el video existe y permite reproducirse embebido -----------

export { parseYouTubeId }

/**
 * Duración del video, leída de la página pública de YouTube (oEmbed no la incluye).
 * Es "mejor esfuerzo": si YouTube cambia su página, devuelve null y el panel usa el reproductor.
 */
export async function fetchYouTubeDuration(id, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`https://www.youtube.com/watch?v=${id}&hl=es`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RadioCampus/1.0)', 'Accept-Language': 'es,en;q=0.8' },
      signal: AbortSignal.timeout(6000),
    })
    if (!response.ok) return null
    const match = (await response.text()).match(/"lengthSeconds":"(\d+)"/)
    const seconds = match ? Number(match[1]) : 0
    return seconds >= 10 && seconds <= 3600 ? seconds : null
  } catch {
    return null
  }
}

export async function lookupYouTube(input, fetchImpl = fetch) {
  const id = parseYouTubeId(input)
  if (!id) throw new ServiceError(400, 'No reconozco ese enlace de YouTube.')
  const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`
  let response
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) })
  } catch {
    throw new ServiceError(504, 'No se pudo consultar YouTube.')
  }
  if (response.status === 401 || response.status === 403) {
    throw new ServiceError(422, 'El dueño del video no permite reproducirlo fuera de YouTube.')
  }
  if (response.status === 404 || response.status === 400) throw new ServiceError(404, 'El video no existe o es privado.')
  if (!response.ok) throw new ServiceError(502, `YouTube respondió ${response.status}.`)
  const data = await response.json()
  return {
    youtubeId: id,
    title: data.title ?? '',
    channel: data.author_name ?? '',
    thumbnail: data.thumbnail_url ?? null,
    duration: await fetchYouTubeDuration(id, fetchImpl),
  }
}

// --- Etiquetas sugeridas con Gemini --------------------------------------------------------

export const DEFAULT_TEXT_MODEL = 'gemini-3.5-flash-lite'

const TAGGER_INSTRUCTION = `Clasificas canciones para la radio de una universidad en México.
Recibes el título de un video de YouTube y el nombre del canal. Devuelve:
- title: solo el nombre de la canción, sin "Official Video", "Lyrics", "4K", "M/V", años ni nombres de artistas invitados.
- artist: el artista principal; si hay invitados, agrégalos con "ft." (por ejemplo "Mark Ronson ft. Bruno Mars").
- genre: el género más cercano de la lista permitida.
- energy: 1 (muy tranquila, instrumental suave) a 5 (muy intensa, rápida, para bailar o saltar).
- moods: de 1 a 3 ambientes de la lista permitida que describan cómo se siente.
- themes: solo si la canción es claramente de una temporada o fecha (por ejemplo villancicos → navidad). Casi siempre lista vacía.
- restrictions: "explicita" si la letra tiene groserías o contenido sexual explícito; "tema-sensible" si trata de violencia, drogas o suicidio de forma central. Si no, lista vacía.
- confidence: "alta" si conoces bien la canción, "baja" si estás infiriendo por el título.
Usa únicamente valores de las listas permitidas. No inventes datos.`

function geminiText(data) {
  return (data.steps ?? [])
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

/** Sugiere título limpio, artista y etiquetas. Nunca confía en la salida: todo se filtra contra el vocabulario. */
export async function suggestSongTags({ videoTitle, channel }, { apiKey, model, vocabulary, fetchImpl = fetch, retryDelayMs = 1200 }) {
  if (!apiKey) throw new ServiceError(503, 'Falta GEMINI_API_KEY: llena las etiquetas a mano.')
  const enumOf = (list) => ({ type: 'string', enum: list.length ? list : [''] })
  const schema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      artist: { type: 'string' },
      genre: enumOf(vocabulary.genres),
      energy: { type: 'integer', minimum: 1, maximum: 5 },
      moods: { type: 'array', items: enumOf(vocabulary.moods), maxItems: 3 },
      themes: { type: 'array', items: enumOf(vocabulary.themes) },
      restrictions: { type: 'array', items: enumOf(vocabulary.restrictions) },
      confidence: { type: 'string', enum: ['alta', 'baja'] },
    },
    required: ['title', 'artist', 'genre', 'energy', 'moods', 'themes', 'restrictions', 'confidence'],
  }

  const request = () =>
    fetchImpl(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey, 'Api-Revision': '2026-05-20' },
      body: JSON.stringify({
        model: model || DEFAULT_TEXT_MODEL,
        system_instruction: TAGGER_INSTRUCTION,
        input: JSON.stringify({ titulo_del_video: String(videoTitle).slice(0, 200), canal: String(channel).slice(0, 100) }),
        store: false,
        generation_config: { thinking_level: 'low' },
        response_format: { type: 'text', mime_type: 'application/json', schema },
      }),
      signal: AbortSignal.timeout(25_000),
    })

  let response
  try {
    // Gemini a veces responde 503 ("saturado") por unos segundos: se reintenta antes de rendirse.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, retryDelayMs * attempt))
      response = await request()
      if (response.status !== 503) break
    }
  } catch (error) {
    throw new ServiceError(504, error.name === 'TimeoutError' ? 'Gemini tardó demasiado en sugerir etiquetas.' : 'No se pudo conectar con Gemini.')
  }
  if (response.status === 503) throw new ServiceError(503, 'Gemini está saturado en este momento. Reintenta en unos segundos.')
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new ServiceError(502, 'Gemini rechazó la API key. Revisa GEMINI_API_KEY.')
    if (response.status === 429) throw new ServiceError(429, 'Se agotó la cuota de Gemini. Llena las etiquetas a mano o espera un momento.')
    if (response.status === 404) throw new ServiceError(502, 'Modelo no disponible. Revisa GEMINI_MODEL.')
    const body = await response.json().catch(() => null)
    const detail = (Array.isArray(body) ? body[0] : body)?.error?.message ?? ''
    throw new ServiceError(502, `Gemini respondió ${response.status}${detail ? `: ${detail.slice(0, 200)}` : '.'}`)
  }

  let raw
  try {
    raw = JSON.parse(geminiText(await response.json()))
  } catch {
    throw new ServiceError(502, 'Gemini no devolvió una respuesta válida.')
  }
  const only = (list, allowed) => [...new Set((Array.isArray(list) ? list : []).filter((v) => allowed.includes(v)))]
  const energy = Number(raw.energy)
  return {
    title: String(raw.title ?? '').trim().slice(0, 120),
    artist: String(raw.artist ?? '').trim().slice(0, 120),
    genre: vocabulary.genres.includes(raw.genre) ? raw.genre : null,
    energy: Number.isInteger(energy) ? Math.min(5, Math.max(1, energy)) : null,
    moods: only(raw.moods, vocabulary.moods).slice(0, 3),
    themes: only(raw.themes, vocabulary.themes),
    restrictions: only(raw.restrictions, vocabulary.restrictions),
    confidence: raw.confidence === 'alta' ? 'alta' : 'baja',
  }
}

// --- Voz: Gemini TTS ----------------------------------------------------------------------

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions'
export const DEFAULT_TTS_MODEL = 'gemini-3.8-flash-lite-tts'

/** Duración de un WAV PCM leyendo su cabecera. */
export function wavDurationMs(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (offset) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  if (bytes.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let byteRate = 0
  let offset = 12
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    if (id === 'fmt ') byteRate = view.getUint32(offset + 16, true)
    // Algunos codificadores dejan el tamaño de "data" en 0 o al máximo cuando transmiten.
    if (id === 'data' && byteRate) {
      const length = size === 0 || size === 0xffffffff ? bytes.byteLength - offset - 8 : size
      return Math.round((length / byteRate) * 1000)
    }
    offset += 8 + size + (size % 2)
  }
  return null
}

/** Envuelve PCM de 16 bits en un WAV, por si el proveedor devuelve audio sin cabecera. */
export function pcmToWav(pcm, sampleRate = 24000) {
  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  const write = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  write(0, 'RIFF')
  view.setUint32(4, 36 + pcm.byteLength, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, pcm.byteLength, true)
  const out = new Uint8Array(44 + pcm.byteLength)
  out.set(new Uint8Array(header), 0)
  out.set(pcm, 44)
  return out
}

function base64ToBytes(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function synthesizeSpeech(text, { apiKey, model, voice = 'Kore', fetchImpl = fetch }) {
  if (!apiKey) throw new ServiceError(503, 'Falta configurar GEMINI_API_KEY: se usará la voz del navegador.')
  let response
  try {
    response = await fetchImpl(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        model: model || DEFAULT_TTS_MODEL,
        input: [
          {
            type: 'user_input',
            // Solo el texto a leer: cualquier instrucción extra el modelo la puede leer en voz alta.
            content: [{ type: 'text', text }],
          },
        ],
        response_format: { type: 'audio', mime_type: 'audio/wav' },
        generation_config: { speech_config: [{ voice }] },
        store: false,
      }),
      signal: AbortSignal.timeout(45_000),
    })
  } catch (error) {
    throw new ServiceError(504, error.name === 'TimeoutError' ? 'Gemini tardó demasiado en generar la voz.' : 'No se pudo conectar con Gemini.')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail = (Array.isArray(body) ? body[0] : body)?.error?.message ?? ''
    if (response.status === 401 || response.status === 403) throw new ServiceError(502, 'Gemini rechazó la API key. Revisa GEMINI_API_KEY.')
    if (response.status === 429) throw new ServiceError(429, 'Se agotó la cuota de Gemini. Inténtalo más tarde.')
    if (response.status === 404) throw new ServiceError(502, 'Modelo de voz no disponible. Revisa GEMINI_TTS_MODEL.')
    throw new ServiceError(502, `Gemini respondió ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`)
  }
  const data = await response.json()
  const audio = (data.steps ?? [])
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content ?? [])
    .findLast((block) => block.type === 'audio' && block.data)
  if (!audio) throw new ServiceError(502, 'Gemini no devolvió audio.')
  let wav = base64ToBytes(audio.data)
  if (String.fromCharCode(...wav.subarray(0, 4)) !== 'RIFF') wav = pcmToWav(wav)
  return { wav, durationMs: wavDurationMs(wav) ?? 0 }
}
