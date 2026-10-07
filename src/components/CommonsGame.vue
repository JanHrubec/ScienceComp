<script setup lang="ts">
import { t, fish, tiles } from '../i18n'
import { computed, onUnmounted, ref, watch } from 'vue'
import { teamState, acceptState, refreshState, session } from '../state'
import { api, errorMessage } from '../api'
import type { BoatOrder, GameState, TeamState } from '../../shared/domain'
import TeamScores from './TeamScores.vue'
type School = GameState['schools'][number]
const error = ref(''), busy = ref(false)
const game = computed(() => teamState.value!.game)
const map = computed(() => game.value.map!)
const myId = computed(() => teamState.value!.team.id)
const me = computed(() => game.value.boats.find(b => b.team === myId.value))
const research = computed(() => teamState.value!.team.research)
const sentTo = (order: BoatOrder | null) => order && 'school' in order ? order.school : null
const goal = computed(() => game.value.schools.find(s => s.id === sentTo(me.value?.target ?? null)))
const here = computed(() => me.value && game.value.schools.find(s => s.x === me.value!.x && s.y === me.value!.y))
const land = computed(() => map.value.land.flatMap((row, y) => [...row].flatMap((c, x) => c === '#' ? [{ x, y }] : [])))
const seconds = (ticks: number) => Math.max(0, Math.round(ticks * game.value.rules.tickSeconds))
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const leftOf = (s: School) => s.until === null ? null : seconds(s.until - game.value.clock.tick)
const chasers = (s: School) => game.value.boats.filter(b => sentTo(b.target) === s.id)
// Nearest first; golden schools lead, as they leave.
const radar = computed(() => [...game.value.schools].sort((a, b) => Number(b.golden) - Number(a.golden) || a.sail - b.sail))
const stuck = computed(() => !!me.value?.route.length && research.value < game.value.rules.fuelCost)
const status = computed(() => {
  const boat = me.value
  if (!boat) return ''
  if (stuck.value) return t('Out of Research! Answer questions to refuel.')
  if (boat.route.length) return goal.value ? t('Sailing to a school: {tiles} to go', { tiles: tiles(boat.route.length) }) : t('Sailing: {tiles} to go', { tiles: tiles(boat.route.length) })
  if (here.value) return t('Fishing! Next catch in {seconds} s', { seconds: seconds(game.value.rules.catchTicks - boat.hauling) })
  return t('Idle. Tap a school on the map to send your boat.')
})
const label = (s: School) => s.golden
  ? t('Golden school: {fish}, swims off in {time}', { fish: fish(s.fish), time: clock(leftOf(s) ?? 0) })
  : t('School: {fish}', { fish: fish(s.fish) })

// "+1" bubbles over your boat when a catch comes in.
const pops = ref<{ id: number; x: number; y: number; text: string; golden: boolean }[]>([])
let popId = 0
watch(() => [game.value.own.fish, game.value.own.bonus] as const, ([f, b], [pf, pb]) => {
  const boat = me.value
  if (!boat || f + b <= pf + pb) return
  const id = ++popId, golden = b > pb
  pops.value.push({ id, x: boat.x, y: boat.y, text: `+${f + b - pf - pb}`, golden })
  setTimeout(() => { pops.value = pops.value.filter(p => p.id !== id) }, 1400)
})
// Golden-school news since this screen opened.
const news = ref(''), seen = ref<number | null>(null)
let newsTimer: ReturnType<typeof setTimeout> | undefined
watch(() => game.value.golden[0], latest => {
  const last = seen.value
  seen.value = latest?.tick ?? 0
  if (!latest || last === null || latest.tick <= last) return
  news.value = latest.kind === 'appeared' ? t('A golden school has appeared!') : latest.kind === 'gone' ? t('A golden school swam off.')
    : latest.team === myId.value ? t('You caught a golden fish! +{points}', { points: game.value.rules.goldenValue }) : t('{team} caught a golden fish!', { team: latest.name ?? '' })
  clearTimeout(newsTimer); newsTimer = setTimeout(() => { news.value = '' }, 5000)
}, { immediate: true })
onUnmounted(() => clearTimeout(newsTimer))

// One request at a time; an order given meanwhile waits, and only the latest is sent.
let waiting: BoatOrder | null = null
const sending = ref<BoatOrder | null>(null)
// A response or failure that arrives once the session has changed belongs to the old session and is dropped.
async function request(order: BoatOrder) {
  const from = session.value
  try { const value = await api<TeamState>('/team/game/order', order); if (from === session.value) acceptState(value) }
  catch (e) { if (from === session.value) { error.value = errorMessage(e); await refreshState() } }
}
async function send(order: BoatOrder) {
  error.value = ''; sending.value = order
  if (busy.value) { waiting = order; return }
  busy.value = true
  try {
    for (let next: BoatOrder | null = order; next; next = waiting) { waiting = null; sending.value = next; await request(next) }
  } finally { busy.value = false; sending.value = null }
}
// Waiting orders belong to the session that gave them.
watch(session, () => { waiting = null }, { flush: 'sync' })
// A tap near a school sends the boat after it; elsewhere on open sea, to that tile.
function tap(event: MouseEvent) {
  const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect()
  const fx = (event.clientX - box.left) / box.width * map.value.width, fy = (event.clientY - box.top) / box.height * map.value.height
  const near = game.value.schools.map(s => ({ s, d: Math.hypot(s.x + 0.5 - fx, s.y + 0.5 - fy) })).sort((a, b) => a.d - b.d)[0]
  if (near && near.d < 0.8) return send({ school: near.s.id })
  const x = Math.floor(fx), y = Math.floor(fy)
  if (map.value.land[y]?.[x] === '.') return send({ x, y })
}
const flag = computed(() => {
  const order = sending.value
  if (!order) return null
  if (!('school' in order)) return order
  return game.value.schools.find(s => s.id === order.school) ?? null
})
const at = (p: { x: number; y: number }, dx = 0) => ({ transform: `translate(${p.x + 0.5 + dx}px, ${p.y + 0.5}px)` })
// Boats on the same tile sit side by side, so a crowd shows.
const shift = computed(() => {
  const seen = new Map<string, string[]>()
  for (const b of game.value.boats) { const key = `${b.x},${b.y}`; seen.set(key, [...seen.get(key) ?? [], b.team]) }
  return new Map(game.value.boats.map(b => { const all = seen.get(`${b.x},${b.y}`)!; return [b.team, (all.indexOf(b.team) - (all.length - 1) / 2) * 0.3] }))
})
const fishPath = 'M-0.26 0 C-0.12 -0.2 0.12 -0.2 0.22 0 C0.12 0.2 -0.12 0.2 -0.26 0 Z M0.2 0 L0.36 -0.14 L0.36 0.14 Z'
</script>
<template>
  <main class="commons">
    <h1 class="sr-only">{{ t('Game') }}</h1>
    <div class="hud">
      <div class="hud-card hud-score"><span class="hud-label">{{ t('Score') }}</span><strong aria-live="polite">{{ game.own.fish + game.own.bonus }}</strong><span class="hud-sub">{{ t('{fish} + {bonus} golden', { fish: fish(game.own.fish), bonus: game.own.bonus }) }}</span></div>
      <div class="hud-card hud-fuel" :class="{ empty: research < game.rules.fuelCost }"><span class="hud-label">{{ t('Fuel') }}</span><strong>{{ Math.floor(research) }}</strong><span class="hud-sub">{{ t('Research; {cost} per tile', { cost: game.rules.fuelCost }) }}</span></div>
      <div class="hud-card hud-status" :class="{ alert: stuck }" role="status">
        <span>{{ status }}<template v-if="sending">{{ ' ' }}<span class="sending">· {{ t('Sending…') }}</span></template></span>
        <RouterLink v-if="stuck" to="/play/questions" class="refuel">{{ t('Go to questions') }}</RouterLink>
      </div>
    </div>
    <p class="feedback error" role="status">{{ t(error) }}</p>
    <div class="commons-layout">
      <div class="sea-frame">
        <p class="news" :class="{ shown: news }" aria-live="polite">{{ news }}</p>
        <svg v-if="game.map" class="sea" :viewBox="`0 0 ${map.width} ${map.height}`" :style="{ aspectRatio: `${map.width} / ${map.height}` }" :aria-label="t('Map. Use the list of schools to send your boat.')" @click="tap">
          <defs>
            <pattern id="waves" width="2" height="1.2" patternUnits="userSpaceOnUse"><path d="M0.1 0.6 q0.25 -0.18 0.5 0 t0.5 0" class="wave" /></pattern>
            <radialGradient id="gold"><stop offset="0" stop-color="#fff6b0" /><stop offset="1" stop-color="#f2b705" /></radialGradient>
          </defs>
          <rect class="water" :width="map.width" :height="map.height" />
          <rect class="water-waves" :width="map.width" :height="map.height" fill="url(#waves)" />
          <rect v-for="c in land" :key="`s${c.x}-${c.y}`" class="sand" :x="c.x - 0.16" :y="c.y - 0.16" width="1.32" height="1.32" rx="0.5" />
          <rect v-for="c in land" :key="`g${c.x}-${c.y}`" class="grass" :x="c.x - 0.02" :y="c.y - 0.02" width="1.04" height="1.04" rx="0.38" />
          <g class="harbour" :style="at(map.harbour)"><rect x="-0.42" y="-0.42" width="0.84" height="0.84" rx="0.18" /><path d="M-0.3 -0.15 H0.3 M-0.3 0.05 H0.3 M-0.3 0.25 H0.3" /></g>
          <polyline v-for="b in game.boats.filter(b => b.route.length)" :key="`r${b.team}`" class="route" :class="{ own: b.team === myId }" :stroke="b.color" :points="[b, ...b.route].map(p => `${p.x + 0.5},${p.y + 0.5}`).join(' ')" />
          <g v-if="flag" class="flag" :style="at(flag)"><circle r="0.45" /></g>
          <g v-for="s in game.schools" :key="`f${s.id}`" class="school" :class="{ golden: s.golden, target: s.id === goal?.id }" :style="at(s)">
            <g class="icon">
              <circle class="school-ring" r="0.46" />
              <path class="school-fish" :d="fishPath" transform="translate(-0.04 -0.08)" />
              <path class="school-fish small" :d="fishPath" transform="translate(0.14 0.18) scale(0.6)" />
            </g>
          </g>
          <g v-for="b in game.boats" :key="`b${b.team}`" class="boat" :class="{ own: b.team === myId }" :style="at(b, shift.get(b.team))">
            <g class="icon">
              <circle v-if="b.team === myId" class="boat-halo" r="0.5" />
              <circle v-if="b.team === myId && b.hauling" class="haul" r="0.42" pathLength="1" :stroke-dasharray="`${b.hauling / game.rules.catchTicks} 1`" />
              <path class="hull" d="M-0.34 0.06 H0.34 L0.24 0.26 H-0.24 Z" />
              <path class="mast" d="M0 0.06 V-0.36" />
              <path class="sail" :fill="b.color" d="M0.03 -0.34 L0.3 0.0 H0.03 Z M-0.03 -0.24 L-0.24 0.0 H-0.03 Z" />
            </g>
            <title>{{ b.name }}</title>
          </g>
          <!-- Counts go above the boats, which often sit on them. -->
          <g v-for="s in game.schools" :key="`n${s.id}`" class="school" :style="at(s)"><text class="school-count icon" x="0.3" y="0.44">{{ s.fish }}</text></g>
          <text v-for="p in pops" :key="`p${p.id}`" class="pop" :class="{ golden: p.golden }" :x="p.x + 0.5" :y="p.y">{{ p.text }}</text>
        </svg>
      </div>
      <aside class="commons-side">
        <section class="radar" :aria-label="t('Schools')">
          <h2>{{ t('Schools') }}</h2>
          <ul>
            <li v-for="s in radar" :key="s.id">
              <button class="radar-item" :class="{ golden: s.golden, target: s.id === goal?.id }" :aria-pressed="s.id === goal?.id" @click="send({ school: s.id })">
                <span class="radar-name">{{ label(s) }}</span>
                <span class="radar-meta">{{ tiles(s.sail) }}<span v-for="b in chasers(s)" :key="b.team" class="radar-dot" :style="{ background: b.color }" :title="b.name" /></span>
              </button>
            </li>
          </ul>
        </section>
        <section class="leaderboard">
          <h2>{{ t('Leaderboard') }}</h2>
          <p v-if="teamState!.standings.frozenAt !== null" class="hint">{{ t('Frozen for the final 5 minutes.') }}</p>
          <TeamScores :teams="teamState!.standings.teams" :current-team-id="myId" label="Leaderboard" />
        </section>
        <details class="how-it-works">
          <summary>{{ t('How to play') }}</summary>
          <p>{{ t('Tap a school of fish to send your boat. It sails one tile every {seconds} s by the shortest route and follows the school as it swims. Everyone sees every boat.', { seconds: game.rules.tickSeconds }) }}</p>
          <p>{{ t('Every tile sailed burns {cost} Research. Out of Research, your boat waits: answer questions to refuel.', { cost: game.rules.fuelCost }) }}</p>
          <p>{{ t('On a school, your boat catches a fish every {seconds} s by itself. Schools regrow slowly, but boats sharing one empty it fast. An emptied school vanishes and a new one appears elsewhere.', { seconds: game.rules.catchTicks * game.rules.tickSeconds }) }}</p>
          <p>{{ t('Golden schools appear every few minutes and swim off after a while. Each golden fish is worth {points} points.', { points: game.rules.goldenValue }) }}</p>
          <p>{{ t('Score: fish caught plus golden points. Unused Research is worth nothing.') }}</p>
        </details>
      </aside>
    </div>
  </main>
</template>
