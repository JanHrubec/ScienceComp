<script setup lang="ts">
import { t, fish, contractText } from '../i18n'
import { computed, ref } from 'vue'
import { teamState, acceptState, refreshState } from '../state'
import { api, errorMessage } from '../api'
import { secondsLeft } from '../competition'
import ScoreTable from './ScoreTable.vue'
import type { Boat, BoatRecord } from '../../shared/commons'
import type { GameState, TeamState } from '../../shared/domain'
type GameTeam = GameState['teams'][number]
const busy = ref(false), error = ref(''), selected = ref(0), confirmAbandon = ref(false)
const state = computed(() => teamState.value!)
const game = computed(() => state.value.game)
const me = computed(() => game.value.teams.find(team => team.id === state.value.team.id)!)
const boat = computed(() => me.value.boats[selected.value])
const frozen = computed(() => state.value.standings.frozenAt !== null)
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map(v => v[0]).join('').toUpperCase()
const tag = (team: GameTeam, index: number) => `${initials(team.name)}${index + 1}`
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
// Resolutions fall every interval after the start, so the shared countdown gives the next one.
const nextIn = computed(() => {
  const left = secondsLeft.value, interval = game.value.rules.resolutionSeconds
  if (left === null || game.value.resolution >= game.value.totalResolutions) return null
  return interval - (state.value.competition.durationSeconds - left) % interval
})
const fishingBoats = computed(() => me.value.boats.filter(b => b.order !== null && b.order === b.location).length)
const shortOfResearch = computed(() => state.value.team.research < fishingBoats.value * game.value.rules.fishingCost)
function boatStatus(b: Boat) {
  if (b.order === null) return b.location === null ? t('Idle in port') : t('Idle at {ground}', { ground: b.location })
  if (b.order === b.location) return t('Fishing at {ground}', { ground: b.order })
  return t('Heading to {ground}: travels next resolution, fishes after', { ground: b.order })
}
const states = { fishing: 'fishing', arriving: 'arriving', idle: 'idle here' } as const
const grounds = computed(() => game.value.grounds.map(ground => {
  const boats: { key: string; team: GameTeam; index: number; state: keyof typeof states }[] = []
  for (const team of game.value.teams) team.boats.forEach((b, index) => {
    if (b.order === ground.id) boats.push({ key: `${team.id}-${index}`, team, index, state: b.location === ground.id ? 'fishing' : 'arriving' })
    else if (b.order === null && b.location === ground.id) boats.push({ key: `${team.id}-${index}`, team, index, state: 'idle' })
  })
  return { ...ground, boats, last: game.value.last?.grounds.find(g => g.id === ground.id) }
}))
function groundAction(id: string) {
  if (boat.value.order === id) return t('Boat {n} is ordered here', { n: selected.value + 1 })
  return t(boat.value.location === id ? 'Fish here with boat {n}' : 'Send boat {n} here', { n: selected.value + 1 })
}
const teamName = (id: string) => game.value.teams.find(team => team.id === id)?.name ?? t('Removed team')
const pursuers = (id: string) => game.value.teams.filter(team => team.contract === id)
function outcome(b: BoatRecord) {
  if (b.action === 'fish') return t('caught {fish} at {ground}', { fish: fish(b.caught), ground: b.to! })
  if (b.action === 'travel') return t('travelled to {ground}', { ground: b.to! })
  if (b.action === 'unpaid') return t('could not pay to fish at {ground}', { ground: b.to! })
  return t('stayed idle')
}
const rivalCatches = computed(() => (game.value.last?.teams ?? []).filter(r => r.caught).sort((a, b) => b.caught! - a.caught!))
async function send(path: 'order' | 'contract', input: object) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { acceptState(await api<TeamState>(`/team/game/${path}`, input)) }
  catch (e) { error.value = errorMessage(e); await refreshState() } finally { busy.value = false; confirmAbandon.value = false }
}
const order = (ground: string | null) => send('order', { boat: selected.value, ground })
const chooseContract = (contract: string | null) => send('contract', { contract, current: game.value.own.contract?.id ?? null })
</script>
<template>
  <main class="commons">
    <h1 class="sr-only">{{ t('Game') }}</h1>
    <div class="commons-status">
      <span>{{ t('Resolutions done: {n} of {total}', { n: game.resolution, total: game.totalResolutions }) }}</span>
      <span v-if="nextIn !== null" class="next-resolution" role="timer">{{ t('Next in {time}', { time: clock(nextIn) }) }}</span>
      <strong class="commons-score">{{ t('Score {score}', { score: game.own.fish + game.own.bonus }) }} <span>{{ t('{fish} fish + {bonus} bonus', { fish: game.own.fish, bonus: game.own.bonus }) }}</span></strong>
    </div>
    <p class="feedback error" role="status">{{ t(error) }}</p>
    <div class="commons-layout">
      <div class="commons-sea">
        <section class="boats" aria-labelledby="boats-heading">
          <h2 id="boats-heading">{{ t('Your boats') }}</h2>
          <div class="boat-picker">
            <button v-for="(b, index) in me.boats" :key="index" class="boat-option" :class="{ selected: selected === index }" :aria-pressed="selected === index" @click="selected = index">
              <span class="boat-tag" :style="{ background: me.color }">{{ tag(me, index) }}</span>
              <span><strong>{{ t('Boat {n}', { n: index + 1 }) }}</strong><span class="boat-status">{{ boatStatus(b) }}</span></span>
            </button>
          </div>
          <div class="boat-orders"><span class="hint">{{ t('Choose a ground for boat {n}, or', { n: selected + 1 }) }}</span><button class="secondary" :disabled="busy || boat.order === null" @click="order(null)">{{ t('Keep boat {n} idle', { n: selected + 1 }) }}</button></div>
          <p v-if="shortOfResearch" class="hint warning">{{ t('Not enough Research for every fishing boat. Boat 1 is paid first.') }}</p>
        </section>
        <section class="grounds" :aria-label="t('Fishing grounds')">
          <article v-for="g in grounds" :key="g.id" class="ground" :class="{ ordered: boat.order === g.id }" :aria-label="t('Ground {ground}', { ground: g.id })">
            <header><h3>{{ g.id }}</h3><span class="stock"><strong>{{ g.biomass }}</strong> / {{ g.max }}</span></header>
            <div class="stock-meter" role="img" :aria-label="t('Stock {stock} of {max}', { stock: g.biomass, max: g.max })"><span :style="{ width: `${g.biomass / g.max * 100}%` }" /></div>
            <p class="ground-facts">{{ t('Regrowth +{n}', { n: g.growth }) }}<template v-if="g.last"> · {{ t('last −{caught} +{growth}', { caught: g.last.caught, growth: g.last.growth }) }}</template></p>
            <ul class="ground-boats">
              <li v-for="b in g.boats" :key="b.key" class="boat-tag" :class="[b.state, { own: b.team.id === me.id }]" :style="b.state === 'arriving' ? { borderColor: b.team.color, color: b.team.color } : { background: b.team.color }" :title="`${b.team.name} · ${t('Boat {n}', { n: b.index + 1 })} · ${t(states[b.state])}`">{{ b.state === 'arriving' ? '→' : '' }}{{ tag(b.team, b.index) }}<span class="sr-only">: {{ b.team.name }}, {{ t('Boat {n}', { n: b.index + 1 }) }}, {{ t(states[b.state]) }}</span></li>
            </ul>
            <button class="secondary" :disabled="busy || boat.order === g.id" @click="order(g.id)">{{ groundAction(g.id) }}</button>
          </article>
        </section>
        <p class="hint tag-legend" aria-hidden="true"><span class="boat-tag" :style="{ background: me.color }">{{ tag(me, 0) }}</span> {{ t('fishing') }} <span class="boat-tag arriving" :style="{ borderColor: me.color, color: me.color }">→{{ tag(me, 0) }}</span> {{ t('arriving') }} <span class="boat-tag idle" :style="{ background: me.color }">{{ tag(me, 0) }}</span> {{ t('idle here') }}</p>
      </div>
      <aside class="commons-side">
        <section class="last-resolution" aria-labelledby="last-heading">
          <h2 id="last-heading">{{ game.last ? t('Resolution {n}', { n: game.last.number }) : t('No resolution yet') }}</h2>
          <template v-if="game.last && game.last.own">
            <ul class="plain-list">
              <li v-for="(b, index) in game.last.own.boats" :key="index">{{ t('Boat {n}', { n: index + 1 }) }}: {{ outcome(b) }}</li>
              <li>{{ t('Research paid: {n}', { n: game.last.own.paid }) }}</li>
              <li v-if="game.last.own.contract">{{ game.last.own.contract.completed ? t('Contract completed') : t('Contract progress {progress} / {target}', { progress: game.last.own.contract.progress, target: game.last.own.contract.target }) }}</li>
            </ul>
            <p v-if="frozen" class="hint">{{ t('Rival catches are hidden while standings are frozen.') }}</p>
            <p v-else-if="rivalCatches.length" class="hint">{{ t('Other teams caught:') }} {{ rivalCatches.map(r => `${teamName(r.id)} ${r.caught}`).join(' · ') }}</p>
          </template>
          <p v-else class="hint">{{ t('Orders are carried out every {minutes} minutes.', { minutes: game.rules.resolutionSeconds / 60 }) }}</p>
        </section>
        <section class="contracts" aria-labelledby="contracts-heading">
          <h2 id="contracts-heading">{{ t('Contracts') }}</h2>
          <p class="hint">{{ t('Optional, once each. One at a time; abandoning loses its progress.') }}</p>
          <ul class="contract-list">
            <li v-for="c in game.contracts" :key="c.id" :class="{ active: game.own.contract?.id === c.id }">
              <p>{{ contractText(c) }}</p>
              <div class="contract-meta">
                <span class="contract-bonus">+{{ c.bonus }}</span>
                <span class="pursuers" :title="pursuers(c.id).map(team => team.name).join(', ')"><span v-for="team in pursuers(c.id)" :key="team.id" class="color-dot" :style="{ background: team.color }" /><span class="sr-only">{{ pursuers(c.id).map(team => team.name).join(', ') }}</span></span>
                <span v-if="game.own.completed.includes(c.id)" class="success">{{ t('Completed') }}</span>
                <template v-else-if="game.own.contract?.id === c.id">
                  <span>{{ game.own.contract.progress }} / {{ game.own.contract.target }}</span>
                  <button v-if="!confirmAbandon" class="text-button" :disabled="busy" @click="confirmAbandon = true">{{ t('Abandon') }}</button>
                </template>
                <button v-else class="secondary" :disabled="busy || game.own.contract !== null" @click="chooseContract(c.id)">{{ t('Take') }}</button>
              </div>
              <div v-if="confirmAbandon && game.own.contract?.id === c.id" class="skip-confirm">{{ t('Abandon this contract? Its progress is lost.') }}<div><button class="secondary" :disabled="busy" @click="chooseContract(null)">{{ t('Yes, abandon') }}</button><button class="text-button" @click="confirmAbandon = false">{{ t('Keep it') }}</button></div></div>
            </li>
          </ul>
        </section>
        <section aria-labelledby="leaderboard-heading">
          <h2 id="leaderboard-heading">{{ t('Standings') }}</h2>
          <p v-if="frozen" class="hint">{{ t('Frozen for the final 5 minutes.') }}</p>
          <ScoreTable :teams="state.standings.teams" :current-team-id="me.id" :limit="5" />
        </section>
        <details class="scoring-note">
          <summary>{{ t('How it works') }}</summary>
          <p>{{ t('Every {minutes} minutes all orders are carried out at once. A boat ordered to the ground where it is catches up to {catch} fish and costs {cost} Research.', { minutes: game.rules.resolutionSeconds / 60, catch: game.rules.catchAmount, cost: game.rules.fishingCost }) }}</p>
          <p>{{ t('A boat sent to another ground spends the next resolution travelling and fishes from the one after. Idle and travelling boats cost nothing.') }}</p>
          <p>{{ t('If a ground cannot supply every boat, its fish are shared equally and the rest stay.') }}</p>
          <p>{{ t('Then every ground regrows: slowly when nearly empty, by up to {cap} in the middle, not at all when full.', { cap: game.rules.growthCap }) }}</p>
          <p>{{ t('Score is fish caught plus contract bonuses. Unused Research is worth nothing.') }}</p>
        </details>
      </aside>
    </div>
  </main>
</template>
