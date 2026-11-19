import test from 'node:test'
import assert from 'node:assert/strict'
import { handleApi } from '../server/api.js'
import { lookupYouTube, parseYouTubeId, pcmToWav, synthesizeSpeech, wavDurationMs } from '../server/services.js'
import { makeEngine } from './helpers.js'

async function setup() {
  const { engine, clock } = makeEngine()
  engine.saveConfig({ announcementEverySong: false, songIntros: false })
  await engine.tick()
  const call = (path, { method = 'GET', body, cookie, origin, ip = '1.2.3.4' } = {}) => {
    const headers = new Headers()
    if (cookie) headers.set('Cookie', cookie)
    if (origin) headers.set('Origin', origin)
    return handleApi(new Request(`https://radio.example/api${path}`, { method, headers, body: body && JSON.stringify(body) }), {
      engine,
      adminPassword: 'clave-segura',
      ip,
    })
  }
  return { engine, clock, call }
}

const cookieFrom = (response) => response.headers.get('Set-Cookie').split(';')[0]

test('estado público sin sesión; panel con sesión', async () => {
  const { call } = await setup()
  assert.equal((await call('/state')).status, 200)
  assert.equal((await call('/admin/state')).status, 401)
  assert.equal((await call('/admin/songs')).status, 401)
  assert.deepEqual(await (await call('/admin/session')).json(), { authenticated: false, configured: true })
})

test('inicio de sesión, cookie segura y límite de intentos', async () => {
  const { call } = await setup()
  assert.equal((await call('/admin/login', { method: 'POST', body: { password: 'otra' } })).status, 401)
  const ok = await call('/admin/login', { method: 'POST', body: { password: 'clave-segura' } })
  assert.equal(ok.status, 200)
  const setCookie = ok.headers.get('Set-Cookie')
  assert.match(setCookie, /HttpOnly/)
  assert.match(setCookie, /Secure/)
  assert.match(setCookie, /SameSite=Strict/)
  assert.equal((await call('/admin/state', { cookie: cookieFrom(ok) })).status, 200)

  for (let i = 0; i < 5; i++) await call('/admin/login', { method: 'POST', body: { password: 'x' }, ip: '9.9.9.9' })
  assert.equal((await call('/admin/login', { method: 'POST', body: { password: 'clave-segura' }, ip: '9.9.9.9' })).status, 429)
})

test('una cookie de sesión alterada no sirve', async () => {
  const { call } = await setup()
  const ok = await call('/admin/login', { method: 'POST', body: { password: 'clave-segura' } })
  const forged = cookieFrom(ok).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))
  assert.equal((await call('/admin/state', { cookie: forged })).status, 401)
})

test('votar asigna una cookie de votante y evita el doble voto', async () => {
  const { engine, call } = await setup()
  const roundId = engine.state.round.id
  const first = await call('/vote', { method: 'POST', body: { roundId, choice: 0 } })
  assert.equal(first.status, 200)
  const voter = cookieFrom(first)
  const again = await call('/vote', { method: 'POST', body: { roundId, choice: 1 }, cookie: voter })
  assert.equal(again.status, 409)
  assert.equal((await again.json()).choice, 0)
  assert.deepEqual(await (await call(`/vote?round=${roundId}`, { cookie: voter })).json(), { choice: 0 })
})

test('rechaza escrituras desde otro origen', async () => {
  const { engine, call } = await setup()
  const response = await call('/vote', { method: 'POST', body: { roundId: engine.state.round.id, choice: 0 }, origin: 'https://malicioso.example' })
  assert.equal(response.status, 403)
})

test('CRUD de canciones desde el panel', async () => {
  const { call } = await setup()
  const cookie = cookieFrom(await call('/admin/login', { method: 'POST', body: { password: 'clave-segura' } }))
  const created = await call('/admin/songs', {
    method: 'POST',
    cookie,
    body: { youtubeId: 'https://youtu.be/9bZkp7q19f0', title: 'Gangnam Style', artist: 'PSY', duration: 252, genre: 'Pop', energy: 5, moods: ['Festiva'] },
  })
  assert.equal(created.status, 200)
  const { item } = await created.json()
  assert.equal(item.id, 'yt-9bZkp7q19f0')
  assert.equal(item.genre, 'pop')
  assert.deepEqual(item.moods, ['festiva'])
  assert.equal((await call(`/admin/songs/${item.id}`, { method: 'DELETE', cookie })).status, 200)
  assert.equal((await call('/admin/songs', { method: 'POST', cookie, body: { title: 'sin video' } })).status, 400)
})

test('anuncio aprobado sin clave de Gemini: se guarda e informa que usará la voz del navegador', async () => {
  const { engine, call } = await setup()
  engine.services.speak = (text, opts) => synthesizeSpeech(text, { ...opts, apiKey: undefined })
  const cookie = cookieFrom(await call('/admin/login', { method: 'POST', body: { password: 'clave-segura' } }))
  const response = await call('/admin/announcements', { method: 'POST', cookie, body: { title: 'Prueba', text: 'Hola campus', approved: true } })
  const data = await response.json()
  assert.equal(response.status, 200)
  assert.equal(data.audio.status, 'error')
  assert.match(data.audio.error, /voz del navegador/)
})

test('reconoce enlaces de YouTube', () => {
  for (const input of ['dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3', 'https://youtu.be/dQw4w9WgXcQ', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ']) {
    assert.equal(parseYouTubeId(input), 'dQw4w9WgXcQ', input)
  }
  assert.equal(parseYouTubeId('https://vimeo.com/123'), null)
})

test('oEmbed distingue videos bloqueados para embeber', async () => {
  const fake = (status) => async () => new Response(status === 200 ? JSON.stringify({ title: 'T', author_name: 'A' }) : 'x', { status })
  assert.deepEqual((await lookupYouTube('dQw4w9WgXcQ', fake(200))).title, 'T')
  await assert.rejects(lookupYouTube('dQw4w9WgXcQ', fake(401)), /no permite/)
  await assert.rejects(lookupYouTube('dQw4w9WgXcQ', fake(404)), /no existe/)
})

test('Gemini TTS: arma la petición y lee el audio de la respuesta', async () => {
  const pcm = new Uint8Array(48000) // 1 segundo a 24 kHz, 16 bits
  const wav = pcmToWav(pcm)
  assert.equal(wavDurationMs(wav), 1000)
  let sent
  const fetchImpl = async (url, init) => {
    sent = { url, body: JSON.parse(init.body), key: init.headers['x-goog-api-key'] }
    const data = Buffer.from(wav).toString('base64')
    return Response.json({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'audio', data }] }] })
  }
  const result = await synthesizeSpeech('Hola', { apiKey: 'k', voice: 'Puck', fetchImpl })
  assert.equal(result.durationMs, 1000)
  assert.equal(sent.key, 'k')
  assert.deepEqual(sent.body.generation_config.speech_config, [{ voice: 'Puck' }])
  assert.equal(sent.body.response_format.type, 'audio')

  const raw = await synthesizeSpeech('Hola', {
    apiKey: 'k',
    fetchImpl: async () => Response.json({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: Buffer.from(pcm).toString('base64') }] }] }),
  })
  assert.equal(raw.durationMs, 1000, 'PCM sin cabecera se envuelve en WAV')
  await assert.rejects(synthesizeSpeech('x', { apiKey: 'k', fetchImpl: async () => Response.json({}, { status: 429 }) }), /cuota/)
})

test('autollenado: duración, título y etiquetas sugeridas', async () => {
  const { fetchYouTubeDuration, suggestSongTags } = await import('../server/services.js')
  const { guessFromVideoTitle, parseDuration } = await import('../src/shared/youtube.js')

  assert.equal(parseDuration('3:25'), 205)
  assert.equal(parseDuration('205'), 205)
  assert.equal(parseDuration('3:75'), null)
  assert.deepEqual(guessFromVideoTitle('Maroon 5 - This Love (Official Music Video)', 'Maroon5VEVO'), { artist: 'Maroon 5', title: 'This Love' })
  assert.deepEqual(guessFromVideoTitle('Paradise', 'ColdplayVEVO'), { artist: 'Coldplay', title: 'Paradise' })

  const page = async () => new Response('<script>var x = {"videoDetails":{"lengthSeconds":"205"}}</script>')
  assert.equal(await fetchYouTubeDuration('XPpTgCho5ZA', page), 205)
  assert.equal(await fetchYouTubeDuration('XPpTgCho5ZA', async () => new Response('sin datos')), null)
  assert.equal(await fetchYouTubeDuration('XPpTgCho5ZA', async () => { throw new Error('red') }), null)

  // La salida del modelo se filtra contra el vocabulario: nada inventado pasa.
  const vocabulary = { genres: ['pop', 'rock'], moods: ['alegre', 'bailable'], themes: ['navidad'], restrictions: ['explicita'] }
  const answer = { title: ' This Love ', artist: 'Maroon 5', genre: 'funk', energy: 9, moods: ['alegre', 'inventado'], themes: [], restrictions: ['explicita'], confidence: 'alta' }
  const fetchImpl = async () => Response.json({ steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(answer) }] }] })
  const s = await suggestSongTags({ videoTitle: 'Maroon 5 - This Love', channel: 'Maroon5VEVO' }, { apiKey: 'k', vocabulary, fetchImpl })
  assert.deepEqual(s, { title: 'This Love', artist: 'Maroon 5', genre: null, energy: 5, moods: ['alegre'], themes: [], restrictions: ['explicita'], confidence: 'alta' })
  await assert.rejects(suggestSongTags({ videoTitle: 'x' }, { apiKey: '', vocabulary }), /GEMINI_API_KEY/)
})

test('la consulta de YouTube avisa si la canción ya está en el catálogo', async () => {
  const { engine, call } = await setup()
  engine.services.youtube = async (id) => ({ youtubeId: id, title: 'Never Gonna Give You Up', channel: 'Rick Astley', duration: 213 })
  const cookie = cookieFrom(await call('/admin/login', { method: 'POST', body: { password: 'clave-segura' } }))
  const data = await (await call('/admin/youtube?url=dQw4w9WgXcQ', { cookie })).json()
  assert.equal(data.existing.id, 'yt-dQw4w9WgXcQ')
  assert.equal((await call('/admin/songs/suggest', { method: 'POST', cookie, body: { videoTitle: 'x' } })).status, 503)
})

test('si Gemini está saturado, reintenta antes de rendirse', async () => {
  const { suggestSongTags } = await import('../server/services.js')
  const vocabulary = { genres: ['pop'], moods: ['alegre'], themes: [], restrictions: [] }
  const ok = { title: 'Sugar', artist: 'Maroon 5', genre: 'pop', energy: 4, moods: ['alegre'], themes: [], restrictions: [], confidence: 'alta' }
  let calls = 0
  const flaky = async () => (++calls < 3 ? new Response('{}', { status: 503 }) : Response.json({ steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(ok) }] }] }))
  assert.equal((await suggestSongTags({ videoTitle: 'x' }, { apiKey: 'k', vocabulary, fetchImpl: flaky, retryDelayMs: 1 })).title, 'Sugar')
  assert.equal(calls, 3)
  await assert.rejects(
    suggestSongTags({ videoTitle: 'x' }, { apiKey: 'k', vocabulary, fetchImpl: async () => new Response('{}', { status: 503 }), retryDelayMs: 1 }),
    /saturado/,
  )
})
