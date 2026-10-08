export const TEAM_SKIP_LIMIT = 5
export const subjects = ['physics', 'computer-science', 'biology', 'chemistry', 'ess'] as const
export type Subject = typeof subjects[number]
export const subjectNames: Record<Subject, string> = { physics: 'Physics', 'computer-science': 'Computer Science', biology: 'Biology', chemistry: 'Chemistry', ess: 'ESS' }
export const ages = ['11–13', '14–16', '17–18'] as const
export type AgeCategory = typeof ages[number]
export type Language = 'en' | 'cs'
export interface PublicQuestion { cs: { prompt: string; choices?: string[] }; id: string; prompt: string; type: 'multiple-choice' | 'text' | 'numerical'; choices?: string[]; reward: number }
export interface QuestionProgress { completed: number; total: number; attempts: number; question: PublicQuestion | null }
export interface Team { id: string; name: string; age: AgeCategory; research: number; earned: number; skipsUsed: number; color: string }
// The Commons: a live map. Tiles are { x, y }; `land` rows use '#' for island and '.' for sea.
export interface Tile { x: number; y: number }
// A boat is sent to a tile, or to a school by id, which it then follows.
export type BoatOrder = Tile | { school: number }
export interface GameState {
  rules: { tickSeconds: number; fuelCost: number; catchTicks: number; goldenValue: number }
  // `nextAt`: when the next tick is due, or null once the match is over.
  clock: { tick: number; total: number; nextAt: number | null }
  map: { width: number; height: number; land: string[]; harbour: Tile } | null
  // A golden school swims off at tick `until`. `sail`: tiles from this team's boat.
  schools: { id: number; x: number; y: number; fish: number; golden: boolean; until: number | null; sail: number }[]
  // Every boat, its order and route are public. Research and scores are not sent,
  // though a determined team could estimate scores by watching.
  boats: { team: string; name: string; color: string; x: number; y: number; target: BoatOrder | null; route: Tile[]; hauling: number }[]
  own: { fish: number; bonus: number }
  // The latest golden-school events, newest first.
  golden: { tick: number; kind: 'appeared' | 'caught' | 'gone'; x: number; y: number; team: string | null; name: string | null }[]
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
