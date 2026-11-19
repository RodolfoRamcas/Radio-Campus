// Rutas HTTP de /api. Usa Request/Response estándar: corre igual en el Durable Object y en las pruebas.
import { cookie, createSession, hashIp, parseCookies, passwordMatches, randomId, sign, unsign, verifySession, SESSION_TTL_MS } from './auth.js'
import { HttpError } from './validate.js'
import { ServiceError } from './services.js'

const ADMIN_COOKIE = 'rc_admin'
const VOTER_COOKIE = 'rc_voter'
const COLLECTIONS = new Set(['songs', 'playlists', 'rules', 'events', 'announcements'])

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  })

async function readJson(request, maxBytes = 64 * 1024) {
  const text = await request.text()
  if (text.length > maxBytes) throw new HttpError(413, 'Petición demasiado grande.')
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'JSON no válido.')
  }
}

/**
 * @param {Request} request
 * @param {object} ctx
 * @param {import('./engine.js').RadioEngine} ctx.engine
 * @param {string} [ctx.adminPassword]
 * @param {string} [ctx.ip]
 */
export async function handleApi(request, { engine, adminPassword, ip = null }) {
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/api/, '') || '/'
  const method = request.method
  const secure = url.protocol === 'https:'
  const secret = engine.secret
  const cookies = parseCookies(request.headers.get('Cookie'))

  try {
    // Las escrituras solo se aceptan desde el mismo sitio (protección CSRF).
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = request.headers.get('Origin')
      if (origin && new URL(origin).host !== url.host) throw new HttpError(403, 'Origen no permitido.')
    }

    // --- Público ---------------------------------------------------------------------------
    if (method === 'GET' && path === '/health') return json({ ok: true, serverNow: engine.clock() })
    if (method === 'GET' && path === '/state') return json(engine.publicState())

    if (method === 'GET' && path === '/vote') {
      const voter = await unsign(secret, cookies[VOTER_COOKIE])
      const roundId = Number(url.searchParams.get('round'))
      return json({ choice: voter && roundId ? engine.myVote(roundId, voter) : null })
    }

    if (method === 'POST' && path === '/vote') {
      const body = await readJson(request, 1024)
      let voter = await unsign(secret, cookies[VOTER_COOKIE])
      const headers = {}
      if (!voter) {
        voter = randomId(16)
        headers['Set-Cookie'] = cookie(VOTER_COOKIE, await sign(secret, voter), { maxAge: 400 * 86400, secure, sameSite: 'Lax' })
      }
      const result = engine.vote({ roundId: Number(body.roundId), choice: Number(body.choice), voter, ipHash: await hashIp(secret, ip) })
      return json({ ok: true, ...result }, 200, headers)
    }

    const speechMatch = path.match(/^\/speech\/([a-z0-9]+)$/)
    if (method === 'GET' && speechMatch) {
      const wav = engine.getSpeech(speechMatch[1])
      if (!wav) throw new HttpError(404, 'Audio no encontrado.')
      return new Response(wav, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'public, max-age=86400' } })
    }

    const audioMatch = path.match(/^\/announcements\/([\w-]+)\/audio$/)
    if (method === 'GET' && audioMatch) {
      const wav = engine.getAudio(audioMatch[1])
      if (!wav) throw new HttpError(404, 'Este anuncio no tiene audio generado.')
      return new Response(wav, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'public, max-age=86400' } })
    }

    // --- Sesión ----------------------------------------------------------------------------
    if (path === '/admin/login' && method === 'POST') {
      if (!adminPassword) throw new HttpError(503, 'El panel no tiene contraseña configurada. Define ADMIN_PASSWORD en el servidor.')
      if (!engine.loginAllowed(ip)) throw new HttpError(429, 'Demasiados intentos. Espera 10 minutos.')
      const { password } = await readJson(request, 1024)
      if (!(await passwordMatches(secret, password, adminPassword))) {
        engine.loginFailed(ip)
        throw new HttpError(401, 'Contraseña incorrecta.')
      }
      engine.loginSucceeded(ip)
      engine.audit('inicio-sesion')
      const token = await createSession(secret, engine.clock())
      return json({ ok: true }, 200, {
        'Set-Cookie': cookie(ADMIN_COOKIE, token, { maxAge: SESSION_TTL_MS / 1000, secure, sameSite: 'Strict' }),
      })
    }
    if (path === '/admin/logout' && method === 'POST') {
      return json({ ok: true }, 200, { 'Set-Cookie': cookie(ADMIN_COOKIE, '', { maxAge: 0, secure, sameSite: 'Strict' }) })
    }

    if (path.startsWith('/admin')) {
      const authenticated = await verifySession(secret, cookies[ADMIN_COOKIE], engine.clock())
      if (path === '/admin/session') return json({ authenticated, configured: Boolean(adminPassword) })
      if (!authenticated) throw new HttpError(401, 'Inicia sesión para continuar.')
      return await adminRoute(request, path.slice('/admin'.length), url, engine)
    }

    throw new HttpError(404, 'Ruta no encontrada.')
  } catch (error) {
    if (error instanceof HttpError || error instanceof ServiceError) {
      return json({ error: error.message, ...(error.extra ?? {}) }, error.status)
    }
    console.error(error)
    return json({ error: 'Error interno del servidor.' }, 500)
  }
}

async function adminRoute(request, path, url, engine) {
  const method = request.method

  if (method === 'GET' && path === '/state') return json(engine.adminState())

  if (method === 'POST' && path === '/control') {
    const body = await readJson(request, 2048)
    switch (body.action) {
      case 'pause':
        engine.pause()
        break
      case 'resume':
        engine.resume()
        break
      case 'skip':
        engine.skip()
        break
      case 'close-round':
        engine.closeRoundNow()
        break
      case 'enqueue':
        engine.enqueueSong(body.songId, body.position)
        break
      case 'announce':
        engine.enqueueAnnouncement(body.announcementId)
        break
      case 'remove':
        engine.removeFromQueue(body.key)
        break
      case 'move':
        engine.moveInQueue(body.key, body.direction)
        break
      default:
        throw new HttpError(400, 'Acción desconocida.')
    }
    return json(engine.adminState())
  }

  if (method === 'POST' && path === '/songs/suggest') {
    if (!engine.services.suggest) throw new HttpError(503, 'La sugerencia con IA no está configurada.')
    const { videoTitle, channel } = await readJson(request, 2048)
    if (!videoTitle) throw new HttpError(400, 'Falta el título del video.')
    return json(await engine.services.suggest({ videoTitle, channel: channel ?? '' }, engine.config.tags))
  }

  const collection = path.match(/^\/(songs|playlists|rules|events|announcements)(?:\/([\w-]+))?$/)
  if (collection && COLLECTIONS.has(collection[1])) {
    const [, name, id] = collection
    if (method === 'GET' && !id) return json(engine.list(name))
    if ((method === 'POST' && !id) || (method === 'PUT' && id)) {
      const body = await readJson(request)
      const saved = engine.saveItem(name, { ...body, id: id ?? (name === 'songs' ? undefined : body.id) })
      // Un anuncio aprobado se convierte a voz en cuanto se guarda; si falla, se informa sin perder el texto.
      let audio = null
      if (name === 'announcements' && saved.approved) {
        audio = await engine.generateAudio(saved.id).catch((error) => ({ status: 'error', error: error.message }))
      }
      return json({ item: saved, audio })
    }
    if (method === 'DELETE' && id) {
      engine.deleteItem(name, id)
      return json({ ok: true })
    }
  }

  const audioMatch = path.match(/^\/announcements\/([\w-]+)\/audio$/)
  if (method === 'POST' && audioMatch) return json(await engine.generateAudio(audioMatch[1]))

  if (method === 'POST' && path === '/tts') {
    const { text, voice } = await readJson(request, 4096)
    if (!engine.services.speak) throw new HttpError(503, 'La síntesis de voz no está configurada.')
    const clean = String(text ?? '').trim().slice(0, 400)
    if (!clean) throw new HttpError(400, 'Escribe el texto del anuncio.')
    const { wav } = await engine.services.speak(clean, { voice: voice || engine.config.voice })
    return new Response(wav, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' } })
  }

  if (method === 'GET' && path === '/youtube') {
    if (!engine.services.youtube) throw new HttpError(503, 'La consulta a YouTube no está disponible.')
    const info = await engine.services.youtube(url.searchParams.get('url'))
    const existing = engine.getSong(`yt-${info.youtubeId}`)
    return json({ ...info, existing: existing && { id: existing.id, title: existing.title, artist: existing.artist } })
  }

  if (method === 'GET' && path === '/player-token') return json({ token: engine.playerToken })
  if (method === 'POST' && path === '/player-token') {
    engine.audit('nuevo-enlace-pantalla')
    return json({ token: engine.rotatePlayerToken() })
  }

  if (method === 'GET' && path === '/config') return json(engine.config)
  if (method === 'PUT' && path === '/config') {
    const before = engine.config.campus
    const saved = engine.saveConfig(await readJson(request))
    // Si cambió la ubicación, la temperatura nueva se consulta de inmediato.
    if (before.latitude !== saved.campus.latitude || before.longitude !== saved.campus.longitude) {
      await engine.refreshWeather({ force: true })
    }
    return json(saved)
  }
  if (method === 'GET' && path === '/places') {
    if (!engine.services.places) throw new HttpError(503, 'El buscador de ciudades no está disponible.')
    return json(await engine.services.places(url.searchParams.get('q')))
  }

  if (method === 'POST' && path === '/simulate') return json(engine.simulate(await readJson(request, 2048)))
  if (method === 'GET' && path === '/history') return json(engine.history({ limit: Math.min(200, Number(url.searchParams.get('limit')) || 50) }))
  if (method === 'GET' && path === '/stats') return json(engine.stats({ days: Math.min(365, Number(url.searchParams.get('days')) || 30) }))

  if (method === 'GET' && path === '/backup') {
    const date = new Date(engine.clock()).toISOString().slice(0, 10)
    return json(engine.exportBackup(), 200, { 'Content-Disposition': `attachment; filename="radio-campus-respaldo-${date}.json"` })
  }
  if (method === 'POST' && path === '/restore') return json(engine.importBackup(await readJson(request, 2 * 1024 * 1024)))
  if (method === 'POST' && path === '/reset-demo') {
    engine.loadDemoData()
    engine.audit('datos-ejemplo')
    return json({ ok: true })
  }
  if (method === 'POST' && path === '/weather/refresh') {
    await engine.refreshWeather({ force: true })
    return json(engine.adminState().weather)
  }

  throw new HttpError(404, 'Ruta no encontrada.')
}
