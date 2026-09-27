import type { DatabaseSync } from 'node:sqlite'
import type { StandingsState } from '../../shared/domain.js'
import { competitionState } from '../competition.js'
import { transaction } from '../db.js'
export const STANDINGS_FREEZE_SECONDS = 5 * 60
const SNAPSHOT_KEY = 'standings_snapshot'
function liveTeams(db: DatabaseSync): StandingsState['teams'] {
  return db.prepare('SELECT t.id, t.name, t.color, s.diamonds FROM teams t JOIN grid_scores s ON s.team_id = t.id ORDER BY s.diamonds DESC, t.name COLLATE NOCASE, t.id').all() as unknown as StandingsState['teams']
}
// Call inside every competition mutation, before changing scores or the roster.
// Even with no connected clients, the first post-cutoff action snapshots the
// unchanged pre-cutoff totals. No background job or score history is needed.
export function freezeStandingsIfDue(db: DatabaseSync, now = Date.now()) {
  const { endsAt } = competitionState(db, now)
  if (endsAt === null || now < endsAt - STANDINGS_FREEZE_SECONDS * 1000) return
  if (db.prepare('SELECT value FROM config WHERE key = ?').get(SNAPSHOT_KEY)) return
  const snapshot: StandingsState = { frozenAt: endsAt - STANDINGS_FREEZE_SECONDS * 1000, teams: liveTeams(db) }
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?)').run(SNAPSHOT_KEY, JSON.stringify(snapshot))
}
export function standingsState(db: DatabaseSync): StandingsState {
  return transaction(db, () => {
    freezeStandingsIfDue(db)
    const saved = db.prepare('SELECT value FROM config WHERE key = ?').get(SNAPSHOT_KEY)
    return saved ? JSON.parse(String(saved.value)) as StandingsState : { frozenAt: null, teams: liveTeams(db) }
  })
}
