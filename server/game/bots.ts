// Bot teams for the balance simulation. They decide only from what players see:
// grounds, every boat and order, previous-resolution activity and the leaderboard.
import type { ContractDefinition } from '../../shared/domain.js'
import { availableContracts, catchEach, contractBonus, fishedByRivals, growth, qualifies, type CommonsConfig, type MatchState, type TeamPlay } from './rules.js'

// `planner` approximates a thoughtful team: it forecasts each ground a few
// resolutions ahead, counting travel time and every visible order. The others
// are the fixed strategies the plan asks to rule out as dominant.
export const strategies = ['planner', 'greedy', 'spread', 'follow', 'stay'] as const
export type Strategy = typeof strategies[number]
// none: ignores contracts. opportunistic: takes a contract its current orders
// already serve. rational: also steers boats by a contract's face value.
// zealot: steers at three times face value and never abandons.
export const contractModes = ['none', 'opportunistic', 'rational', 'zealot'] as const
export type ContractMode = typeof contractModes[number]
export interface Bot { strategy: Strategy; contracts: ContractMode; income: number; attention: number }
export interface View { state: MatchState; me: TeamPlay; config: CommonsConfig; scores: Map<string, number>; left: number; random: () => number }
const weights: Record<ContractMode, number> = { none: 0, opportunistic: 0, rational: 1, zealot: 3 }
// Planner lookahead in resolutions, and how much better (in fish) a new order
// must look before it replaces the current one. Longer or stickier both did worse.
const HORIZON = 4, STICKINESS = 0.25

const active = (v: View) => v.me.contract && v.config.contracts.find(c => c.id === v.me.contract!.id) || null

// Boats other than `boat` itself ordered to `g`: already there (fish next) or travelling (fish after).
function census(v: View, boat: number, g: number) {
  const c = { fishing: 0, arriving: 0, rivalsFishing: 0, rivalsArriving: 0 }
  for (const t of v.state.teams) t.boats.forEach((b, i) => {
    if ((t.id === v.me.id && i === boat) || b.order !== g) return
    const rival = t.id !== v.me.id
    if (b.ground === g) { c.fishing++; if (rival) c.rivalsFishing++ } else { c.arriving++; if (rival) c.rivalsArriving++ }
  })
  return c
}

// Expected value of sending `boat` to `g` over the next few resolutions, assuming
// everyone else keeps their current orders. Contract progress counts at `weight`
// times its face value (bonus / target per qualifying fish or new ground).
function forecast(v: View, boat: number, g: number, idleFirst: boolean, weight: number) {
  const { config, me } = v, ground = v.state.grounds[g]!, own = me.boats[boat]!, crowd = census(v, boat, g), contract = weight ? active(v) : null
  let biomass = ground.biomass, value = 0, surveyed = false
  for (let k = 0; k < Math.min(HORIZON, v.left); k++) {
    const mine = k === 0 && (own.ground !== g || idleFirst) ? 0 : 1
    const boats = crowd.fishing + (k ? crowd.arriving : 0) + mine, each = boats ? catchEach(biomass, boats, config) : 0
    if (mine) {
      value += each
      if (contract) {
        const rivalsBefore = k === 0 ? fishedByRivals(ground, me.id) : crowd.rivalsFishing + (k > 1 ? crowd.rivalsArriving : 0) > 0
        const rate = weight * contractBonus(contract, config) / contract.target
        if (contract.kind === 'variety' && !surveyed && !me.contract!.visited.includes(g)) { value += rate; surveyed = true }
        if (qualifies(contract, g, biomass, rivalsBefore)) value += rate * each
      }
    }
    biomass -= each * boats
    biomass += growth(biomass, ground.maximum, config.growthCap)
  }
  return value
}

function plan(v: View, boat: number, weight: number): number | null {
  const own = v.me.boats[boat]!
  const options: { order: number | null; value: number }[] = v.state.grounds.map((_, g) => ({ order: g, value: forecast(v, boat, g, false, weight) + v.random() * 0.01 }))
  if (own.ground !== null) options.push({ order: null, value: forecast(v, boat, own.ground, true, weight) })
  const best = options.reduce((a, o) => o.value > a.value ? o : a)
  const current = options.find(o => o.order === own.order)
  return current && current.value >= best.value - STICKINESS ? own.order : best.order
}

const ordered = (v: View, boat: number, g: number) => { const c = census(v, boat, g); return c.fishing + c.arriving }
// Scores each ground once, so its noise breaks ties evenly (rescoring inside a
// comparison redraws the noise and favours later grounds), then picks the best.
function rank(v: View, score: (g: number) => number) {
  const scores = v.state.grounds.map((_, g) => score(g))
  return { scores, best: scores.indexOf(Math.max(...scores)) }
}

function fixed(v: View, strategy: Exclude<Strategy, 'planner'>, boat: number): number | null {
  const own = v.me.boats[boat]!
  if (strategy === 'stay') return own.order ?? rank(v, g => -ordered(v, boat, g) + v.random() * 0.5).best
  if (strategy === 'spread') {
    const target = rank(v, g => -ordered(v, boat, g) + v.state.grounds[g]!.biomass / 100 + v.random() * 0.01).best
    return own.order !== null && ordered(v, boat, own.order) <= ordered(v, boat, target) + 1 ? own.order : target
  }
  if (strategy === 'follow') {
    // Fish where the current leader is fishing. Of rivals tied for the lead, keep to one this
    // boat already follows, else pick one at random: the first would pile every follower onto the
    // lowest index, and a fresh pick at every look would keep paying for travel.
    const spot = (t: TeamPlay) => { const spots = t.boats.filter(b => b.order !== null && b.order === b.ground).map(b => b.order!); return spots[Math.min(boat, spots.length - 1)] }
    const rivals = v.state.teams.filter(t => t.id !== v.me.id), top = Math.max(0, ...rivals.map(t => v.scores.get(t.id)!))
    const leaders = top > 0 ? rivals.filter(t => v.scores.get(t.id) === top) : []
    const leader = leaders.find(t => own.order !== null && spot(t) === own.order) ?? (leaders.length > 1 ? leaders[Math.floor(v.random() * leaders.length)] : leaders[0])
    const target = leader && spot(leader)
    if (target !== undefined) return target
  }
  // Greedy: the most fish per boat right now, ignoring travel time and regrowth.
  const { scores, best } = rank(v, g => v.state.grounds[g]!.biomass / (ordered(v, boat, g) + 1) + v.random() * 0.01)
  return own.order !== null && scores[own.order]! >= scores[best]! - 1 ? own.order : best
}

// Qualifying fish (or new grounds) per resolution: from current orders, or the
// best achievable if the team steers both boats towards the contract. Rival teams
// pursuing the same contract are expected to crowd the same grounds.
function contractRate(v: View, c: ContractDefinition, steer: boolean) {
  const { state, me, config } = v
  if (c.kind === 'variety') {
    // Each new ground costs a resolution of travel: about one per resolution when steering.
    const fresh = new Set(me.boats.filter(b => b.order !== null && !me.contract?.visited.includes(b.order)).map(b => b.order)).size
    return steer ? 1 : fresh ? 0.25 : 0
  }
  const rivals = state.teams.filter(t => t.id !== me.id && t.contract?.id === c.id).length
  const value = (g: number, boat: number, extra: number) => qualifies(c, g, state.grounds[g]!.biomass, fishedByRivals(state.grounds[g]!, me.id)) ? catchEach(state.grounds[g]!.biomass, census(v, boat, g).fishing + 1 + extra, config) : 0
  if (!steer) return me.boats.reduce((sum, b, i) => sum + (b.order !== null && b.order === b.ground ? value(b.order, i, 0) : 0), 0)
  const crowding = c.ground !== undefined ? 2 * rivals : 0
  return me.boats.reduce((sum, _, i) => sum + Math.max(...state.grounds.map((__, g) => value(g, i, crowding))), 0) * 0.75
}

function chooseContract(v: View, mode: ContractMode) {
  if (mode === 'none') return
  const steer = mode !== 'opportunistic', definition = active(v)
  if (v.me.contract && definition && mode !== 'zealot') {
    const rate = contractRate(v, definition, steer)
    if (!rate || (definition.target - v.me.contract.progress) / rate > v.left + 1) v.me.contract = null
  }
  if (v.me.contract) return
  let best: { id: string; pace: number } | null = null
  for (const c of availableContracts(v.config, v.state.grounds.length)) {
    if (v.me.completed.includes(c.id)) continue
    const rate = contractRate(v, c, steer), time = rate ? c.target / rate + (steer ? 1 : 0) : Infinity
    const pace = time <= v.left - 1 ? contractBonus(c, v.config) / time : 0
    if (pace > (best?.pace ?? 0)) best = { id: c.id, pace }
  }
  if (best) v.me.contract = { id: best.id, progress: 0, visited: [] }
}

export function decide(v: View, bot: Bot) {
  if (bot.contracts !== 'opportunistic') chooseContract(v, bot.contracts)
  v.me.boats.forEach((boat, i) => {
    boat.order = bot.strategy === 'planner' ? plan(v, i, weights[bot.contracts]) : fixed(v, bot.strategy, i)
  })
  if (bot.contracts === 'opportunistic') chooseContract(v, bot.contracts)
}
