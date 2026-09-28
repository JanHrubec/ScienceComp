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
export interface GameState {
  size: number
  diamonds: number
  cells: { x: number; y: number; stock: number }[]
  teams: { id: string; name: string; color: string; x: number; y: number }[]
}
export interface StandingsState {
  frozenAt: number | null
  teams: { id: string; name: string; color: string; diamonds: number }[]
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
export interface AdminTeam extends Team { diamonds: number; code: string; progress: Record<Subject, { completed: number; total: number }> }
