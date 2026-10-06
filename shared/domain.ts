import type { Boat, BoatRecord, ContractDefinition, GroundRecord, TeamRecord } from './commons.js'
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
export type PublicContract = ContractDefinition & { bonus: number }
export interface GameState {
  rules: { resolutionSeconds: number; fishingCost: number; catchAmount: number; growthCap: number }
  resolution: number
  totalResolutions: number
  grounds: { id: string; biomass: number; max: number; growth: number }[]
  teams: { id: string; name: string; color: string; boats: Boat[]; contract: string | null }[]
  contracts: PublicContract[]
  own: { fish: number; bonus: number; completed: string[]; contract: { id: string; progress: number; target: number } | null }
  // Rivals' catches are null once standings freeze.
  last: { number: number; at: number; grounds: GroundRecord[]; own: TeamRecord | null; teams: { id: string; caught: number | null; boats: (Omit<BoatRecord, 'caught'> & { caught: number | null })[] }[] } | null
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
