import type { DatabaseSync } from 'node:sqlite'
import { type CompetitionState } from '../shared/domain.js'
import { ApiError } from './db.js'
import { subjectBooklets } from './booklets.js'
export const DURATION_SECONDS = 60 * 60

export function competitionState(db: DatabaseSync, now = Date.now()): CompetitionState {
  const settings = Object.fromEntries(db.prepare('SELECT key, value FROM config').all().map(row => [String(row.key), String(row.value)]))
  const startedAt = settings.started_at ? Number(settings.started_at) : null
  const endsAt = startedAt === null ? null : startedAt + DURATION_SECONDS * 1000
  return {
    startedAt, endsAt, durationSeconds: DURATION_SECONDS, serverNow: now,
    status: startedAt === null ? 'waiting' : now >= endsAt! ? 'finished' : 'running',
    booklets: subjectBooklets,
  }
}
export function requireRunning(db: DatabaseSync) {
  const state = competitionState(db)
  if (state.status !== 'running') throw new ApiError(409, state.status === 'waiting' ? 'Waiting for the admin to start.' : 'Time is up.')
}
export function startCompetition(db: DatabaseSync): CompetitionState {
  if (competitionState(db).status !== 'waiting') throw new ApiError(409, 'The competition has already started. Reset it before starting again.')
  db.prepare("INSERT INTO config (key, value) VALUES ('started_at', ?)").run(String(Date.now()))
  return competitionState(db)
}
