import { TEAM_SKIP_LIMIT } from '../shared/domain.js'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
export function openDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, age TEXT NOT NULL, code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      research REAL NOT NULL DEFAULT 0, earned REAL NOT NULL DEFAULT 0,
      skips_used INTEGER NOT NULL DEFAULT 0 CHECK(skips_used BETWEEN 0 AND ${TEAM_SKIP_LIMIT}), color TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS progress (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, subject TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(team_id, subject)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
      role TEXT NOT NULL, expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS grid_positions (
      team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE, x INTEGER NOT NULL, y INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  // Existing installations had a non-negative balance constraint. Rebuild only
  // that table, preserving IDs and all child rows, so penalties can create debt.
  const teamSql = String(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'teams'").get()!.sql)
  if (/CHECK\s*\(research\s*>=\s*0\)/i.test(teamSql)) {
    db.exec('PRAGMA foreign_keys = OFF')
    try {
      transaction(db, () => {
        db.exec(`CREATE TABLE teams_updated (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, age TEXT NOT NULL, code TEXT NOT NULL UNIQUE COLLATE NOCASE,
          research REAL NOT NULL DEFAULT 0, earned REAL NOT NULL DEFAULT 0,
          skips_used INTEGER NOT NULL DEFAULT 0 CHECK(skips_used BETWEEN 0 AND ${TEAM_SKIP_LIMIT}), color TEXT NOT NULL
        );
        INSERT INTO teams_updated SELECT * FROM teams;
        DROP TABLE teams;
        ALTER TABLE teams_updated RENAME TO teams;`)
        if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Team migration failed its foreign-key check.')
      })
    } finally { db.exec('PRAGMA foreign_keys = ON') }
  }
  return db
}
export function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try { const value = action(); db.exec('COMMIT'); return value } catch (error) { db.exec('ROLLBACK'); throw error }
}
export class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }
