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
// The Commons: shared fishing grounds. Ground IDs are indexes; names are letters.
export type ContractDefinition =
  | { id: string; kind: 'catch'; target: number; ground?: string; minBiomass?: number; quiet?: boolean; bonus?: number }
  | { id: string; kind: 'variety'; target: number; bonus?: number }
export interface BoatOrder { ground: number | null; order: number | null }
export interface BoatReport { boat: number; from: number | null; order: number | null; action: 'fish' | 'travel' | 'idle' | 'unpaid'; paid: number; caught: number }
export interface GameState {
  rules: { resolutionSeconds: number; fishingCost: number; catchAmount: number; growthCap: number }
  resolution: { done: number; total: number; nextAt: number | null }
  grounds: { id: number; name: string; biomass: number; maximum: number; growth: number }[]
  // Every team's boats, orders and active contract are public. Scores are not sent,
  // though stock and boats let a determined team estimate them.
  teams: { id: string; name: string; color: string; contract: string | null; boats: BoatOrder[] }[]
  contracts: (ContractDefinition & { bonus: number })[]
  own: { fish: number; bonus: number; contract: { id: string; progress: number } | null; completed: string[] }
  last: {
    number: number
    grounds: { id: number; before: number; caught: number; growth: number; after: number }[]
    boats: BoatReport[]
    completed: string | null
  } | null
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
