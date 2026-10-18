export const TEAM_SKIP_LIMIT = 5
export const subjects = ['physics', 'computer-science', 'biology', 'chemistry', 'ess', 'math'] as const
export type Subject = typeof subjects[number]
export const subjectNames: Record<Subject, string> = { physics: 'Physics', 'computer-science': 'Computer Science', biology: 'Biology', chemistry: 'Chemistry', ess: 'ESS', math: 'Mathematics' }
export const ages = ['11–13', '14–16', '17–18'] as const
export type AgeCategory = typeof ages[number]
export type Language = 'en' | 'cs'
export interface PublicQuestion { cs: { prompt: string; choices?: string[] }; id: string; prompt: string; type: 'multiple-choice' | 'text' | 'numerical'; choices?: string[]; reward: number }
export interface QuestionProgress { completed: number; total: number; attempts: number; question: PublicQuestion | null }
export interface Team { id: string; name: string; age: AgeCategory; research: number; earned: number; skipsUsed: number; color: string }
// The Commons: a live map. Tiles are { x, y }; `land` rows use '#' for island and '.' for sea.
export interface Tile { x: number; y: number }
// A boat is sent to a tile, or to a fishing ground (a "school") by id.
export type BoatOrder = Tile | { school: number }
// Orders the game endpoint accepts: a destination, or the bait switch.
export type GameOrder = BoatOrder | { bait: boolean }
export interface GameState {
  rules: { tickSeconds: number; fuelCost: number; catchEffort: number; hold: number; schoolMax: number; growthTicks: number; growthCap: number; goldenMax: number; goldenCap: number; goldenValue: number; baitBoost: number; baitCost: number; baitReserve: number }
  clock: { tick: number; total: number }
  map: { width: number; height: number; land: string[]; harbour: Tile } | null
  // Fixed fishing grounds. `sail`: tiles from this team's boat; `home`: tiles from the harbour.
  schools: { id: number; x: number; y: number; fish: number; golden: boolean; sail: number; home: number }[]
  // Every boat, its order and route are public. `ahead`: its tiles over the next 3 ticks
  // if nobody gives an order. Research, scores, catch meter, hold and bait are not sent for other teams.
  boats: { team: string; name: string; color: string; x: number; y: number; target: BoatOrder | null; route: Tile[]; ahead: Tile[] }[]
  own: { fish: number; bonus: number; hauling: number; hold: number; bait: boolean }
}
export interface StandingsState {
  frozenAt: number | null
  teams: { id: string; name: string; color: string; score: number }[]
}
export interface CompetitionState {
  startedAt: number | null
  endsAt: number | null
  durationSeconds: number
  serverNow: number
  status: 'waiting' | 'running' | 'finished'
  booklets: Record<Subject, string>
}
export interface TeamState { competition: CompetitionState; team: Team; progress: Record<Subject, QuestionProgress>; game: GameState; standings: StandingsState }
export interface AdminTeam extends Team { score: number; fish: number; bonus: number; code: string; progress: Record<Subject, { completed: number; total: number }> }
