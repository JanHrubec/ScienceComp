import { computed, ref } from 'vue'
import type { CompetitionState } from '../shared/domain'
import { api } from './api'
export const competition = ref<CompetitionState | null>(null)
const elapsed = ref(0)
let receivedAt = 0
export function acceptCompetition(value: CompetitionState) {
  // Discard responses produced before a more recent poll or admin action.
  if (competition.value && value.serverNow < competition.value.serverNow) return
  competition.value = value
  receivedAt = performance.now()
  elapsed.value = 0
}
export const secondsLeft = computed(() => {
  const state = competition.value
  if (!state) return null
  if (state.endsAt === null) return state.durationSeconds
  return Math.max(0, Math.ceil((state.endsAt - state.serverNow - elapsed.value) / 1000))
})
export const competitionStatus = computed(() => {
  if (!competition.value) return 'loading'
  if (competition.value.startedAt === null) return 'waiting'
  return secondsLeft.value === 0 ? 'finished' : 'running'
})
export async function refreshCompetition() {
  try { acceptCompetition(await api<CompetitionState>('/competition')) } catch { /* Team/admin requests show connection errors; keep the clock ticking. */ }
}
export function startCompetitionClock() {
  let stopped = false, pollTimer: ReturnType<typeof setTimeout>
  const tickTimer = setInterval(() => { elapsed.value = performance.now() - receivedAt }, 250)
  async function poll() { await refreshCompetition(); if (!stopped) pollTimer = setTimeout(poll, 1500) }
  void poll()
  return () => { stopped = true; clearTimeout(pollTimer); clearInterval(tickTimer) }
}
