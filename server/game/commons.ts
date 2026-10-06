import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { ApiError } from '../db.js'
import { competitionState } from '../competition.js'
import { freezeStandingsIfDue } from './standings.js'
import { commonsRules as rules } from './commons-config.js'
import { BOATS_PER_TEAM, availableContracts, bonusFor, createGrounds, growth, resolve, type CommonsMatch, type ResolutionRecord } from '../../shared/commons.js'
import type { GameState } from '../../shared/domain.js'
// Persistence for The Commons. The rules themselves are pure (shared/commons.ts);
// this file loads a match, resolves due steps and stores the result.
interface TeamRow { id: string; research: number; fish: number; bonus: number; contract_id: string | null; contract_progress: number; contract_grounds: string; completed: string }
interface BoatRow { team_id: string; boat: number; location: string | null; standing_order: string | null }
interface StoredResolution extends ResolutionRecord { number: number; at: number; names: Record<string, string> }
const resolutionMs = rules.resolutionSeconds * 1000

export function initializeCommons(db: DatabaseSync) {
  db.exec(`
    DROP TABLE IF EXISTS grid_cells; DROP TABLE IF EXISTS grid_scores; DROP TABLE IF EXISTS grid_positions;
    CREATE TABLE IF NOT EXISTS commons_grounds (
      id TEXT PRIMARY KEY, position INTEGER NOT NULL, biomass INTEGER NOT NULL CHECK(biomass >= 0), max INTEGER NOT NULL, last_fished_by TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS commons_boats (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, boat INTEGER NOT NULL, location TEXT, standing_order TEXT, PRIMARY KEY(team_id, boat)
    );
    CREATE TABLE IF NOT EXISTS commons_teams (
      team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE, fish INTEGER NOT NULL DEFAULT 0, bonus INTEGER NOT NULL DEFAULT 0,
      contract_id TEXT, contract_progress INTEGER NOT NULL DEFAULT 0, contract_grounds TEXT NOT NULL DEFAULT '[]', completed TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS commons_resolutions (number INTEGER PRIMARY KEY, at INTEGER NOT NULL, record TEXT NOT NULL);
    INSERT OR IGNORE INTO commons_teams (team_id) SELECT id FROM teams;
  `)
  for (let boat = 0; boat < BOATS_PER_TEAM; boat++) db.prepare('INSERT OR IGNORE INTO commons_boats (team_id, boat) SELECT id, ? FROM teams').run(boat)
}
function grantStartingResearch(db: DatabaseSync, teamId?: string) {
  if (teamId === undefined) db.prepare('UPDATE teams SET research = research + ?').run(rules.startingResearch)
  else if (competitionState(db).status === 'running') db.prepare('UPDATE teams SET research = research + ? WHERE id = ?').run(rules.startingResearch, teamId)
}
export function createTeamGame(db: DatabaseSync, teamId: string) {
  db.prepare('INSERT INTO commons_teams (team_id) VALUES (?)').run(teamId)
  for (let boat = 0; boat < BOATS_PER_TEAM; boat++) db.prepare('INSERT INTO commons_boats (team_id, boat) VALUES (?, ?)').run(teamId, boat)
  grantStartingResearch(db, teamId)
}
export function resetTeamGame(db: DatabaseSync, teamId: string) {
  db.prepare('UPDATE commons_boats SET location = NULL, standing_order = NULL WHERE team_id = ?').run(teamId)
  db.prepare("UPDATE commons_teams SET fish = 0, bonus = 0, contract_id = NULL, contract_progress = 0, contract_grounds = '[]', completed = '[]' WHERE team_id = ?").run(teamId)
  grantStartingResearch(db, teamId)
}
export function resetGame(db: DatabaseSync) {
  db.exec(`DELETE FROM commons_grounds; DELETE FROM commons_resolutions; UPDATE commons_boats SET location = NULL, standing_order = NULL;
    UPDATE commons_teams SET fish = 0, bonus = 0, contract_id = NULL, contract_progress = 0, contract_grounds = '[]', completed = '[]';`)
}
// Called in the start transaction: the ground count is fixed for the match.
export function startCommons(db: DatabaseSync) {
  resetGame(db)
  const insert = db.prepare('INSERT INTO commons_grounds (id, position, biomass, max) VALUES (?, ?, ?, ?)')
  createGrounds(Number(db.prepare('SELECT COUNT(*) AS n FROM teams').get()!.n), rules).forEach((g, i) => insert.run(g.id, i, g.biomass, g.max))
  grantStartingResearch(db)
}

function loadMatch(db: DatabaseSync): CommonsMatch {
  const grounds = db.prepare('SELECT id, biomass, max, last_fished_by FROM commons_grounds ORDER BY position').all().map(g => ({ id: String(g.id), biomass: Number(g.biomass), max: Number(g.max), lastFishedBy: JSON.parse(String(g.last_fished_by)) as string[] }))
  const boats = db.prepare('SELECT * FROM commons_boats ORDER BY boat').all() as unknown as BoatRow[]
  const teams = db.prepare('SELECT t.id, t.research, c.* FROM teams t JOIN commons_teams c ON c.team_id = t.id ORDER BY t.id').all() as unknown as TeamRow[]
  return { grounds, teams: teams.map(t => ({
    id: t.id, research: t.research, fish: t.fish, bonus: t.bonus, completed: JSON.parse(t.completed),
    boats: boats.filter(b => b.team_id === t.id).map(b => ({ location: b.location, order: b.standing_order })),
    contract: t.contract_id === null ? null : { id: t.contract_id, progress: t.contract_progress, grounds: JSON.parse(t.contract_grounds) },
  })) }
}
function saveMatch(db: DatabaseSync, match: CommonsMatch, record: ResolutionRecord) {
  const ground = db.prepare('UPDATE commons_grounds SET biomass = ?, last_fished_by = ? WHERE id = ?')
  for (const g of match.grounds) ground.run(g.biomass, JSON.stringify(g.lastFishedBy), g.id)
  const boat = db.prepare('UPDATE commons_boats SET location = ?, standing_order = ? WHERE team_id = ? AND boat = ?')
  const team = db.prepare('UPDATE commons_teams SET fish = ?, bonus = ?, contract_id = ?, contract_progress = ?, contract_grounds = ?, completed = ? WHERE team_id = ?')
  for (const t of match.teams) {
    t.boats.forEach((b, i) => boat.run(b.location, b.order, t.id, i))
    team.run(t.fish, t.bonus, t.contract?.id ?? null, t.contract?.progress ?? 0, JSON.stringify(t.contract?.grounds ?? []), JSON.stringify(t.completed), t.id)
  }
  // Research is shared with the questions, so only the fishing cost is subtracted.
  for (const t of record.teams) if (t.paid) db.prepare('UPDATE teams SET research = research - ? WHERE id = ?').run(t.paid, t.id)
}
// Resolutions fall at fixed times after the start, the last one exactly at the
// end. Every request runs this first inside its transaction, so orders and
// Research are locked as of each resolution's time even when nobody was
// connected then. The stored number makes each step happen once.
export function advanceCommons(db: DatabaseSync, now = Date.now()) {
  const { startedAt, endsAt } = competitionState(db, now)
  if (startedAt === null || endsAt === null) return
  const due = Math.floor((Math.min(now, endsAt) - startedAt) / resolutionMs)
  const done = Number(db.prepare('SELECT COALESCE(MAX(number), 0) AS n FROM commons_resolutions').get()!.n)
  for (let number = done + 1; number <= due; number++) {
    const at = startedAt + number * resolutionMs
    // A step after the standings cutoff must not leak into the frozen table.
    freezeStandingsIfDue(db, at)
    const { match, record } = resolve(loadMatch(db), rules)
    saveMatch(db, match, record)
    const names = Object.fromEntries(db.prepare('SELECT id, name FROM teams').all().map(t => [String(t.id), String(t.name)]))
    db.prepare('INSERT INTO commons_resolutions (number, at, record) VALUES (?, ?, ?)').run(number, at, JSON.stringify({ number, at, names, ...record } satisfies StoredResolution))
  }
}

export const orderSchema = z.object({ boat: z.number().int().min(0).max(BOATS_PER_TEAM - 1), ground: z.string().max(8).nullable() }).strict()
export const contractSchema = z.object({ contract: z.string().max(40).nullable(), current: z.string().max(40).nullable() }).strict()
// Caller owns the transaction. Orders persist until changed; the last device wins.
export function setOrder(db: DatabaseSync, teamId: string, input: z.infer<typeof orderSchema>) {
  if (input.ground !== null && !db.prepare('SELECT id FROM commons_grounds WHERE id = ?').get(input.ground)) throw new ApiError(400, 'Choose one of the fishing grounds.')
  db.prepare('UPDATE commons_boats SET standing_order = ? WHERE team_id = ? AND boat = ?').run(input.ground, teamId, input.boat)
}
// `current` guards against a stale device silently abandoning a teammate's choice.
export function chooseContract(db: DatabaseSync, teamId: string, input: z.infer<typeof contractSchema>) {
  const team = db.prepare('SELECT contract_id, completed FROM commons_teams WHERE team_id = ?').get(teamId) as { contract_id: string | null; completed: string }
  if (team.contract_id !== input.current) throw new ApiError(409, 'A teammate has already changed your contract. Check it again.')
  if (input.contract === team.contract_id) return
  if (input.contract !== null) {
    const grounds = db.prepare('SELECT id FROM commons_grounds').all() as { id: string }[]
    if (!availableContracts(rules, grounds).some(c => c.id === input.contract)) throw new ApiError(400, 'That contract is not available.')
    if ((JSON.parse(team.completed) as string[]).includes(input.contract)) throw new ApiError(400, 'Your team has already completed this contract.')
  }
  db.prepare("UPDATE commons_teams SET contract_id = ?, contract_progress = 0, contract_grounds = '[]' WHERE team_id = ?").run(input.contract, teamId)
}

export function teamScore(db: DatabaseSync, teamId: string) {
  const row = db.prepare('SELECT fish, bonus FROM commons_teams WHERE team_id = ?').get(teamId)!
  return { fish: Number(row.fish), bonus: Number(row.bonus), score: Number(row.fish) + Number(row.bonus) }
}
const stored = (row: Record<string, unknown> | undefined) => row ? JSON.parse(String(row.record)) as StoredResolution : null
// Everything here is public except the viewing team's own contract progress,
// Research and, once standings freeze, rivals' catches.
export function gameState(db: DatabaseSync, teamId: string): GameState {
  const match = loadMatch(db), { startedAt, endsAt } = competitionState(db)
  const frozen = Boolean(db.prepare("SELECT 1 FROM config WHERE key = 'standings_snapshot'").get())
  const own = match.teams.find(t => t.id === teamId)!
  const teams = db.prepare('SELECT id, name, color FROM teams ORDER BY name COLLATE NOCASE, id').all() as { id: string; name: string; color: string }[]
  const last = stored(db.prepare('SELECT record FROM commons_resolutions ORDER BY number DESC LIMIT 1').get())
  const definition = own.contract && rules.contracts.find(c => c.id === own.contract!.id)
  return {
    rules: { resolutionSeconds: rules.resolutionSeconds, fishingCost: rules.fishingCost, catchAmount: rules.catchAmount, growthCap: rules.growthCap },
    resolution: last?.number ?? 0,
    totalResolutions: startedAt === null || endsAt === null ? 0 : Math.floor((endsAt - startedAt) / resolutionMs),
    grounds: match.grounds.map(g => ({ id: g.id, biomass: g.biomass, max: g.max, growth: growth(g.biomass, g.max, rules.growthCap) })),
    teams: teams.map(t => { const state = match.teams.find(m => m.id === t.id)!; return { ...t, boats: state.boats, contract: state.contract?.id ?? null } }),
    contracts: availableContracts(rules, match.grounds).map(c => ({ ...c, bonus: bonusFor(c, rules) })),
    own: { fish: own.fish, bonus: own.bonus, completed: own.completed, contract: own.contract && definition ? { id: own.contract.id, progress: own.contract.progress, target: definition.target } : null },
    last: last && {
      number: last.number, at: last.at, grounds: last.grounds, own: last.teams.find(t => t.id === teamId) ?? null,
      teams: last.teams.filter(t => t.id !== teamId).map(t => ({ id: t.id, caught: frozen ? null : t.caught, boats: t.boats.map(b => ({ ...b, caught: frozen ? null : b.caught })) })),
    },
  }
}
export function matchHistory(db: DatabaseSync) {
  const { startedAt } = competitionState(db)
  const { groundCount: _formula, ...values } = rules
  return { exportedAt: new Date().toISOString(), startedAt, rules: values, resolutions: db.prepare('SELECT record FROM commons_resolutions ORDER BY number').all().map(row => stored(row)) }
}
