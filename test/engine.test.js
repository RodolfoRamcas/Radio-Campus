import test from 'node:test'
import assert from 'node:assert/strict'
import { makeEngine } from './helpers.js'

/** Por defecto, sin anuncio obligatorio ni presentaciones: las pruebas de rondas van canción tras canción. */
async function started({ features = false, ...options } = {}) {
  const setup = makeEngine(options)
  if (!features) setup.engine.saveConfig({ announcementEverySong: false, songIntros: false, minSongsBetweenAnnouncements: 2 })
  await setup.engine.tick()
  return setup
}

test('al arrancar suena una canción y se abre una ronda con dos opciones', async () => {
  const { engine } = await started()
  const state = engine.publicState()
  assert.equal(state.nowPlaying.kind, 'song')
  assert.equal(state.round.status, 'open')
  assert.equal(state.round.options.length, 2)
  assert.ok(!state.round.options.some((o) => o.id === state.nowPlaying.song.id))
  assert.ok(state.round.closesAt < state.nowPlaying.endsAt)
})

test('un dispositivo vota una vez por ronda; el conteo lo hace el servidor', async () => {
  const { engine } = await started()
  const roundId = engine.state.round.id
  engine.vote({ roundId, choice: 1, voter: 'a', ipHash: 'x' })
  engine.vote({ roundId, choice: 1, voter: 'b', ipHash: 'x' })
  engine.vote({ roundId, choice: 0, voter: 'c', ipHash: 'y' })
  assert.throws(() => engine.vote({ roundId, choice: 0, voter: 'a', ipHash: 'x' }), (e) => e.status === 409 && e.extra.choice === 1)
  assert.throws(() => engine.vote({ roundId, choice: 5, voter: 'd' }), (e) => e.status === 400)
  assert.throws(() => engine.vote({ roundId: roundId + 1, choice: 0, voter: 'd' }), (e) => e.status === 409)
  assert.equal(engine.publicState().round.totalVotes, 3)
  assert.equal(engine.publicState().round.counts, null, 'los conteos no se muestran antes del cierre')
  assert.deepEqual(engine.adminState().liveCounts, [1, 2])
})

test('el límite por red es configurable', async () => {
  const { engine } = await started()
  engine.saveConfig({ maxVotesPerIp: 1 })
  const roundId = engine.state.round.id
  engine.vote({ roundId, choice: 0, voter: 'a', ipHash: 'red' })
  assert.throws(() => engine.vote({ roundId, choice: 0, voter: 'b', ipHash: 'red' }), (e) => e.status === 429)
})

test('la ronda cierra por reloj del servidor y la ganadora suena después', async () => {
  const { engine, clock } = await started()
  const round = engine.state.round
  engine.vote({ roundId: round.id, choice: 1, voter: 'a' })
  clock.advance(round.closesAt - clock())
  assert.throws(() => engine.vote({ roundId: round.id, choice: 0, voter: 'b' }), (e) => e.status === 409)
  await engine.tick()
  const state = engine.publicState()
  assert.equal(state.round.status, 'closed')
  assert.deepEqual(state.round.counts, [0, 1])
  assert.equal(state.round.winnerSong.id, round.options[1])
  assert.equal(state.upNext.id, round.options[1])

  clock.advance(engine.state.now.endsAt - clock())
  await engine.tick()
  assert.equal(engine.publicState().nowPlaying.song.id, round.options[1])
  assert.equal(engine.state.round.status, 'open', 'se abre la siguiente ronda')
})

test('sin reproductor la programación avanza sola; con reproductor espera su aviso', async () => {
  const { engine, clock } = await started()
  const first = engine.state.now.playId
  engine.setPlayerConnected(true)
  engine.playerEvent({ type: 'playing', playId: first, duration: 200, currentTime: 0 })
  assert.equal(engine.state.now.endsAt, clock() + 200_000, 'la duración real ajusta el final')
  clock.advance(201_000)
  engine.playerEvent({ type: 'heartbeat', playId: first })
  await engine.tick()
  assert.equal(engine.state.now.playId, first, 'todavía hay margen para que llegue el evento "ended"')
  engine.playerEvent({ type: 'ended', playId: first })
  assert.notEqual(engine.state.now.playId, first)
})

test('los eventos de una reproducción anterior se ignoran', async () => {
  const { engine } = await started()
  const current = engine.state.now.playId
  assert.equal(engine.playerEvent({ type: 'ended', playId: current - 1 }), false)
  assert.equal(engine.state.now.playId, current)
})

test('si una canción falla se salta; si fallan varias seguidas se pausa', async () => {
  const { engine } = await started()
  const failing = engine.state.now.songId
  engine.playerEvent({ type: 'error', playId: engine.state.now.playId, message: 'Video no disponible' })
  assert.notEqual(engine.state.now.songId, failing)
  assert.equal(engine.getSong(failing).errorCount, 1)
  for (let i = 0; i < 3; i++) engine.playerEvent({ type: 'error', playId: engine.state.now.playId, message: 'Sin conexión' })
  assert.equal(engine.state.paused, true)
  assert.match(engine.state.pauseReason, /seguidas fallaron/)
})

test('pausar congela temporizadores; reanudar los recorre', async () => {
  const { engine, clock } = await started()
  const { closesAt } = engine.state.round
  const { endsAt } = engine.state.now
  engine.pause()
  clock.advance(60_000)
  assert.equal(engine.step(), false)
  assert.throws(() => engine.vote({ roundId: engine.state.round.id, choice: 0, voter: 'a' }), (e) => e.status === 409)
  engine.resume()
  assert.equal(engine.state.round.closesAt, closesAt + 60_000)
  assert.equal(engine.state.now.endsAt, endsAt + 60_000)
})

test('una canción en cola manual suena antes y suspende la votación', async () => {
  const { engine, clock } = await started()
  engine.closeRoundNow()
  const winner = engine.state.round.winnerSongId
  engine.enqueueSong('yt-dQw4w9WgXcQ', 'next')
  assert.deepEqual(engine.state.queue.map((q) => q.songId), ['yt-dQw4w9WgXcQ', winner])

  const finish = async () => {
    engine.state.songsSinceAnnouncement = 0 // sin anuncios en medio, para esta prueba
    clock.advance(engine.state.now.endsAt - clock())
    await engine.tick()
  }
  await finish()
  assert.equal(engine.state.now.songId, 'yt-dQw4w9WgXcQ')
  assert.equal(engine.state.round.status, 'closed', 'la ganadora sigue en cola: no se abre otra ronda')
  await finish()
  assert.equal(engine.state.now.songId, winner)
  assert.equal(engine.state.round.status, 'open', 'la cola quedó vacía: vuelve a haber ronda')
})

test('los anuncios suenan entre canciones, nunca encima, y no se repiten antes de su frecuencia', async () => {
  const { engine, clock } = await started()
  engine.state.songsSinceAnnouncement = 5
  clock.advance(engine.state.now.endsAt - clock())
  await engine.tick()
  assert.equal(engine.state.now.kind, 'announcement')
  assert.equal(engine.state.round.status, 'closed', 'la ronda se cerró antes del anuncio')
  const announcementId = engine.state.now.announcementId
  clock.advance(engine.state.now.endsAt - clock())
  await engine.tick()
  assert.equal(engine.state.now.kind, 'song')

  engine.state.songsSinceAnnouncement = 5
  clock.advance(engine.state.now.endsAt - clock())
  await engine.tick()
  if (engine.state.now.kind === 'announcement') assert.notEqual(engine.state.now.announcementId, announcementId)
})

test('un anuncio vencido o sin aprobar no se puede programar', async () => {
  const { engine } = await started()
  assert.throws(() => engine.enqueueAnnouncement('a-calificaciones'), (e) => e.status === 409)
  const expired = engine.saveItem('announcements', { title: 'Viejo', text: 'Ya pasó', approved: true, endsAt: '2026-01-01T00:00' })
  assert.throws(() => engine.enqueueAnnouncement(expired.id), /vencido/)
})

test('la voz se genera una vez por texto y se descarta al cambiarlo', async () => {
  let calls = 0
  const wav = new Uint8Array(100)
  const { engine } = await started({ services: { speak: async () => (calls++, { wav, durationMs: 3000 }) } })
  await engine.generateAudio('a-vota')
  await engine.generateAudio('a-vota')
  assert.equal(calls, 1)
  assert.ok(engine.getAudio('a-vota'))
  const a = engine.list('announcements').find((x) => x.id === 'a-vota')
  engine.saveItem('announcements', { ...a, text: 'Texto nuevo' })
  assert.equal(engine.getAudio('a-vota'), null)
})

test('valida lo que llega del panel', async () => {
  const { engine } = await started()
  assert.throws(() => engine.saveItem('songs', { youtubeId: 'no', title: 'x', artist: 'y', duration: 100, genre: 'pop', energy: 3 }), /YouTube/)
  assert.throws(() => engine.saveItem('songs', { youtubeId: 'dQw4w9WgXcQ', title: 'x', artist: 'y', duration: 100, genre: 'pop', energy: 3 }), /ya está/)
  assert.throws(() => engine.saveItem('rules', { name: 'r', priority: 200, when: { type: 'siempre' } }), /prioridad/i)
  assert.throws(() => engine.saveItem('events', { name: 'e', type: 'festividad', startDate: '2026-12-10', endDate: '2026-12-01' }), /posterior/)
  assert.throws(() => engine.deleteItem('playlists', 'pl-respaldo'), /respaldo/)
  assert.throws(() => engine.saveConfig({ campus: { name: 'X', latitude: 0, longitude: 0, timezone: 'Marte/Olympus' } }), /Zona horaria/)
})

test('el respaldo exporta e importa todo el catálogo y la configuración', async () => {
  const { engine } = await started()
  engine.saveConfig({ roundSeconds: 75 })
  const backup = JSON.parse(JSON.stringify(engine.exportBackup()))
  engine.deleteItem('songs', 'yt-dQw4w9WgXcQ')
  engine.saveConfig({ roundSeconds: 200 })
  const result = engine.importBackup(backup)
  assert.equal(result.songs, backup.songs.length)
  assert.ok(engine.getSong('yt-dQw4w9WgXcQ'))
  assert.equal(engine.config.roundSeconds, 75)
  assert.throws(() => engine.importBackup({ foo: 1 }), /respaldo/)
})

test('el estado sobrevive a un reinicio del servidor', async () => {
  const { engine, db, clock } = await started()
  engine.vote({ roundId: engine.state.round.id, choice: 0, voter: 'a' })
  const { RadioEngine } = await import('../server/engine.js')
  const restarted = new RadioEngine({ db, clock, sessionSecret: 's' })
  restarted.init()
  assert.equal(restarted.state.now.playId, engine.state.now.playId)
  assert.equal(restarted.publicState().round.totalVotes, 1)
})

test('estadísticas e historial', async () => {
  const { engine, clock } = await started()
  engine.vote({ roundId: engine.state.round.id, choice: 0, voter: 'a' })
  clock.advance(engine.state.round.closesAt - clock())
  await engine.tick()
  const stats = engine.stats()
  assert.equal(stats.rounds, 1)
  assert.equal(stats.votes, 1)
  assert.equal(stats.byHour[10], 1, 'voto a las 10 de la mañana, hora del campus')
  assert.equal(engine.history().rounds[0].resolution, 'votos')
})

test('si el clima no responde, la ronda se arma con la selección de respaldo', async () => {
  const { engine } = await started({ temperature: null })
  assert.equal(engine.state.round.trace.fallback, 'dato-faltante')
  assert.equal(engine.publicState().context.fallback, 'dato-faltante')
})

test('solo el token vigente permite tomar el audio, y se puede rotar', async () => {
  const { engine } = await started()
  const first = engine.playerToken
  assert.ok(engine.isPlayerToken(first))
  assert.equal(engine.isPlayerToken(''), false)
  assert.equal(engine.isPlayerToken(null), false)
  engine.rotatePlayerToken()
  assert.equal(engine.isPlayerToken(first), false, 'el enlace anterior deja de servir')
})

test('los latidos del reproductor no escriben en cada mensaje', async () => {
  const { engine, db, clock } = await started()
  engine.setPlayerConnected(true)
  const writes = () => db.get("SELECT value FROM kv WHERE key = 'state'").value
  const before = writes()
  clock.advance(15_000)
  engine.playerEvent({ type: 'heartbeat', playId: engine.state.now.playId })
  assert.equal(writes(), before)
  clock.advance(61_000)
  engine.playerEvent({ type: 'heartbeat', playId: engine.state.now.playId })
  assert.notEqual(writes(), before)
})

test('con presentaciones y anuncio obligatorio: canción → anuncio → presentación → canción', async () => {
  const { engine, clock } = await started({ features: true })
  // Al arrancar, la primera canción también se presenta.
  assert.equal(engine.state.now.kind, 'intro')
  const firstSong = engine.state.now.songId
  clock.advance(engine.state.now.endsAt - clock())
  await engine.tick()
  assert.equal(engine.state.now.kind, 'song')
  assert.equal(engine.state.now.songId, firstSong)
  assert.equal(engine.state.round.status, 'open', 'la ronda se abre cuando empieza la canción, no durante la presentación')

  const seen = []
  for (let i = 0; i < 4; i++) {
    const round = engine.state.round
    engine.vote({ roundId: round.id, choice: 1, voter: `v${i}` })
    clock.advance(engine.state.now.endsAt - clock())
    await engine.tick()
    assert.equal(engine.state.now.kind, 'announcement', `ronda ${i}: después de cada canción hay un anuncio`)
    seen.push(engine.state.now.announcementId)
    assert.ok(engine.publicState().upNext, 'la siguiente canción ya está decidida durante el anuncio')
    clock.advance(engine.state.now.endsAt - clock())
    await engine.tick()
    assert.equal(engine.state.now.kind, 'intro')
    assert.equal(engine.state.now.songId, round.winnerSongId)
    assert.match(engine.publicState().nowPlaying.text, /Ustedes lo eligieron/)
    clock.advance(engine.state.now.endsAt - clock())
    await engine.tick()
    assert.equal(engine.state.now.kind, 'song')
    assert.equal(engine.state.now.songId, round.winnerSongId)
  }
  // Hay 3 anuncios vigentes en los datos de ejemplo: rotan aunque su frecuencia no se haya cumplido.
  assert.ok(new Set(seen).size >= 2, seen.join())
})

test('saltar una presentación lleva directo a su canción', async () => {
  const { engine } = await started({ features: true })
  const songId = engine.state.now.songId
  engine.skip()
  assert.equal(engine.state.now.kind, 'song')
  assert.equal(engine.state.now.songId, songId)
})

test('la voz de la presentación se genera una vez y se reutiliza', async () => {
  let calls = 0
  const services = { ttsConfigured: true, speak: async () => (calls++, { wav: new Uint8Array(64), durationMs: 3000 }) }
  const { engine, clock } = await started({ features: true, services })
  // Lo pendiente: la presentación que está sonando sin audio y la de la próxima canción en cola.
  const pending = engine.pendingSpeech()
  assert.ok(pending.length >= 1)
  for (const p of pending) await engine.generateSpeech(p.text, p.voice)
  await engine.generateSpeech(pending[0].text, pending[0].voice)
  assert.equal(calls, pending.length)
  // Cuando esa canción vuelva a presentarse, ya trae audio.
  const text = pending[0].text
  const info = engine.speechInfo(text, engine.config.voice)
  assert.equal(info.durationMs, 3000)
  assert.ok(engine.getSpeech(info.hash))
  void clock
})

test('el conteo de reproducciones sale de play_stats y coincide con el historial', async () => {
  const { engine, db, clock } = await started()
  // Varias canciones completas, una fallida y algunos anuncios entre medio.
  for (let i = 0; i < 12; i++) {
    clock.advance(10 * 60_000)
    engine.step()
  }
  engine.playerEvent({ type: 'error', playId: engine.state.now.playId, message: 'Video no disponible' })
  const fromHistory = Object.fromEntries(
    db.all("SELECT ref_id, COUNT(*) AS n FROM plays WHERE kind = 'song' AND status != 'error' GROUP BY ref_id").map((r) => [r.ref_id, r.n]),
  )
  const counts = Object.fromEntries(Object.entries(engine.playCounts()).filter(([, n]) => n > 0))
  assert.deepEqual(counts, fromHistory)

  // Una base que ya tenía historial antes de existir play_stats se llena al migrar.
  db.run('DELETE FROM play_stats')
  db.run("DELETE FROM kv WHERE key = 'schemaVersion'")
  const { RadioEngine } = await import('../server/engine.js')
  const restarted = new RadioEngine({ db, clock, sessionSecret: 's' })
  restarted.init()
  assert.deepEqual(Object.fromEntries(Object.entries(restarted.playCounts()).filter(([, n]) => n > 0)), fromHistory)
})
