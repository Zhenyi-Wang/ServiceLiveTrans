import Database from 'better-sqlite3'
import { join } from 'pathe'

let _db: Database.Database | null = null

function getDb(): Database.Database {
  if (_db) return _db

  const dbPath = join(process.cwd(), 'server', 'data', 'slt.db')
  _db = new Database(dbPath)
  _db.pragma('journal_mode = WAL')
  _db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)
  return _db
}

export function getConfig<T = unknown>(key: string, fallback?: T): T {
  const db = getDb()
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  if (row === undefined) return fallback as T
  return JSON.parse(row.value) as T
}

export function setConfig(key: string, value: unknown): void {
  const db = getDb()
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(
    key,
    JSON.stringify(value),
  )
}

export function getAllConfig(): Record<string, unknown> {
  const db = getDb()
  const rows = db.prepare('SELECT key, value FROM config').all() as {
    key: string
    value: string
  }[]
  return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]))
}

export function initDefaults(defaults: Record<string, unknown>): void {
  const db = getDb()
  const insert = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)')
  for (const [key, value] of Object.entries(defaults)) {
    insert.run(key, JSON.stringify(value))
  }
}
