// Bot teams for the balance simulation. They decide only from what players see:
// the map, every ground, every boat and its order, and their own Research and hold.
import { distance, growth, type Boat, type CommonsConfig, type MatchState, type School } from './rules.js'
import type { BoatOrder } from '../../shared/domain.js'

// `planner` approximates a thoughtful team: it values each ground by the points it
// expects there, counting the sail, the boats already heading for it, the trips home
// to unload and what the Research burnt is worth to this team. The others are simple
// rules of thumb the planner must not lose to.
export const strategies = ['planner', 'biggest', 'loner', 'golden', 'stay'] as const
export type Strategy = typeof strategies[number]
// `income`: Research per minute. `every`: minutes between looks at the game, on average.
// `bait`: overrides the planner's own bait rule; rules of thumb never bait.
export interface Bot { strategy: Strategy; income: number; every: number; bait?: 'always' | 'never' }
export interface View { state: MatchState; me: Boat; config: CommonsConfig; horizon: number }
const STICKINESS = 1.1 // a move must promise 10% more than staying
const PRICE = 1.4 // each Research burnt costs (PRICE / income)² points: dear for weak teams, nearly free for strong ones
const BAIT_AT = 30 // planners bait while they hold at least this much Research

const ground = (o: BoatOrder | null) => o && 'school' in o ? o.school : null
const rivals = (v: View, s: School) => v.state.boats.filter(b => b !== v.me && ground(b.target) === s.id)
// Points expected at `s` over the horizon if the boat goes there now, minus the Research it burns.
export function value(v: View, s: School, income: number): number {
  const { config, me, horizon, state } = v, map = state.map
  const sail = distance(map, me, s), home = distance(map, s, map.harbour)
  if (sail < 0) return -Infinity
  const k = 1 + rivals(v, s).length, max = s.golden ? config.goldenMax : config.schoolMax, cap = s.golden ? config.goldenCap : config.growthCap
  // Where the stock settles: the fullest level at which regrowth keeps up with every boat's catch.
  let settle = max
  while (settle > 0 && k * settle / config.catchEffort > growth(settle, max, cap) / config.growthTicks) settle--
  const rate = (s.fish + settle) / 2 / config.catchEffort, perTick = config.hold / (config.hold / rate + 2 * home)
  const perFish = 2 * home * config.fuelCost / config.hold, fuel = me.research - sail + income * config.tickSeconds / 60 * horizon
  const fish = Math.max(0, Math.min(perTick * Math.max(0, horizon - sail), fuel / Math.max(0.01, perFish)))
  return fish * (s.golden ? config.goldenValue : 1) - (PRICE / Math.max(0.5, income)) ** 2 * (sail + fish * perFish)
}
export const wantsBait = (v: View, bot: Bot) => bot.bait === 'always' || (bot.bait !== 'never' && bot.strategy === 'planner' && v.me.research >= BAIT_AT)
const reachable = (v: View) => v.state.schools.filter(s => distance(v.state.map, v.me, s) <= v.me.research)
const nearest = (v: View) => reachable(v).sort((a, b) => distance(v.state.map, v.me, a) - distance(v.state.map, v.me, b))[0]

// Returns the boat's new order, or null to leave it as it is.
export function decide(v: View, bot: Bot): BoatOrder | null {
  const order = decideGround(v, bot)
  return order && { school: order.id }
}
function decideGround(v: View, bot: Bot): School | null {
  const { me, state } = v, schools = state.schools, here = schools.find(s => s.id === ground(me.target))
  // A team that sends its boat out once and never looks again.
  if (bot.strategy === 'stay') return me.target ? null : nearest(v) ?? null
  if (bot.strategy === 'biggest') {
    const best = reachable(v).filter(s => !s.golden).sort((a, b) => b.fish - a.fish || distance(state.map, me, a) - distance(state.map, me, b))[0]
    return best && best !== here ? best : null
  }
  // The fullest ground nobody else is heading for, worth moving to once it has 5 more fish than this one.
  if (bot.strategy === 'loner') {
    const worth = (s: School) => s.fish * (s.golden ? v.config.goldenValue : 1)
    const free = reachable(v).filter(s => !rivals(v, s).length).sort((a, b) => worth(b) - worth(a))[0]
    return free && free !== here && (!here || rivals(v, here).length || free.fish >= here.fish + 5) ? free : null
  }
  if (bot.strategy === 'golden') {
    const best = schools.filter(s => s.golden).sort((a, b) => b.fish - a.fish || distance(state.map, me, a) - distance(state.map, me, b))[0]
    return best && best !== here ? best : null
  }
  let best = here, score = here ? value(v, here, bot.income) * STICKINESS : -Infinity
  for (const s of schools) { const x = value(v, s, bot.income); if (x > score) { best = s; score = x } }
  return best && best !== here ? best : null
}
