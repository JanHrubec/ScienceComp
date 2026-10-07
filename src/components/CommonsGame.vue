<script setup lang="ts">
import { t, fish, boats } from '../i18n'
import { computed, reactive, ref, watch } from 'vue'
import { teamState, acceptState, refreshState, session } from '../state'
import { api, errorMessage } from '../api'
import { competition, secondsLeft } from '../competition'
import type { BoatOrder, BoatReport, GameState, TeamState } from '../../shared/domain'
import TeamScores from './TeamScores.vue'
type Contract = GameState['contracts'][number]
interface Taking { id: string; taken: number }
const busy = ref(false), error = ref(''), selected = ref(0)
// The taking of a contract the player asked to abandon, until they confirm. A later taking,
// even of the same contract, never inherits it.
const abandoning = ref<Taking | null>(null)
// Orders given while a request is in flight wait here, the latest per boat, and follow in turn rather than being dropped.
const queued = reactive(new Map<number, number | null>()), sending = ref<{ boat: number; ground: number | null } | null>(null)
const game = computed(() => teamState.value!.game)
const myId = computed(() => teamState.value!.team.id)
const myBoats = computed(() => game.value.teams.find(team => team.id === myId.value)?.boats ?? [])
const boat = computed<BoatOrder | undefined>(() => myBoats.value[selected.value])
const own = computed(() => game.value.own)
// What a boat will be ordered to once this device's pending orders arrive, and whether any are still pending.
const wanted = (i: number) => queued.has(i) ? queued.get(i)! : sending.value?.boat === i ? sending.value.ground : myBoats.value[i]?.order ?? null
const pending = (i: number) => queued.has(i) || sending.value?.boat === i
const name = (ground: number | null) => ground === null ? '' : game.value.grounds[ground]?.name ?? '?'
const initials = (text: string) => text.split(/\s+/).slice(0, 2).map(v => v[0]).join('').toUpperCase()
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
// Counts down on the competition's server-synchronised clock, not the device clock.
const nextIn = computed(() => {
  const c = competition.value, next = game.value.resolution.nextAt
  if (!c?.endsAt || next === null || secondsLeft.value === null) return null
  return Math.max(0, secondsLeft.value - Math.round((c.endsAt - next) / 1000))
})
interface Chip { key: string; color: string; label: string; own: boolean; state: 'fishing' | 'idle' | 'leaving' | 'arriving'; title: string }
const chips = computed(() => game.value.grounds.map(g => game.value.teams.flatMap(team => team.boats.flatMap((b, i): Chip[] => {
  const base = { key: `${team.id}-${i}`, color: team.color, label: `${initials(team.name)}${i + 1}`, own: team.id === myId.value }
  const who = t('{team}, boat {boat}', { team: team.name, boat: i + 1 })
  if (b.ground === g.id) {
    const state = b.order === g.id ? 'fishing' : b.order === null ? 'idle' : 'leaving'
    return [{ ...base, state, title: `${who}: ${state === 'fishing' ? t('fishing here') : state === 'idle' ? t('idle here') : t('leaving for {ground}', { ground: name(b.order) })}` }]
  }
  return b.order === g.id ? [{ ...base, state: 'arriving', title: `${who}: ${t('travelling here')}` }] : []
}))))
const fishingNext = (id: number) => chips.value[id]!.filter(c => c.state === 'fishing').length
function status(b: BoatOrder) {
  if (b.order === null) return b.ground === null ? t('In harbour, idle') : t('Idle at {ground}', { ground: name(b.ground) })
  if (b.order !== b.ground) return t('Travels to {ground} at the next resolution', { ground: name(b.order) })
  return t('Fishing at {ground}', { ground: name(b.ground) })
}
const fishingBoats = computed(() => myBoats.value.filter((b, i) => b.ground !== null && wanted(i) === b.ground).length)
const shortOfResearch = computed(() => teamState.value!.team.research < fishingBoats.value * game.value.rules.fishingCost)
function groundLabel(g: GameState['grounds'][number]) {
  const n = selected.value + 1, here = wanted(selected.value) === g.id
  const action = here ? (boat.value?.ground === g.id ? t('Boat {boat} is fishing here', { boat: n }) : t('Boat {boat} is heading here', { boat: n })) : t('Send boat {boat} here', { boat: n })
  return `${t('Ground {ground}', { ground: g.name })}: ${t('{count} of {maximum} fish', { count: g.biomass, maximum: g.maximum })}, ${t('growth +{growth}', { growth: g.growth })}; ${t('{boats} fishing next', { boats: boats(fishingNext(g.id)) })}. ${action}${here && pending(selected.value) ? `. ${t('Sending…')}` : ''}`
}
function contractTitle(c: Contract) { return c.kind === 'variety' ? t('Fish at {count} different grounds', { count: c.target }) : t('Catch {fish}', { fish: fish(c.target, true) }) }
function contractConditions(c: Contract) {
  if (c.kind !== 'catch') return []
  return [
    ...c.ground !== undefined ? [t('Only at ground {ground}.', { ground: c.ground })] : [],
    ...c.minBiomass !== undefined ? [t('Only where the ground holds at least {count} fish as the resolution starts.', { count: c.minBiomass })] : [],
    ...c.quiet ? [t('Only where no other team fished in the previous resolution.')] : [],
  ]
}
const pursuing = (c: Contract) => game.value.teams.filter(team => team.contract === c.id)
const activeContract = computed(() => game.value.contracts.find(c => c.id === own.value.contract?.id))
function boatResult(b: BoatReport) {
  const values = { boat: b.boat, ground: name(b.order) }
  if (b.action === 'fish') return t('Boat {boat} caught {fish} at {ground}.', { ...values, fish: fish(b.caught, true) })
  if (b.action === 'travel') return t('Boat {boat} travelled to {ground}.', values)
  if (b.action === 'unpaid') return t('Boat {boat} could not fish at {ground}: not enough Research.', values)
  return t('Boat {boat} was idle.', values)
}
const completedBonus = computed(() => game.value.contracts.find(c => c.id === game.value.last?.completed)?.bonus ?? 0)
// A response or failure that arrives once the session has changed belongs to the old session and is dropped.
async function request(path: 'order' | 'contract', input: object) {
  const from = session.value
  try { const value = await api<TeamState>(`/team/game/${path}`, input); if (from === session.value) acceptState(value) }
  catch (e) { if (from === session.value) { error.value = errorMessage(e); await refreshState() } }
}
// One request at a time: an optional contract action, then every waiting order.
async function run(first?: () => Promise<void>) {
  busy.value = true
  try {
    await first?.()
    for (let next = [...queued][0]; next; next = [...queued][0]) {
      const [i, ground] = next; queued.delete(i)
      if (myBoats.value[i]?.order === ground) continue // already so: a teammate gave the same order meanwhile
      sending.value = { boat: i, ground }; await request('order', { boat: i + 1, ground })
    }
  } finally { busy.value = false; sending.value = null }
}
function order(ground: number | null) {
  const i = selected.value, b = boat.value
  if (!b || wanted(i) === ground) return
  error.value = ''
  // Going back to the order already given (or being sent) just withdraws the waiting one.
  if (ground === (sending.value?.boat === i ? sending.value.ground : b.order)) queued.delete(i); else queued.set(i, ground)
  if (!busy.value) return run()
}
// Contract buttons are disabled while busy. `current` is the taking the player acted on, so the server
// refuses the change if it has moved on, even to the same contract abandoned and taken again.
function choose(contract: string | null, current: Taking | null = own.value.contract) {
  if (busy.value) return
  abandoning.value = null; error.value = ''
  return run(() => request('contract', { contract, current: current?.id ?? null, taken: current?.taken }))
}
function abandon() { const c = own.value.contract; if (c?.progress) abandoning.value = { id: c.id, taken: c.taken }; else return choose(null) }
// Waiting orders belong to the session that gave them: they are dropped the moment it ends,
// before anything renders, so they never go out with the next session's cookie.
watch(session, () => queued.clear(), { flush: 'sync' })
</script>
<template>
  <main class="commons">
    <h1 class="sr-only">{{ t('Game') }}</h1>
    <div class="commons-status">
      <p class="resolution-clock">
        <template v-if="nextIn !== null">{{ t('Resolution {number} of {total} in', { number: game.resolution.done + 1, total: game.resolution.total }) }} <strong>{{ nextIn > 0 ? clock(nextIn) : t('now') }}</strong></template>
        <template v-else>{{ t('All {total} resolutions are complete.', { total: game.resolution.total }) }}</template>
      </p>
      <p class="own-score" aria-live="polite"><strong>{{ t('Score {score}', { score: own.fish + own.bonus }) }}</strong> <span class="hint">{{ t('{fish} caught + {bonus} bonus', { fish: own.fish, bonus: own.bonus }) }}</span></p>
    </div>
    <p class="feedback error" role="status">{{ t(error) }}</p>
    <div class="commons-layout">
      <div class="commons-main">
        <section class="fleet" :aria-label="t('Your boats')">
          <div class="boat-picker">
            <button v-for="(b, i) in myBoats" :key="i" class="boat-choice" :class="{ selected: selected === i }" :aria-pressed="selected === i" @click="selected = i">
              <span class="boat-name">{{ t('Boat {boat}', { boat: i + 1 }) }}</span><span class="boat-status">{{ status({ ...b, order: wanted(i) }) }}<template v-if="pending(i)">{{ ' ' }}<span class="boat-sending">· {{ t('Sending…') }}</span></template></span>
            </button>
            <button class="secondary idle-button" :disabled="!boat || wanted(selected) === null" @click="order(null)">{{ t('Leave boat {boat} idle', { boat: selected + 1 }) }}</button>
          </div>
          <p class="hint fleet-hint">{{ t('Choose a ground for boat {boat}. Each fishing boat costs {cost} Research per resolution.', { boat: selected + 1, cost: game.rules.fishingCost }) }}<span v-if="shortOfResearch" class="error"> {{ t('Not enough Research for every fishing boat: boat 1 is paid first.') }}</span></p>
        </section>
        <section class="grounds" :aria-label="t('Fishing grounds')">
          <button v-for="g in game.grounds" :key="g.id" class="ground" :class="{ target: wanted(selected) === g.id, sending: wanted(selected) === g.id && pending(selected) }" :aria-label="groundLabel(g)" @click="order(g.id)">
            <span class="ground-head"><span class="ground-name">{{ g.name }}</span><span class="ground-stock"><strong>{{ g.biomass }}</strong> / {{ g.maximum }}</span></span>
            <span class="stock-bar" aria-hidden="true"><span :style="{ width: `${100 * g.biomass / g.maximum}%` }" /></span>
            <span class="ground-growth">{{ t('growth +{growth}', { growth: g.growth }) }}</span>
            <span class="chips" aria-hidden="true"><span v-for="chip in chips[g.id]" :key="chip.key" class="chip" :class="[chip.state, { own: chip.own }]" :style="{ '--team': chip.color }" :title="chip.title">{{ chip.state === 'arriving' ? '→' : '' }}{{ chip.label }}{{ chip.state === 'leaving' ? '→' : '' }}</span></span>
          </button>
        </section>
        <p class="hint chip-legend"><span class="chip fishing" style="--team: #686d69">AB1</span> {{ t('fishing next') }} <span class="chip idle" style="--team: #686d69">AB1</span> {{ t('idle') }} <span class="chip leaving" style="--team: #686d69">AB1→</span> {{ t('leaving') }} <span class="chip arriving" style="--team: #686d69">→AB1</span> {{ t('arriving') }}</p>
        <section class="contracts">
          <h2>{{ t('Contracts') }}</h2>
          <p class="hint">{{ t('Optional bonuses, once per team. One active contract at a time; abandoning it loses its progress.') }}</p>
          <ul>
            <li v-for="c in game.contracts" :key="c.id" :class="{ active: own.contract?.id === c.id, done: own.completed.includes(c.id) }">
              <div class="contract-text"><span class="contract-title">{{ contractTitle(c) }}</span><span v-for="condition in contractConditions(c)" :key="condition" class="hint contract-condition">{{ condition }}</span></div>
              <span class="contract-teams"><span v-for="team in pursuing(c)" :key="team.id" class="chip" :class="{ own: team.id === myId }" :style="{ '--team': team.color }" :title="team.name">{{ initials(team.name) }}</span><span class="sr-only">{{ pursuing(c).map(team => team.name).join(', ') }}</span></span>
              <span class="contract-bonus">+{{ c.bonus }}</span>
              <span class="contract-action">
                <span v-if="own.completed.includes(c.id)" class="success">{{ t('Completed') }}</span>
                <template v-else-if="own.contract?.id === c.id"><span class="contract-progress">{{ own.contract.progress }}/{{ c.target }}</span><button class="text-button" :disabled="busy" @click="abandon">{{ t('Abandon') }}</button></template>
                <button v-else class="secondary" :disabled="busy || own.contract !== null" :aria-label="`${t('Take')}: ${contractTitle(c)}`" @click="choose(c.id)">{{ t('Take') }}</button>
              </span>
            </li>
          </ul>
          <div v-if="abandoning && abandoning.taken === own.contract?.taken && activeContract" class="abandon-confirm" role="alertdialog" :aria-label="t('Abandon contract')">
            <p>{{ t('Abandon “{contract}”? Its progress ({progress}/{target}) will be lost.', { contract: contractTitle(activeContract), progress: own.contract.progress, target: activeContract.target }) }}</p>
            <div><button class="danger-button" :disabled="busy" @click="choose(null, abandoning)">{{ t('Abandon') }}</button><button class="text-button" @click="abandoning = null">{{ t('Keep it') }}</button></div>
          </div>
        </section>
      </div>
      <aside class="commons-side">
        <section class="last-resolution" :aria-label="t('Last resolution')">
          <h2>{{ game.last ? t('Resolution {number}', { number: game.last.number }) : t('Last resolution') }}</h2>
          <template v-if="game.last">
            <ul class="boat-results"><li v-for="b in game.last.boats" :key="b.boat">{{ boatResult(b) }}</li></ul>
            <p v-if="game.last.completed" class="success">{{ t('Contract completed: +{bonus}', { bonus: completedBonus }) }}</p>
            <table class="ground-results"><thead><tr><th>{{ t('Ground') }}</th><th>{{ t('Start') }}</th><th>{{ t('Caught') }}</th><th>{{ t('Growth') }}</th><th>{{ t('Now') }}</th></tr></thead>
              <tbody><tr v-for="g in game.last.grounds" :key="g.id"><th scope="row">{{ name(g.id) }}</th><td>{{ g.before }}</td><td>{{ g.caught ? `−${g.caught}` : '0' }}</td><td>+{{ g.growth }}</td><td>{{ g.after }}</td></tr></tbody></table>
          </template>
          <p v-else class="hint">{{ t('Nothing has happened yet. Boats leaving harbour spend their first resolution travelling.') }}</p>
        </section>
        <section class="leaderboard">
          <h2>{{ t('Leaderboard') }}</h2>
          <p v-if="teamState!.standings.frozenAt !== null" class="hint">{{ t('Frozen for the final 5 minutes.') }}</p>
          <TeamScores :teams="teamState!.standings.teams" :current-team-id="myId" label="Leaderboard" />
        </section>
        <details class="how-it-works">
          <summary>{{ t('How it works') }}</summary>
          <p>{{ t('Teams share the fishing grounds. Give each of your two boats a ground or leave it idle; orders stay until you change them, and everyone can see them.') }}</p>
          <p>{{ t('Every {minutes} minutes all orders resolve at once. A fishing boat costs {cost} Research and catches up to {catch} fish. If a ground runs short, its fish are shared equally.', { minutes: game.rules.resolutionSeconds / 60, cost: game.rules.fishingCost, catch: game.rules.catchAmount }) }}</p>
          <p>{{ t('A boat sent to a different ground spends the next resolution travelling and fishes from the one after.') }}</p>
          <p>{{ t('Then every ground regrows: slowly when nearly empty, fastest in the middle, not at all when full.') }}</p>
          <p>{{ t('Score: fish caught plus contract bonuses. Unused Research is worth nothing.') }}</p>
        </details>
      </aside>
    </div>
  </main>
</template>
