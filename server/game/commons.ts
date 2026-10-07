import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { ApiError } from '../db.js'
import { competitionState, DURATION_SECONDS } from '../competition.js'
import type { GameState, StandingsState } from '../../shared/domain.js'
import { commonsConfig as config } from './config.js'
import { destination, distance, isSea, newBoat, newMatch, route, step, type GoldenEvent, type MatchState } from './rules.js'

// A boat is sent to a sea tile, or to a school by its id.
export const orderSchema = z.union([z.object({ x: z.number().int().min(0), y: z.number().int().min(0) }).strict(), z.object({ school: z.number().int().min(1) }).strict()])
export const totalTicks = () => Math.floor(DURATION_SECONDS / config.tickSeconds)
// Ticks between the per-minute samples of every team kept for the match history.
const sampleTicks = Math.max(1, Math.round(60 / config.tickSeconds))
// Tables of earlier minigames: the diamond prototype and the three-ground Commons.
const legacyTables = ['grid_cells', 'grid_scores', 'grid_positions', 'commons_grounds', 'commons_boats', 'commons_resolutions']

export function initializeGame(db: DatabaseSync, now = Date.now()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS commons_teams (
      team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
      fish INTEGER NOT NULL DEFAULT 0, bonus INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS commons_match (id INTEGER PRIMARY KEY CHECK(id = 1), tick INTEGER NOT NULL, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS commons_log (id INTEGER PRIMARY KEY, tick INTEGER NOT NULL, kind TEXT NOT NULL, record TEXT NOT NULL);
    INSERT OR IGNORE INTO commons_teams (team_id) SELECT id FROM teams;
  `)
  const legacy = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${legacyTables.map(() => '?').join(', ')})`).all(...legacyTables).map(row => String(row.name))
  const { startedAt } = competitionState(db, now)
  if (legacy.length && startedAt !== null) endLegacyRound(db, startedAt, legacy.includes('grid_scores'), now)
  // Between rounds, the old tables and any snapshot of their scores are obsolete.
  else if (legacy.length) { dropLegacyTables(db); db.prepare("DELETE FROM config WHERE key = 'standings_snapshot'").run() }
}
const dropLegacyTables = (db: DatabaseSync) => { for (const table of legacyTables) db.exec(`DROP TABLE IF EXISTS ${table}`) }
interface LegacyStandings { frozenAt: number; teams: { id: string; name: string; color: string; score?: number; diamonds?: number }[] }
// A round of an earlier minigame that started but was not reset must neither run on
// as this one nor lose its results. It ends now, gets no map, and keeps its tables
// and standings until the next reset. Scores stay in commons_teams: the three-ground
// Commons kept them there, and the diamond prototype's final diamonds are counted
// there as fish. Repeating this is harmless, so the reminder is logged on every start until then.
function endLegacyRound(db: DatabaseSync, startedAt: number, diamonds: boolean, now: number) {
  db.prepare("UPDATE config SET value = ? WHERE key = 'started_at'").run(String(Math.min(startedAt, now - DURATION_SECONDS * 1000)))
  const final = diamonds ? db.prepare('SELECT t.id, t.name, t.color, s.diamonds FROM teams t JOIN grid_scores s ON s.team_id = t.id ORDER BY s.diamonds DESC, t.name COLLATE NOCASE, t.id').all() as unknown as LegacyStandings['teams'] : []
  const saved = db.prepare("SELECT value FROM config WHERE key = 'standings_snapshot'").get()
  const standings: LegacyStandings | null = saved ? JSON.parse(String(saved.value)) : diamonds ? { frozenAt: now, teams: final } : null
  if (standings) db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('standings_snapshot', ?)").run(JSON.stringify({ frozenAt: standings.frozenAt, teams: standings.teams.map(({ diamonds, ...team }) => ({ ...team, score: team.score ?? diamonds ?? 0 })) }))
  if (diamonds) db.exec('UPDATE commons_teams SET fish = COALESCE((SELECT s.diamonds FROM grid_scores s WHERE s.team_id = commons_teams.team_id), 0), bonus = 0')
  console.warn(`The database holds a round of an earlier minigame that was never reset. It has been ended instead of continuing as the map game, and its results stay until you reset the competition in admin, which you must do before the next round.${final.length ? ` Final diamonds: ${final.map(t => `${t.name} ${t.diamonds}`).join(', ')}.` : ''}`)
}

// The match is one JSON row: map, schools and boats. Research stays in `teams` and
// scores in `commons_teams`, so they are read in and written back around each use.
// Teams added during the match join at the harbour; deleted teams' boats are dropped.
function load(db: DatabaseSync): MatchState | null {
  const row = db.prepare('SELECT state FROM commons_match').get()
  if (!row) return null
  const state = JSON.parse(String(row.state)) as MatchState
  const teams = db.prepare('SELECT t.id, t.research, c.fish, c.bonus FROM teams t JOIN commons_teams c ON c.team_id = t.id ORDER BY t.name COLLATE NOCASE, t.id').all() as unknown as { id: string; research: number; fish: number; bonus: number }[]
  const boats = new Map(state.boats.map(b => [b.team, b]))
  state.boats = teams.map(t => ({ ...boats.get(t.id) ?? newBoat(state, t.id), research: t.research, fish: t.fish, bonus: t.bonus }))
  return state
}
function save(db: DatabaseSync, state: MatchState) {
  const research = db.prepare('UPDATE teams SET research = ? WHERE id = ?'), score = db.prepare('UPDATE commons_teams SET fish = ?, bonus = ? WHERE team_id = ?')
  for (const b of state.boats) { research.run(b.research, b.team); score.run(b.fish, b.bonus, b.team) }
  const boats = state.boats.map(({ research: _, fish: __, bonus: ___, ...boat }) => boat)
  db.prepare('INSERT OR REPLACE INTO commons_match (id, tick, state) VALUES (1, ?, ?)').run(state.tick, JSON.stringify({ ...state, boats }))
}
const log = (db: DatabaseSync, tick: number, kind: 'order' | 'sample' | 'golden', record: object) => db.prepare('INSERT INTO commons_log (tick, kind, record) VALUES (?, ?, ?)').run(tick, kind, JSON.stringify(record))
const teamNames = (db: DatabaseSync) => new Map(db.prepare('SELECT id, name FROM teams').all().map(r => [String(r.id), String(r.name)]))

function clearTeam(db: DatabaseSync, teamId?: string) {
  db.prepare(`UPDATE commons_teams SET fish = 0, bonus = 0${teamId === undefined ? '' : ' WHERE team_id = ?'}`).run(...(teamId === undefined ? [] : [teamId]))
}
// A team joining or re-joining a running match receives the same starting Research.
function grantStartingResearch(db: DatabaseSync, teamId?: string) {
  if (!config.startingResearch || competitionState(db).status !== 'running') return
  db.prepare(`UPDATE teams SET research = research + ?${teamId === undefined ? '' : ' WHERE id = ?'}`).run(config.startingResearch, ...(teamId === undefined ? [] : [teamId]))
}
export function createTeamGame(db: DatabaseSync, teamId: string) {
  db.prepare('INSERT INTO commons_teams (team_id) VALUES (?)').run(teamId)
  grantStartingResearch(db, teamId)
}
// The team's boat goes back to the harbour with nothing caught.
export function resetTeamGame(db: DatabaseSync, teamId: string) {
  clearTeam(db, teamId)
  const state = load(db)
  if (state) { state.boats = state.boats.map(b => b.team === teamId ? { ...newBoat(state, teamId), research: b.research } : b); save(db, state) }
  grantStartingResearch(db, teamId)
}
export function resetGame(db: DatabaseSync) {
  db.exec('DELETE FROM commons_match; DELETE FROM commons_log;')
  clearTeam(db)
  // Including the results of an earlier minigame's round the upgrade ended.
  dropLegacyTables(db)
}
// Called in the same transaction that records the start time: a fresh map for every match.
export function startGame(db: DatabaseSync) {
  resetGame(db)
  const teams = db.prepare('SELECT id FROM teams ORDER BY name COLLATE NOCASE, id').all().map(r => String(r.id))
  save(db, newMatch(teams, config, Math.floor(Math.random() * 2 ** 31)))
  grantStartingResearch(db)
}

// How many ticks of a match started at `startedAt` are scheduled at or before `at`.
export const ticksDue = (startedAt: number, at: number) => Math.max(0, Math.min(totalTicks(), Math.floor((at - startedAt) / (config.tickSeconds * 1000))))
// Plays the match up to tick `due` inside the caller's transaction. Each tick runs
// once, so repeated or concurrent calls are harmless, and a tick only ever sees
// orders and Research committed before it ran. The history keeps every golden
// event, every order and a per-minute sample of each team.
export function playUntil(db: DatabaseSync, due: number) {
  const state = load(db)
  if (!state || state.tick >= due) return
  const names = teamNames(db)
  while (state.tick < due) {
    const { tick, events } = step(state, config)
    for (const e of events) log(db, tick, 'golden', { ...e, name: e.team && names.get(e.team) })
    if (tick % sampleTicks === 0) log(db, tick, 'sample', { tick, teams: state.boats.map(b => ({ id: b.team, name: names.get(b.team), research: b.research, spent: b.spent, fish: b.fish, bonus: b.bonus })) })
  }
  save(db, state)
}

export function setOrder(db: DatabaseSync, teamId: string, order: z.infer<typeof orderSchema>) {
  const state = load(db), boat = state?.boats.find(b => b.team === teamId)
  if (!state || !boat) throw new ApiError(409, 'The game has not started.')
  // A school can vanish between a device's poll and its order.
  if ('school' in order && !state.schools.some(s => s.id === order.school)) throw new ApiError(409, 'That school has gone. Choose another one.')
  if (!('school' in order) && !isSea(state.map, order.x, order.y)) throw new ApiError(400, 'Choose a sea tile.')
  boat.target = order
  save(db, state)
  log(db, state.tick, 'order', { tick: state.tick, team: teamId, name: teamNames(db).get(teamId), ...order })
}

export function gameState(db: DatabaseSync, teamId: string, startedAt: number | null): GameState {
  const state = load(db), total = totalTicks(), tick = state?.tick ?? 0
  const colors = new Map(db.prepare('SELECT id, name, color FROM teams').all().map(r => [String(r.id), { name: String(r.name), color: String(r.color) }]))
  const own = state?.boats.find(b => b.team === teamId)
  const golden = db.prepare("SELECT tick, record FROM commons_log WHERE kind = 'golden' ORDER BY id DESC LIMIT 5").all().map(r => ({ tick: Number(r.tick), ...JSON.parse(String(r.record)) as GoldenEvent & { name?: string } }))
  return {
    rules: { tickSeconds: config.tickSeconds, fuelCost: config.fuelCost, catchTicks: config.catchTicks, goldenValue: config.goldenValue },
    clock: { tick, total, nextAt: startedAt !== null && state && tick < total ? startedAt + (tick + 1) * config.tickSeconds * 1000 : null },
    map: state && { width: state.map.width, height: state.map.height, land: state.map.land, harbour: state.map.harbour },
    // `sail`: tiles from this team's boat.
    schools: state?.schools.map(({ id, x, y, fish, golden, until }) => ({ id, x, y, fish, golden, until, sail: own ? distance(state.map, own, { x, y }) : 0 })) ?? [],
    // Every boat, its destination and its route are public; Research and scores are not.
    boats: state?.boats.map(b => {
      const to = destination(state, b)
      return { team: b.team, ...colors.get(b.team)!, x: b.x, y: b.y, target: b.target, route: to ? route(state.map, b, to) : [], hauling: b.hauling }
    }) ?? [],
    own: { fish: own?.fish ?? 0, bonus: own?.bonus ?? 0 },
    golden: golden.map(e => ({ tick: e.tick, kind: e.kind, x: e.x, y: e.y, team: e.team ?? null, name: e.name ?? null })),
  }
}
export function liveScores(db: DatabaseSync): StandingsState['teams'] {
  return db.prepare('SELECT t.id, t.name, t.color, c.fish + c.bonus AS score FROM teams t JOIN commons_teams c ON c.team_id = t.id ORDER BY score DESC, t.name COLLATE NOCASE, t.id').all() as unknown as StandingsState['teams']
}
export function teamScore(db: DatabaseSync, teamId: string) {
  const row = db.prepare('SELECT fish, bonus FROM commons_teams WHERE team_id = ?').get(teamId) as { fish: number; bonus: number }
  return { score: row.fish + row.bonus, fish: row.fish, bonus: row.bonus }
}
// The match as played: settings, the starting map, and the log (`npm run simulate -- --history`).
export function matchHistory(db: DatabaseSync) {
  const rows = db.prepare('SELECT kind, record FROM commons_log ORDER BY id').all().map(r => ({ kind: String(r.kind), record: JSON.parse(String(r.record)) }))
  const of = (kind: string) => rows.filter(r => r.kind === kind).map(r => r.record)
  return { config: { ...config, totalTicks: totalTicks() }, map: load(db)?.map ?? null, samples: of('sample'), orders: of('order'), golden: of('golden') }
}
