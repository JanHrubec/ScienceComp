import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { ApiError } from '../db.js'
import { competitionState, DURATION_SECONDS } from '../competition.js'
import type { GameState, StandingsState } from '../../shared/domain.js'
import { commonsConfig as config } from './config.js'
import { destination, distance, isSea, lookahead, newBoat, newMatch, route, step, type MatchState } from './rules.js'

// A boat is sent to a sea tile or to a fishing ground by its id; `bait` flips the team's bait switch.
export const orderSchema = z.union([z.object({ x: z.number().int().min(0), y: z.number().int().min(0) }).strict(), z.object({ school: z.number().int().min(1) }).strict(), z.object({ bait: z.boolean() }).strict()])
// How many ticks of each boat's future the clients get, so they can draw it moving smoothly.
const AHEAD_TICKS = 3
export const totalTicks = () => Math.floor(DURATION_SECONDS / config.tickSeconds)
// Ticks between the per-minute samples of every team kept for the match history.
const sampleTicks = Math.max(1, Math.round(60 / config.tickSeconds))

export function initializeGame(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS commons_teams (
      team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
      fish INTEGER NOT NULL DEFAULT 0, bonus INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS commons_match (id INTEGER PRIMARY KEY CHECK(id = 1), tick INTEGER NOT NULL, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS commons_log (id INTEGER PRIMARY KEY, tick INTEGER NOT NULL, kind TEXT NOT NULL, record TEXT NOT NULL);
    INSERT OR IGNORE INTO commons_teams (team_id) SELECT id FROM teams;
  `)
}

// The match is one JSON row: map, grounds and boats. Research stays in `teams` and
// scores in `commons_teams`, so they are read in and written back around each use.
// Teams added during the match join at the harbour; deleted teams' boats are dropped.
// Boats saved by an earlier version get the fields they lack from a new boat.
function load(db: DatabaseSync): MatchState | null {
  const row = db.prepare('SELECT state FROM commons_match').get()
  if (!row) return null
  const state = JSON.parse(String(row.state)) as MatchState
  const teams = db.prepare('SELECT t.id, t.research, c.fish, c.bonus FROM teams t JOIN commons_teams c ON c.team_id = t.id ORDER BY t.name COLLATE NOCASE, t.id').all() as unknown as { id: string; research: number; fish: number; bonus: number }[]
  const boats = new Map(state.boats.map(b => [b.team, b]))
  state.boats = teams.map(t => ({ ...newBoat(state, t.id), ...boats.get(t.id), research: t.research, fish: t.fish, bonus: t.bonus }))
  return state
}
function save(db: DatabaseSync, state: MatchState) {
  const research = db.prepare('UPDATE teams SET research = ? WHERE id = ?'), score = db.prepare('UPDATE commons_teams SET fish = ?, bonus = ? WHERE team_id = ?')
  for (const b of state.boats) { research.run(b.research, b.team); score.run(b.fish, b.bonus, b.team) }
  const boats = state.boats.map(({ research: _, fish: __, bonus: ___, ...boat }) => boat)
  db.prepare('INSERT OR REPLACE INTO commons_match (id, tick, state) VALUES (1, ?, ?)').run(state.tick, JSON.stringify({ ...state, boats }))
}
const log = (db: DatabaseSync, tick: number, kind: 'order' | 'sample', record: object) => db.prepare('INSERT INTO commons_log (tick, kind, record) VALUES (?, ?, ?)').run(tick, kind, JSON.stringify(record))
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
// orders and Research committed before it ran. The history keeps every order and
// a per-minute sample of each team.
export function playUntil(db: DatabaseSync, due: number) {
  const state = load(db)
  if (!state || state.tick >= due) return
  const names = teamNames(db)
  while (state.tick < due) {
    const { tick } = step(state, config)
    if (tick % sampleTicks === 0) log(db, tick, 'sample', { tick, teams: state.boats.map(b => ({ id: b.team, name: names.get(b.team), research: b.research, spent: b.spent, fish: b.fish, bonus: b.bonus })) })
  }
  save(db, state)
}

export function setOrder(db: DatabaseSync, teamId: string, order: z.infer<typeof orderSchema>) {
  const state = load(db), boat = state?.boats.find(b => b.team === teamId)
  if (!state || !boat) throw new ApiError(409, 'The game has not started.')
  if ('bait' in order) boat.bait = order.bait
  else if ('school' in order && !state.schools.some(s => s.id === order.school)) throw new ApiError(409, 'Choose a fishing ground on the map.')
  else if ('x' in order && !isSea(state.map, order.x, order.y)) throw new ApiError(400, 'Choose a sea tile.')
  else boat.target = order
  save(db, state)
  log(db, state.tick, 'order', { tick: state.tick, team: teamId, name: teamNames(db).get(teamId), ...order })
}

export function gameState(db: DatabaseSync, teamId: string): GameState {
  const state = load(db), total = totalTicks(), tick = state?.tick ?? 0
  const colors = new Map(db.prepare('SELECT id, name, color FROM teams').all().map(r => [String(r.id), { name: String(r.name), color: String(r.color) }]))
  const own = state?.boats.find(b => b.team === teamId)
  // Other teams' Research is masked: their `ahead` shows only whether they can afford the next tile, as a stopped boat would.
  const ahead = state ? lookahead({ ...state, boats: state.boats.map(b => b.team !== teamId && b.research >= config.fuelCost ? { ...b, research: Infinity } : b) }, config, Math.min(AHEAD_TICKS, total - tick)) : new Map()
  const { tickSeconds, fuelCost, catchEffort, hold, schoolMax, growthTicks, growthCap, goldenMax, goldenCap, goldenValue, baitBoost, baitCost, baitReserve } = config
  return {
    rules: { tickSeconds, fuelCost, catchEffort, hold, schoolMax, growthTicks, growthCap, goldenMax, goldenCap, goldenValue, baitBoost, baitCost, baitReserve },
    clock: { tick, total },
    map: state && { width: state.map.width, height: state.map.height, land: state.map.land, harbour: state.map.harbour },
    // `sail`: tiles from this team's boat; `home`: tiles from the harbour.
    schools: state?.schools.map(({ id, x, y, fish, golden }) => ({ id, x, y, fish, golden, sail: own ? distance(state.map, own, { x, y }) : 0, home: distance(state.map, { x, y }, state.map.harbour) })) ?? [],
    // Every boat, its order and its route are public; Research, scores, catch meter, hold and bait are not.
    boats: state?.boats.map(b => {
      const to = destination(state, b, config)
      return { team: b.team, ...colors.get(b.team)!, x: b.x, y: b.y, target: b.target, route: to ? route(state.map, b, to) : [], ahead: ahead.get(b.team) ?? [] }
    }) ?? [],
    own: { fish: own?.fish ?? 0, bonus: own?.bonus ?? 0, hauling: own?.hauling ?? 0, hold: own?.hold ?? 0, bait: own?.bait ?? false },
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
  return { config: { ...config, totalTicks: totalTicks() }, map: load(db)?.map ?? null, samples: of('sample'), orders: of('order') }
}
