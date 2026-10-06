import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { ApiError } from '../db.js'
import { competitionState, DURATION_SECONDS } from '../competition.js'
import type { GameState, StandingsState } from '../../shared/domain.js'
import { commonsConfig as config } from './config.js'
import { BOATS_PER_TEAM, availableContracts, contractBonus, groundName, growth, newGrounds, resolve, type MatchState } from './rules.js'

export const orderSchema = z.object({ boat: z.number().int().min(1).max(BOATS_PER_TEAM), ground: z.number().int().min(0).nullable() }).strict()
// `current` is the contract the device last saw and `taken` which taking of it, so a teammate's
// choice is never silently replaced, not even the same contract abandoned and taken again.
export const contractSchema = z.object({ contract: z.string().min(1).max(60).nullable(), current: z.string().min(1).max(60).nullable(), taken: z.number().int().min(0).optional() }).strict()
export const totalResolutions = () => Math.floor(DURATION_SECONDS / config.resolutionSeconds)
interface TeamRow { id: string; research: number; fish: number; bonus: number; contract: string | null; progress: number; visited: string; completed: string; taken: number }
const legacyTables = ['grid_cells', 'grid_scores', 'grid_positions']

export function initializeGame(db: DatabaseSync, now = Date.now()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS commons_grounds (
      id INTEGER PRIMARY KEY, biomass INTEGER NOT NULL CHECK(biomass >= 0), maximum INTEGER NOT NULL,
      fished_by TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS commons_teams (
      team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
      fish INTEGER NOT NULL DEFAULT 0, bonus INTEGER NOT NULL DEFAULT 0,
      contract TEXT, progress INTEGER NOT NULL DEFAULT 0, visited TEXT NOT NULL DEFAULT '[]', completed TEXT NOT NULL DEFAULT '[]',
      taken INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS commons_boats (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, boat INTEGER NOT NULL,
      ground INTEGER, target INTEGER, PRIMARY KEY(team_id, boat)
    );
    CREATE TABLE IF NOT EXISTS commons_resolutions (number INTEGER PRIMARY KEY, at INTEGER NOT NULL, record TEXT NOT NULL);
    INSERT OR IGNORE INTO commons_teams (team_id) SELECT id FROM teams;
  `)
  for (let boat = 1; boat <= BOATS_PER_TEAM; boat++) db.prepare('INSERT OR IGNORE INTO commons_boats (team_id, boat) SELECT id, ? FROM teams').run(boat)
  // Commons databases from before takings were numbered; their active contracts count as taking 0.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('commons_teams') WHERE name = 'taken'").get()) db.exec('ALTER TABLE commons_teams ADD COLUMN taken INTEGER NOT NULL DEFAULT 0')
  const legacy = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${legacyTables.map(() => '?').join(', ')})`).all(...legacyTables).map(row => String(row.name))
  const { startedAt } = competitionState(db, now)
  if (legacy.length && startedAt !== null) endLegacyRound(db, startedAt, legacy.includes('grid_scores'), now)
  // Between rounds, the diamond prototype's tables and any snapshot of its scores are obsolete.
  else if (legacy.length) { dropLegacyTables(db); db.prepare("DELETE FROM config WHERE key = 'standings_snapshot'").run() }
}
const dropLegacyTables = (db: DatabaseSync) => { for (const table of legacyTables) db.exec(`DROP TABLE IF EXISTS ${table}`) }
interface LegacyStandings { frozenAt: number; teams: { id: string; name: string; color: string; score?: number; diamonds?: number }[] }
// A diamond round that started but was not reset must neither run on under the
// longer Commons duration nor lose its results. It ends now, gets no grounds, and
// keeps its grid_* tables and standings (diamonds as score) until the next reset.
// Admin reads scores from commons_teams, so the final diamonds are counted there as
// fish. Repeating this is harmless, so the reminder is logged on every start until then.
function endLegacyRound(db: DatabaseSync, startedAt: number, scores: boolean, now: number) {
  db.prepare("UPDATE config SET value = ? WHERE key = 'started_at'").run(String(Math.min(startedAt, now - DURATION_SECONDS * 1000)))
  const final = scores ? db.prepare('SELECT t.id, t.name, t.color, s.diamonds FROM teams t JOIN grid_scores s ON s.team_id = t.id ORDER BY s.diamonds DESC, t.name COLLATE NOCASE, t.id').all() as unknown as LegacyStandings['teams'] : []
  const saved = db.prepare("SELECT value FROM config WHERE key = 'standings_snapshot'").get()
  const standings: LegacyStandings | null = saved ? JSON.parse(String(saved.value)) : scores ? { frozenAt: now, teams: final } : null
  if (standings) db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('standings_snapshot', ?)").run(JSON.stringify({ frozenAt: standings.frozenAt, teams: standings.teams.map(({ diamonds, ...team }) => ({ ...team, score: team.score ?? diamonds ?? 0 })) }))
  if (scores) db.exec('UPDATE commons_teams SET fish = COALESCE((SELECT s.diamonds FROM grid_scores s WHERE s.team_id = commons_teams.team_id), 0), bonus = 0')
  console.warn(`The database holds a diamond-prototype round that was never reset. It has been ended instead of continuing as The Commons, and its results stay in the grid_* tables until you reset the competition in admin, which you must do before the next round.${final.length ? ` Final diamonds: ${final.map(t => `${t.name} ${t.diamonds}`).join(', ')}.` : ''}`)
}
const groundCount = (db: DatabaseSync) => Number(db.prepare('SELECT COUNT(*) AS n FROM commons_grounds').get()!.n)
function createGrounds(db: DatabaseSync) {
  const teams = Number(db.prepare('SELECT COUNT(*) AS n FROM teams').get()!.n)
  const insert = db.prepare('INSERT INTO commons_grounds (id, biomass, maximum) VALUES (?, ?, ?)')
  newGrounds(teams, config).forEach((ground, id) => insert.run(id, ground.biomass, ground.maximum))
}
function clearTeam(db: DatabaseSync, teamId?: string) {
  const where = teamId === undefined ? '' : ' WHERE team_id = ?', args = teamId === undefined ? [] : [teamId]
  db.prepare(`UPDATE commons_teams SET fish = 0, bonus = 0, contract = NULL, progress = 0, visited = '[]', completed = '[]'${where}`).run(...args)
  db.prepare(`UPDATE commons_boats SET ground = NULL, target = NULL${where}`).run(...args)
}
// A team joining or re-joining a running match receives the same starting Research.
function grantStartingResearch(db: DatabaseSync, teamId?: string) {
  if (!config.startingResearch || competitionState(db).status !== 'running') return
  db.prepare(`UPDATE teams SET research = research + ?${teamId === undefined ? '' : ' WHERE id = ?'}`).run(config.startingResearch, ...(teamId === undefined ? [] : [teamId]))
}
export function createTeamGame(db: DatabaseSync, teamId: string) {
  db.prepare('INSERT INTO commons_teams (team_id) VALUES (?)').run(teamId)
  for (let boat = 1; boat <= BOATS_PER_TEAM; boat++) db.prepare('INSERT INTO commons_boats (team_id, boat) VALUES (?, ?)').run(teamId, boat)
  grantStartingResearch(db, teamId)
}
export function resetTeamGame(db: DatabaseSync, teamId: string) { clearTeam(db, teamId); grantStartingResearch(db, teamId) }
export function resetGame(db: DatabaseSync) {
  db.exec('DELETE FROM commons_grounds; DELETE FROM commons_resolutions;')
  clearTeam(db)
  // Including the results of a diamond round the upgrade ended.
  dropLegacyTables(db)
}
// Called in the same transaction that records the start time.
export function startGame(db: DatabaseSync) { resetGame(db); createGrounds(db); grantStartingResearch(db) }

// Prepares once, then reads the whole match from the database on every call.
function matchLoader(db: DatabaseSync): () => MatchState {
  const boatRows = db.prepare('SELECT team_id, ground, target FROM commons_boats ORDER BY team_id, boat')
  const teamRows = db.prepare('SELECT t.id, t.research, c.* FROM teams t JOIN commons_teams c ON c.team_id = t.id ORDER BY t.name COLLATE NOCASE, t.id')
  const groundRows = db.prepare('SELECT biomass, maximum, fished_by FROM commons_grounds ORDER BY id')
  return () => {
    const boats = boatRows.all() as unknown as { team_id: string; ground: number | null; target: number | null }[]
    return {
      grounds: (groundRows.all() as unknown as { biomass: number; maximum: number; fished_by: string }[]).map(g => ({ biomass: g.biomass, maximum: g.maximum, fishedBy: JSON.parse(g.fished_by) })),
      teams: (teamRows.all() as unknown as TeamRow[]).map(t => ({
        id: t.id, research: t.research, fish: t.fish, bonus: t.bonus, completed: JSON.parse(t.completed),
        contract: t.contract === null ? null : { id: t.contract, progress: t.progress, visited: JSON.parse(t.visited) },
        boats: boats.filter(b => b.team_id === t.id).map(b => ({ ground: b.ground, order: b.target })),
      })),
    }
  }
}
export const resolutionsDone = (db: DatabaseSync) => Number(db.prepare('SELECT COUNT(*) AS n FROM commons_resolutions').get()!.n)
// How many resolutions of a match started at `startedAt` are scheduled at or before `at`.
export const resolutionsDue = (startedAt: number, at: number) => Math.max(0, Math.min(totalResolutions(), Math.floor((at - startedAt) / (config.resolutionSeconds * 1000))))

// Runs resolutions `done` + 1 to `due` inside the transaction that counted `done`.
// Each number runs once, so repeated or concurrent calls are harmless, and a
// resolution only ever sees orders and Research committed before it ran. A long
// catch-up holds the write lock, so statements are prepared once per call.
export function resolveDue(db: DatabaseSync, startedAt: number, done: number, due: number) {
  if (due <= done) return
  const load = matchLoader(db), names = new Map(db.prepare('SELECT id, name FROM teams').all().map(r => [String(r.id), String(r.name)]))
  const setGround = db.prepare('UPDATE commons_grounds SET biomass = ?, fished_by = ? WHERE id = ?')
  const pay = db.prepare('UPDATE teams SET research = research - ? WHERE id = ?')
  const setTeam = db.prepare('UPDATE commons_teams SET fish = ?, bonus = ?, contract = ?, progress = ?, visited = ?, completed = ? WHERE team_id = ?')
  const setBoat = db.prepare('UPDATE commons_boats SET ground = ? WHERE team_id = ? AND boat = ?')
  const insert = db.prepare('INSERT INTO commons_resolutions (number, at, record) VALUES (?, ?, ?)')
  for (let number = done + 1; number <= due; number++) {
    const before = load(), { state, report } = resolve(before, config)
    state.grounds.forEach((g, id) => setGround.run(g.biomass, JSON.stringify(g.fishedBy), id))
    for (const team of state.teams) {
      const paid = report.teams.find(r => r.id === team.id)!.paid
      if (paid) pay.run(paid, team.id)
      setTeam.run(team.fish, team.bonus, team.contract?.id ?? null, team.contract?.progress ?? 0, JSON.stringify(team.contract?.visited ?? []), JSON.stringify(team.completed), team.id)
      team.boats.forEach((boat, index) => setBoat.run(boat.ground, team.id, index + 1))
    }
    // Enough to replay the match: the state before, every order, and the outcome.
    const record = { number, at: startedAt + number * config.resolutionSeconds * 1000, before: { ...before, teams: before.teams.map(t => ({ ...t, name: names.get(t.id) })) }, report }
    insert.run(number, record.at, JSON.stringify(record))
  }
}

export function setOrder(db: DatabaseSync, teamId: string, input: z.infer<typeof orderSchema>) {
  if (input.ground !== null && input.ground >= groundCount(db)) throw new ApiError(400, 'Choose a fishing ground.')
  db.prepare('UPDATE commons_boats SET target = ? WHERE team_id = ? AND boat = ?').run(input.ground, teamId, input.boat)
}
export function setContract(db: DatabaseSync, teamId: string, input: z.infer<typeof contractSchema>) {
  const row = db.prepare('SELECT contract, taken, completed FROM commons_teams WHERE team_id = ?').get(teamId) as { contract: string | null; taken: number; completed: string }
  if (row.contract !== input.current || (row.contract !== null && row.taken !== input.taken)) throw new ApiError(409, 'A teammate has changed your contract. Check it again.')
  if (input.contract !== null) {
    if (!availableContracts(config, groundCount(db)).some(c => c.id === input.contract)) throw new ApiError(400, 'That contract is not available.')
    if ((JSON.parse(row.completed) as string[]).includes(input.contract)) throw new ApiError(400, 'Your team has already completed that contract.')
  }
  // Taking a new contract or abandoning one always starts progress from zero. Each taking gets the next number.
  if (input.contract !== row.contract) db.prepare("UPDATE commons_teams SET contract = ?, progress = 0, visited = '[]', taken = taken + ? WHERE team_id = ?").run(input.contract, input.contract === null ? 0 : 1, teamId)
}

export function gameState(db: DatabaseSync, teamId: string, startedAt: number | null): GameState {
  const done = resolutionsDone(db), total = totalResolutions()
  const grounds = db.prepare('SELECT id, biomass, maximum FROM commons_grounds ORDER BY id').all() as unknown as { id: number; biomass: number; maximum: number }[]
  const boats = db.prepare('SELECT team_id, ground, target FROM commons_boats ORDER BY boat').all() as unknown as { team_id: string; ground: number | null; target: number | null }[]
  const teams = db.prepare('SELECT t.id, t.name, t.color, c.contract FROM teams t JOIN commons_teams c ON c.team_id = t.id ORDER BY t.name COLLATE NOCASE, t.id').all() as unknown as { id: string; name: string; color: string; contract: string | null }[]
  const own = db.prepare('SELECT * FROM commons_teams WHERE team_id = ?').get(teamId) as unknown as TeamRow
  const last = db.prepare('SELECT record FROM commons_resolutions ORDER BY number DESC LIMIT 1').get()
  const record = last ? JSON.parse(String(last.record)) as { number: number; report: ReturnType<typeof resolve>['report'] } : null
  return {
    rules: { resolutionSeconds: config.resolutionSeconds, fishingCost: config.fishingCost, catchAmount: config.catchAmount, growthCap: config.growthCap },
    resolution: { done, total, nextAt: startedAt !== null && done < total ? startedAt + (done + 1) * config.resolutionSeconds * 1000 : null },
    grounds: grounds.map(g => ({ ...g, name: groundName(g.id), growth: growth(g.biomass, g.maximum, config.growthCap) })),
    teams: teams.map(t => ({ ...t, boats: boats.filter(b => b.team_id === t.id).map(b => ({ ground: b.ground, order: b.target })) })),
    contracts: availableContracts(config, grounds.length).map(c => ({ ...c, bonus: contractBonus(c, config) })),
    own: { fish: own.fish, bonus: own.bonus, contract: own.contract === null ? null : { id: own.contract, progress: own.progress, taken: own.taken }, completed: JSON.parse(own.completed) },
    // Only this team's boat results and payments. Per-ground catches are not private:
    // they mostly follow from the public stock, and with public boat positions they let
    // a determined team estimate others' catches and scores even during the freeze.
    // The number of boats that paid is left out rather than handed over, though a
    // ground's catch often implies it.
    last: record && {
      number: record.number,
      grounds: record.report.grounds.map(({ boats: _, ...ground }) => ground),
      boats: record.report.boats.filter(b => b.team === teamId).map(({ team: _, ...boat }) => boat),
      completed: record.report.teams.find(t => t.id === teamId)?.completed ?? null,
    },
  }
}
export function liveScores(db: DatabaseSync): StandingsState['teams'] {
  return db.prepare('SELECT t.id, t.name, t.color, c.fish + c.bonus AS score FROM teams t JOIN commons_teams c ON c.team_id = t.id ORDER BY score DESC, t.name COLLATE NOCASE, t.id').all() as unknown as StandingsState['teams']
}
export function teamScore(db: DatabaseSync, teamId: string) {
  const row = db.prepare('SELECT fish, bonus FROM commons_teams WHERE team_id = ?').get(teamId) as { fish: number; bonus: number }
  return { score: row.fish + row.bonus, fish: row.fish, bonus: row.bonus }
}
export function matchHistory(db: DatabaseSync) {
  const { groundCount: _, ...values } = config
  return {
    config: { ...values, totalResolutions: totalResolutions(), grounds: groundCount(db) },
    resolutions: db.prepare('SELECT record FROM commons_resolutions ORDER BY number').all().map(r => JSON.parse(String(r.record))),
  }
}
