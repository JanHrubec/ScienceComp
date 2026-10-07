import type { DatabaseSync } from 'node:sqlite'
import type { StandingsState } from '../../shared/domain.js'
import { DURATION_SECONDS } from '../competition.js'
import { transaction } from '../db.js'
import { liveScores, resolutionsDue, resolveDue } from './commons.js'
export const STANDINGS_FREEZE_SECONDS = 5 * 60
const SNAPSHOT_KEY = 'standings_snapshot'
// What bringing the game up to `now` involves, or null if nothing is due. One small
// read, so every poll can afford it without a lock.
function pending(db: DatabaseSync, now: number) {
  const row = db.prepare(`SELECT (SELECT value FROM config WHERE key = 'started_at') AS started, EXISTS(SELECT 1 FROM config WHERE key = ?) AS frozen,
    EXISTS(SELECT 1 FROM commons_grounds) AS grounds, (SELECT COUNT(*) FROM commons_resolutions) AS done`).get(SNAPSHOT_KEY)!
  if (!row.started) return null
  const startedAt = Number(row.started), cutoff = startedAt + (DURATION_SECONDS - STANDINGS_FREEZE_SECONDS) * 1000
  // Without grounds (a diamond round the upgrade ended) there is nothing to resolve.
  const due = (at: number) => row.grounds ? resolutionsDue(startedAt, at) : 0
  const work = { startedAt, cutoff, done: Number(row.done), beforeCutoff: due(Math.min(now, cutoff)), due: due(now), freeze: !row.frozen && now >= cutoff }
  return work.due > work.done || work.freeze ? work : null
}
// Brings the shared game up to `now` inside the caller's transaction. Resolutions
// scheduled before the cutoff count towards the frozen standings; later ones only
// towards the final scores. Run it before any change to scores or the roster: even
// with no connected clients, the first post-cutoff request snapshots the pre-cutoff
// totals. No background job or score history is needed.
export function advanceGame(db: DatabaseSync, now: number) {
  const work = pending(db, now)
  if (!work) return
  resolveDue(db, work.startedAt, work.done, work.beforeCutoff)
  if (work.freeze) {
    const snapshot: StandingsState = { frozenAt: work.cutoff, teams: liveScores(db) }
    db.prepare('INSERT INTO config (key, value) VALUES (?, ?)').run(SNAPSHOT_KEY, JSON.stringify(snapshot))
  }
  resolveDue(db, work.startedAt, Math.max(work.done, work.beforeCutoff), work.due)
}
// For reads: the usual poll, with nothing due, neither takes nor waits for the write
// lock. advanceGame checks again once it holds the lock, so racing reads are harmless.
export function catchUp(db: DatabaseSync, now: number) {
  if (pending(db, now)) transaction(db, () => advanceGame(db, now))
}
// A plain read; bring the game up to date first.
export function standingsState(db: DatabaseSync): StandingsState {
  const saved = db.prepare('SELECT value FROM config WHERE key = ?').get(SNAPSHOT_KEY)
  return saved ? JSON.parse(String(saved.value)) as StandingsState : { frozenAt: null, teams: liveScores(db) }
}
