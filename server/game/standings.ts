import type { DatabaseSync } from 'node:sqlite'
import type { StandingsState } from '../../shared/domain.js'
import { competitionState } from '../competition.js'
import { transaction } from '../db.js'
import { liveScores, resolveDue } from './commons.js'
export const STANDINGS_FREEZE_SECONDS = 5 * 60
const SNAPSHOT_KEY = 'standings_snapshot'
// Call inside every competition mutation, before changing scores or the roster.
// Even with no connected clients, the first post-cutoff action snapshots the
// unchanged pre-cutoff totals. No background job or score history is needed.
export function freezeStandingsIfDue(db: DatabaseSync, now = Date.now()) {
  const { endsAt } = competitionState(db, now)
  if (endsAt === null || now < endsAt - STANDINGS_FREEZE_SECONDS * 1000) return
  if (db.prepare('SELECT value FROM config WHERE key = ?').get(SNAPSHOT_KEY)) return
  const snapshot: StandingsState = { frozenAt: endsAt - STANDINGS_FREEZE_SECONDS * 1000, teams: liveScores(db) }
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?)').run(SNAPSHOT_KEY, JSON.stringify(snapshot))
}
// Brings the shared game up to date. Resolutions scheduled before the cutoff
// count towards the frozen standings; later ones only towards the final scores.
export function advanceGame(db: DatabaseSync, now = Date.now()) {
  const { endsAt } = competitionState(db, now)
  if (endsAt === null) return
  resolveDue(db, Math.min(now, endsAt - STANDINGS_FREEZE_SECONDS * 1000))
  freezeStandingsIfDue(db, now)
  resolveDue(db, now)
}
export function standingsState(db: DatabaseSync): StandingsState {
  return transaction(db, () => {
    advanceGame(db)
    const saved = db.prepare('SELECT value FROM config WHERE key = ?').get(SNAPSHOT_KEY)
    return saved ? JSON.parse(String(saved.value)) as StandingsState : { frozenAt: null, teams: liveScores(db) }
  })
}
