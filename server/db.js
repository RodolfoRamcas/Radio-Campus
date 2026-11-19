// Base de datos SQLite. En Cloudflare es la del Durable Object; en las pruebas, node:sqlite.
// Ambos se envuelven en la misma interfaz mínima: all / get / run.

export function durableSql(sql) {
  return {
    all: (query, ...params) => sql.exec(query, ...params).toArray(),
    get: (query, ...params) => sql.exec(query, ...params).toArray()[0] ?? null,
    run: (query, ...params) => {
      sql.exec(query, ...params)
    },
  }
}

export function nodeSqlite(database) {
  return {
    all: (query, ...params) => database.prepare(query).all(...params),
    get: (query, ...params) => database.prepare(query).get(...params) ?? null,
    run: (query, ...params) => {
      database.prepare(query).run(...params)
    },
  }
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS songs (
    id TEXT PRIMARY KEY,
    youtube_id TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    duration INTEGER NOT NULL,
    genre TEXT NOT NULL,
    energy INTEGER NOT NULL,
    moods TEXT NOT NULL DEFAULT '[]',
    themes TEXT NOT NULL DEFAULT '[]',
    restrictions TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    error_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    song_ids TEXT NOT NULL DEFAULT '[]'
  )`,
  `CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    priority INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    exclusive INTEGER NOT NULL DEFAULT 0,
    condition TEXT NOT NULL,
    effect TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    theme TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    approved INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 1,
    starts_at TEXT,
    ends_at TEXT,
    days TEXT NOT NULL DEFAULT '[]',
    from_time TEXT,
    to_time TEXT,
    every_minutes INTEGER NOT NULL DEFAULT 30,
    voice TEXT,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS announcement_audio (
    announcement_id TEXT PRIMARY KEY,
    text_hash TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    wav BLOB NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS speech_cache (
    hash TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    wav BLOB NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    play_id INTEGER,
    options TEXT NOT NULL,
    opened_at INTEGER NOT NULL,
    closes_at INTEGER NOT NULL,
    closed_at INTEGER,
    counts TEXT,
    winner_song_id TEXT,
    resolution TEXT,
    strategy TEXT,
    trace TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS votes (
    round_id INTEGER NOT NULL,
    voter TEXT NOT NULL,
    choice INTEGER NOT NULL,
    ip_hash TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (round_id, voter)
  )`,
  `CREATE INDEX IF NOT EXISTS votes_by_ip ON votes (round_id, ip_hash)`,
  `CREATE TABLE IF NOT EXISTS plays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    ref_id TEXT NOT NULL,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    round_id INTEGER,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    status TEXT NOT NULL,
    detail TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS plays_by_time ON plays (started_at)`,
  `CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
  )`,
]

export function migrate(db) {
  for (const statement of SCHEMA) db.run(statement)
}

// --- Entidades editables desde el panel -------------------------------------------------
// Cada columna declara cómo se convierte entre SQLite y JavaScript.

const json = { toDb: (v) => JSON.stringify(v ?? []), fromDb: (v) => (v ? JSON.parse(v) : []) }
const jsonObject = { toDb: (v) => JSON.stringify(v ?? {}), fromDb: (v) => (v ? JSON.parse(v) : {}) }
const bool = { toDb: (v) => (v ? 1 : 0), fromDb: (v) => Boolean(v) }
const plain = { toDb: (v) => v ?? null, fromDb: (v) => v }

export const ENTITIES = {
  songs: {
    table: 'songs',
    order: 'artist, title',
    columns: {
      id: ['id', plain], youtubeId: ['youtube_id', plain], title: ['title', plain], artist: ['artist', plain],
      duration: ['duration', plain], genre: ['genre', plain], energy: ['energy', plain], moods: ['moods', json],
      themes: ['themes', json], restrictions: ['restrictions', json], enabled: ['enabled', bool],
      errorCount: ['error_count', plain], createdAt: ['created_at', plain],
    },
  },
  playlists: {
    table: 'playlists',
    order: 'name',
    columns: { id: ['id', plain], name: ['name', plain], description: ['description', plain], songIds: ['song_ids', json] },
  },
  rules: {
    table: 'rules',
    order: 'priority DESC, name',
    columns: {
      id: ['id', plain], name: ['name', plain], priority: ['priority', plain], enabled: ['enabled', bool],
      exclusive: ['exclusive', bool], when: ['condition', jsonObject], effect: ['effect', jsonObject],
    },
  },
  events: {
    table: 'events',
    order: 'start_date',
    columns: {
      id: ['id', plain], name: ['name', plain], type: ['type', plain], theme: ['theme', plain],
      startDate: ['start_date', plain], endDate: ['end_date', plain], notes: ['notes', plain], enabled: ['enabled', bool],
    },
  },
  announcements: {
    table: 'announcements',
    order: 'priority DESC, title',
    columns: {
      id: ['id', plain], title: ['title', plain], text: ['text', plain], approved: ['approved', bool],
      enabled: ['enabled', bool], priority: ['priority', plain], startsAt: ['starts_at', plain], endsAt: ['ends_at', plain],
      days: ['days', json], fromTime: ['from_time', plain], toTime: ['to_time', plain],
      everyMinutes: ['every_minutes', plain], voice: ['voice', plain], updatedAt: ['updated_at', plain],
    },
  },
}

function fromRow(entity, row) {
  if (!row) return null
  const out = {}
  for (const [key, [column, codec]] of Object.entries(entity.columns)) out[key] = codec.fromDb(row[column])
  return out
}

export function listEntities(db, name) {
  const entity = ENTITIES[name]
  return db.all(`SELECT * FROM ${entity.table} ORDER BY ${entity.order}`).map((row) => fromRow(entity, row))
}

export function getEntity(db, name, id) {
  const entity = ENTITIES[name]
  return fromRow(entity, db.get(`SELECT * FROM ${entity.table} WHERE id = ?`, id))
}

export function saveEntity(db, name, value) {
  const entity = ENTITIES[name]
  const entries = Object.entries(entity.columns).filter(([key]) => value[key] !== undefined)
  const columns = entries.map(([, [column]]) => column)
  const params = entries.map(([key, [, codec]]) => codec.toDb(value[key]))
  const updates = columns.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`)
  db.run(
    `INSERT INTO ${entity.table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
     ON CONFLICT(id) DO UPDATE SET ${updates.join(', ')}`,
    ...params,
  )
  return getEntity(db, name, value.id)
}

export function deleteEntity(db, name, id) {
  db.run(`DELETE FROM ${ENTITIES[name].table} WHERE id = ?`, id)
}

export function readKv(db, key, fallback = null) {
  const row = db.get('SELECT value FROM kv WHERE key = ?', key)
  return row ? JSON.parse(row.value) : fallback
}

export function writeKv(db, key, value) {
  db.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value))
}
