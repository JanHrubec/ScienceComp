import { ref } from 'vue'
import { api, ApiError, errorMessage } from './api'
import { acceptCompetition } from './competition'
import type { TeamState } from '../shared/domain'
export const teamState = ref<TeamState | null>(null)
export const connectionError = ref('')
// Changes when this device signs out or finds itself signed in as another team (a login
// in another tab replaces the shared cookie), so work begun for one session never runs on in the next.
export const session = ref(0)
let generation = 0
export function acceptState(value: TeamState) { generation++; if (value.team.id !== teamState.value?.team.id) session.value++; acceptCompetition(value.competition); teamState.value = value; connectionError.value = '' }
export function clearState() { generation++; session.value++; teamState.value = null }
export async function refreshState() {
  const requestGeneration = generation
  try {
    const value = await api<TeamState>('/team/state')
    if (requestGeneration === generation) acceptState(value)
    return true
  } catch (error) {
    if (requestGeneration !== generation) return true
    if (error instanceof ApiError && error.status === 401) { clearState(); return false }
    connectionError.value = errorMessage(error)
    return true
  }
}
