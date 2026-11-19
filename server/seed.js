// Catálogo y configuración de ejemplo. Se cargan solo la primera vez (base de datos vacía)
// o al pulsar "Restablecer datos de ejemplo" en el panel.
// Todos los videos se comprobaron con el oEmbed de YouTube: existen y permiten reproducirse embebidos.

// [youtubeId, título, artista, segundos, género, energía 1–5, ambientes, temáticas, restricciones]
const SONGS = [
  ['dQw4w9WgXcQ', 'Never Gonna Give You Up', 'Rick Astley', 213, 'pop', 4, ['alegre', 'bailable'], [], []],
  ['JGwWNGJdvx8', 'Shape of You', 'Ed Sheeran', 263, 'pop', 3, ['bailable', 'romántica'], [], []],
  ['2Vv-BfVoq4g', 'Perfect', 'Ed Sheeran', 282, 'pop', 2, ['romántica', 'tranquila'], ['amor-y-amistad'], []],
  ['fJ9rUzIMcZQ', 'Bohemian Rhapsody', 'Queen', 359, 'rock', 3, ['intensa'], [], []],
  ['hTWKbfoikeg', 'Smells Like Teen Spirit', 'Nirvana', 278, 'rock', 5, ['intensa'], [], []],
  ['OPf0YbXqDm0', 'Uptown Funk', 'Mark Ronson ft. Bruno Mars', 270, 'funk', 5, ['festiva', 'bailable'], [], []],
  ['60ItHLz5WEA', 'Faded', 'Alan Walker', 213, 'electrónica', 3, ['melancólica', 'concentración'], [], []],
  ['YQHsXMglC9A', 'Hello', 'Adele', 367, 'pop', 2, ['melancólica'], [], []],
  ['rYEDA3JcQqw', 'Rolling in the Deep', 'Adele', 234, 'pop', 3, ['intensa'], [], []],
  ['hT_nvWreIhg', 'Counting Stars', 'OneRepublic', 283, 'pop', 4, ['motivadora', 'alegre'], [], []],
  ['nfWlot6h_JM', 'Shake It Off', 'Taylor Swift', 242, 'pop', 5, ['alegre', 'bailable'], [], []],
  ['4fndeDfaWCg', 'I Want It That Way', 'Backstreet Boys', 219, 'pop', 3, ['romántica'], ['amor-y-amistad'], []],
  ['1G4isv_Fylg', 'Paradise', 'Coldplay', 260, 'pop', 3, ['tranquila', 'melancólica'], [], []],
  ['yKNxeF4KMsY', 'Yellow', 'Coldplay', 272, 'rock', 2, ['tranquila', 'romántica'], [], []],
  ['dvgZkm1xWPE', 'Viva La Vida', 'Coldplay', 242, 'pop', 4, ['motivadora'], [], []],
  ['Zi_XLOBDo_Y', 'Billie Jean', 'Michael Jackson', 296, 'pop', 4, ['bailable'], [], []],
  ['btPJPFnesV4', 'Eye of the Tiger', 'Survivor', 245, 'rock', 5, ['motivadora'], [], []],
  ['lDK9QqIzhwk', "Livin' On A Prayer", 'Bon Jovi', 249, 'rock', 5, ['motivadora', 'festiva'], [], []],
  ['ZbZSe6N_BXs', 'Happy', 'Pharrell Williams', 241, 'pop', 4, ['alegre'], ['bienvenida'], []],
  ['gGdGFtwCNBE', 'Mr. Brightside', 'The Killers', 228, 'rock', 5, ['intensa'], [], []],
  ['ru0K8uYEZWw', "Can't Stop the Feeling!", 'Justin Timberlake', 286, 'pop', 5, ['alegre', 'bailable'], ['bienvenida'], []],
  ['JRfuAukYTKg', 'Titanium', 'David Guetta ft. Sia', 245, 'electrónica', 4, ['motivadora'], [], []],
  ['TUVcZfQe-Kw', 'Levitating', 'Dua Lipa', 230, 'pop', 4, ['bailable', 'alegre'], [], []],
  ['7wtfhZwyrcc', 'Believer', 'Imagine Dragons', 217, 'rock', 5, ['motivadora', 'intensa'], [], []],
  ['eVTXPUF4Oz4', 'In The End', 'Linkin Park', 218, 'rock', 4, ['intensa', 'melancólica'], [], []],
  ['6Ejga4kJUts', 'Zombie', 'The Cranberries', 307, 'rock', 4, ['intensa', 'melancólica'], [], ['tema-sensible']],
  ['QK8mJJJvaes', 'Thrift Shop', 'Macklemore & Ryan Lewis', 233, 'pop', 4, ['alegre'], [], ['explicita']],
  ['Cr8K88UcO0s', 'Tití Me Preguntó', 'Bad Bunny', 290, 'reguetón', 5, ['bailable', 'festiva'], [], ['explicita']],
  ['kJQP7kiw5Fk', 'Despacito', 'Luis Fonsi ft. Daddy Yankee', 282, 'reguetón', 4, ['bailable', 'romántica'], [], []],
  ['TapXs54Ah3E', 'Ay Vamos', 'J Balvin', 267, 'reguetón', 3, ['bailable'], [], []],
  ['pRpeEdMmmQ0', 'Waka Waka (This Time for Africa)', 'Shakira', 211, 'pop latino', 5, ['festiva', 'motivadora'], ['bienvenida'], []],
  ['-UV0QGLmYys', 'La Bicicleta', 'Carlos Vives y Shakira', 238, 'pop latino', 4, ['alegre', 'bailable'], [], []],
  ['kRt2sRyup6A', 'La Camisa Negra', 'Juanes', 247, 'pop latino', 3, ['alegre'], [], []],
  ['IKmPci5VXz0', 'Hasta la Raíz', 'Natalia Lafourcade', 221, 'pop latino', 2, ['tranquila', 'romántica'], [], []],
  ['WT-VE9OyAJk', 'Tu Falta de Querer', 'Mon Laferte', 279, 'pop latino', 2, ['melancólica'], [], []],
  ['98Akpf1ph2o', 'Eres', 'Café Tacvba', 264, 'rock en español', 2, ['romántica', 'tranquila'], ['amor-y-amistad'], []],
  ['1IgOZaQqB58', 'Labios Compartidos', 'Maná', 286, 'rock en español', 3, ['romántica'], [], []],
  ['OX-us7PEfkc', 'De Música Ligera', 'Soda Stereo', 289, 'rock en español', 4, ['intensa', 'festiva'], [], []],
  ['7h2ryr_uUEs', 'Labios Rotos (MTV Unplugged)', 'Zoé', 262, 'rock en español', 2, ['romántica', 'tranquila'], [], []],
  ['k76BgIb89-s', 'Nunca Es Suficiente', 'Los Ángeles Azules ft. Natalia Lafourcade', 287, 'cumbia', 3, ['bailable', 'romántica'], [], []],
  ['mwNBa40y2oA', 'La Llorona', 'Chavela Vargas', 325, 'ranchera', 1, ['melancólica'], ['dia-de-muertos'], []],
  ['E7VPdpEV1m0', 'Recuérdame (Dúo)', 'Miguel ft. Natalia Lafourcade', 170, 'pop latino', 2, ['tranquila', 'melancólica'], ['dia-de-muertos'], []],
  ['yZ7cBunq8xo', 'Un Poco Loco', 'Luis Ángel Gómez Jaramillo y Gael García Bernal', 138, 'mariachi', 4, ['festiva', 'alegre'], ['dia-de-muertos'], []],
  ['U5RC3BJ2PMo', 'Cielito Lindo', 'Pedro Infante', 189, 'ranchera', 3, ['festiva'], ['fiestas-patrias'], []],
  ['g9N1BUV8d40', 'México Lindo y Querido', 'Vicente Fernández', 216, 'ranchera', 3, ['festiva'], ['fiestas-patrias'], []],
  ['BalDi9RYdcI', 'Jarabe Tapatío', 'Mariachi', 152, 'mariachi', 4, ['festiva', 'alegre'], ['fiestas-patrias'], []],
  ['NbgAHpD4W_8', 'Huapango', 'José Pablo Moncayo', 542, 'clásica', 4, ['festiva', 'intensa'], ['fiestas-patrias'], []],
  ['yXQViqx6GMY', 'All I Want For Christmas Is You', 'Mariah Carey', 235, 'pop', 4, ['festiva', 'alegre'], ['navidad'], []],
  ['N8NcQzMQN_U', 'Feliz Navidad', 'José Feliciano', 184, 'pop latino', 4, ['festiva', 'alegre'], ['navidad'], []],
  ['E8gmARGvPlI', 'Last Christmas', 'Wham!', 278, 'pop', 3, ['festiva', 'melancólica'], ['navidad'], []],
  ['itcMLwMEeMQ', 'Jingle Bell Rock', 'Bobby Helms', 132, 'rock', 3, ['festiva'], ['navidad'], []],
  ['WNcsUNKlAKw', 'Clair de Lune', 'Claude Debussy', 314, 'clásica', 1, ['tranquila', 'concentración'], [], []],
  ['S-Xm7s9eGxU', 'Gymnopédie No. 1', 'Erik Satie', 217, 'clásica', 1, ['tranquila', 'concentración'], [], []],
  ['9E6b3swbnWg', 'Nocturno Op. 9 No. 2', 'Frédéric Chopin', 269, 'clásica', 1, ['tranquila', 'concentración'], [], []],
  ['NlprozGcs80', 'Canon en Re mayor', 'Johann Pachelbel', 376, 'clásica', 2, ['tranquila', 'concentración'], [], []],
  ['VUCI-1vIbUo', 'Nuvole Bianche', 'Ludovico Einaudi', 386, 'instrumental', 1, ['tranquila', 'concentración'], [], []],
  ['hN_q-_nGv4U', 'Experience', 'Ludovico Einaudi', 382, 'instrumental', 2, ['concentración', 'motivadora'], [], []],
]

const songId = (youtubeId) => `yt-${youtubeId}`

export function seedSongs(now) {
  return SONGS.map(([youtubeId, title, artist, duration, genre, energy, moods, themes, restrictions]) => ({
    id: songId(youtubeId),
    youtubeId,
    title,
    artist,
    duration,
    genre,
    energy,
    moods,
    themes,
    restrictions,
    enabled: true,
    errorCount: 0,
    createdAt: now,
  }))
}

const ids = (...youtubeIds) => youtubeIds.map(songId)

export const SEED_PLAYLISTS = [
  {
    id: 'pl-respaldo',
    name: 'Respaldo autorizado',
    description: 'Se usa cuando no hay suficientes canciones elegibles o falta un dato del contexto.',
    songIds: ids('ZbZSe6N_BXs', 'hT_nvWreIhg', '1G4isv_Fylg', 'dvgZkm1xWPE', 'IKmPci5VXz0', 'kRt2sRyup6A', '98Akpf1ph2o', 'WNcsUNKlAKw', 'VUCI-1vIbUo', '-UV0QGLmYys', 'JGwWNGJdvx8', 'k76BgIb89-s'),
  },
  {
    id: 'pl-estudio',
    name: 'Para estudiar',
    description: 'Instrumental y de baja intensidad.',
    songIds: ids('WNcsUNKlAKw', 'S-Xm7s9eGxU', '9E6b3swbnWg', 'NlprozGcs80', 'VUCI-1vIbUo', 'hN_q-_nGv4U', '60ItHLz5WEA'),
  },
  {
    id: 'pl-mexico',
    name: 'Hecho en México',
    description: 'Para fiestas patrias y Día de Muertos.',
    songIds: ids('mwNBa40y2oA', 'E7VPdpEV1m0', 'yZ7cBunq8xo', 'U5RC3BJ2PMo', 'g9N1BUV8d40', 'BalDi9RYdcI', 'NbgAHpD4W_8', '98Akpf1ph2o', 'IKmPci5VXz0'),
  },
]

export const SEED_RULES = [
  {
    id: 'r-examenes',
    name: 'Exámenes: música para concentrarse',
    priority: 90,
    enabled: true,
    exclusive: true,
    when: { type: 'evento', eventType: 'examenes' },
    effect: { genres: ['clásica', 'instrumental'], energyMax: 2, moods: ['concentración', 'tranquila'] },
  },
  {
    id: 'r-festividad',
    name: 'Festividades: selección temática',
    priority: 70,
    enabled: true,
    exclusive: false,
    when: { type: 'evento', eventType: 'festividad' },
    effect: { useEventTheme: true, moods: ['festiva'] },
  },
  {
    id: 'r-manana',
    name: 'Mañana: energía moderada',
    priority: 40,
    enabled: true,
    exclusive: false,
    when: { type: 'horario', days: [1, 2, 3, 4, 5], from: '07:00', to: '12:00' },
    effect: { energyMin: 2, energyMax: 4, moods: ['motivadora', 'tranquila', 'alegre'] },
  },
  {
    id: 'r-mediodia',
    name: 'Mediodía: música dinámica',
    priority: 40,
    enabled: true,
    exclusive: false,
    when: { type: 'horario', days: [], from: '12:00', to: '16:00' },
    effect: { energyMin: 3, moods: ['alegre', 'bailable', 'motivadora'] },
  },
  {
    id: 'r-tarde',
    name: 'Tarde: ritmo relajado',
    priority: 30,
    enabled: true,
    exclusive: false,
    when: { type: 'horario', days: [], from: '16:00', to: '20:00' },
    effect: { energyMin: 2, energyMax: 4 },
  },
  {
    id: 'r-noche',
    name: 'Noche: tranquila',
    priority: 40,
    enabled: true,
    exclusive: false,
    when: { type: 'horario', days: [], from: '20:00', to: '07:00' },
    effect: { energyMax: 3, moods: ['tranquila', 'romántica'] },
  },
  {
    id: 'r-calor',
    name: 'Calor: ambiente fresco y alegre',
    priority: 20,
    enabled: true,
    exclusive: false,
    when: { type: 'temperatura', min: 27 },
    effect: { moods: ['alegre', 'festiva', 'bailable'] },
  },
  {
    id: 'r-frio',
    name: 'Frío: ambiente cálido y tranquilo',
    priority: 20,
    enabled: true,
    exclusive: false,
    when: { type: 'temperatura', max: 14 },
    effect: { moods: ['tranquila', 'romántica', 'melancólica'], energyMax: 4 },
  },
]

export const SEED_EVENTS = [
  { id: 'e-muertos', name: 'Día de Muertos', type: 'festividad', theme: 'dia-de-muertos', startDate: '2026-10-28', endDate: '2026-11-02', notes: 'Ofrenda en la explanada principal.', enabled: true },
  { id: 'e-feria', name: 'Feria de Ciencias', type: 'evento', theme: null, startDate: '2026-11-19', endDate: '2026-11-20', notes: 'Auditorio y explanada.', enabled: true },
  { id: 'e-navidad', name: 'Temporada navideña', type: 'festividad', theme: 'navidad', startDate: '2026-12-01', endDate: '2026-12-24', notes: '', enabled: true },
  { id: 'e-finales', name: 'Exámenes finales', type: 'examenes', theme: null, startDate: '2026-12-07', endDate: '2026-12-18', notes: 'Tiene prioridad sobre la temporada navideña.', enabled: true },
  { id: 'e-bienvenida', name: 'Semana de bienvenida', type: 'festividad', theme: 'bienvenida', startDate: '2027-01-11', endDate: '2027-01-15', notes: '', enabled: true },
  { id: 'e-patrias', name: 'Fiestas patrias', type: 'festividad', theme: 'fiestas-patrias', startDate: '2027-09-10', endDate: '2027-09-16', notes: '', enabled: true },
]

export function seedAnnouncements(now) {
  return [
    {
      id: 'a-vota',
      title: 'Invitación a votar',
      text: 'Estás escuchando Radio Campus. Escanea el código QR de la pantalla y elige cuál de las dos canciones suena después.',
      approved: true, enabled: true, priority: 1, startsAt: null, endsAt: null, days: [], fromTime: null, toTime: null,
      everyMinutes: 20, voice: null, updatedAt: now,
    },
    {
      id: 'a-feria',
      title: 'Feria de Ciencias',
      text: 'Este diecinueve y veinte de noviembre visita la Feria de Ciencias en el auditorio y la explanada. Hay proyectos de todas las carreras y la entrada es libre.',
      approved: true, enabled: true, priority: 3, startsAt: null, endsAt: '2026-11-20T18:00', days: [], fromTime: '08:00', toTime: '19:00',
      everyMinutes: 40, voice: null, updatedAt: now,
    },
    {
      id: 'a-finales',
      title: 'Calendario de exámenes finales',
      text: 'Los exámenes finales serán del siete al dieciocho de diciembre. Consulta tus fechas y salones en el portal oficial de la universidad.',
      approved: true, enabled: true, priority: 5, startsAt: '2026-11-23T07:00', endsAt: '2026-12-18T20:00', days: [1, 2, 3, 4, 5], fromTime: '07:00', toTime: '20:00',
      everyMinutes: 45, voice: null, updatedAt: now,
    },
    {
      id: 'a-calificaciones',
      title: 'Publicación de calificaciones',
      text: 'Las calificaciones finales se publican únicamente en los canales oficiales de la universidad. No compartas tu contraseña con nadie.',
      approved: false, enabled: true, priority: 4, startsAt: '2026-12-19T08:00', endsAt: '2027-01-10T20:00', days: [], fromTime: null, toTime: null,
      everyMinutes: 60, voice: null, updatedAt: now,
    },
  ]
}
