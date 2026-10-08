// Bot teams for the balance simulation. They decide only from what players see:
// the map, every school, every boat and its destination, and their own Research.
import { destination, distance, type Boat, type CommonsConfig, type MatchState, type Order, type School } from './rules.js'

// `planner` approximates a thoughtful team: it values each school by the fish it
// expects to catch before it looks in again, counting the sail there and the boats
// already on or heading for it, and chases golden schools it can reach in time.
// The others are simple rules of thumb the planner must not lose to.
export const strategies = ['planner', 'nearest', 'biggest', 'golden', 'stay'] as const
export type Strategy = typeof strategies[number]
// `income`: Research per minute. `every`: minutes between looks at the game, on average.
export interface Bot { strategy: Strategy; income: number; every: number }
export interface View { state: MatchState; me: Boat; config: CommonsConfig; horizon: number }
// Fish a move must gain over staying before the planner gives up a school it is on.
const STICKINESS = 1

const rivals = (v: View, s: School) => v.state.boats.filter(b => { const to = b !== v.me && destination(v.state, b); return to && to.x === s.x && to.y === s.y })
// Expected catch at `s` over the horizon if the boat sails there now.
export function value(v: View, s: School): number {
  const { config, me, horizon } = v, sail = distance(v.state.map, me, s)
  if (sail < 0 || sail > me.research) return -Infinity
  const others = rivals(v, s), there = others.filter(b => b.x === s.x && b.y === s.y).length
  const growth = s.golden ? 0 : config.growthCap / config.growthTicks
  // Fish left when the boat arrives, then shared among everyone there by then.
  const left = s.fish - Math.max(0, there / config.catchTicks - growth) * sail
  const sharing = 1 + others.filter(b => distance(v.state.map, b, s) <= sail).length
  const until = Math.min(horizon, s.until === null ? Infinity : s.until - v.state.tick) - sail - (sail ? config.catchTicks : config.catchTicks - me.hauling)
  if (until < 0 || left <= 0) return 0
  const drain = Math.max(1e-6, sharing / config.catchTicks - growth)
  const mine = Math.min(until, left / drain) / config.catchTicks
  return (s.golden ? config.goldenValue : 1) * Math.min(mine, left) - 0.02 * sail
}
const nearest = (v: View, schools: School[]) => schools.filter(s => distance(v.state.map, v.me, s) <= v.me.research)
  .sort((a, b) => distance(v.state.map, v.me, a) - distance(v.state.map, v.me, b))[0]

// Returns the boat's new order, or null to leave it as it is.
export function decide(v: View, bot: Bot): Order | null {
  const order = decideSchool(v, bot)
  return order && { school: order.id }
}
function decideSchool(v: View, bot: Bot): School | null {
  const { me, state } = v, schools = state.schools, goal = destination(state, me)
  const here = schools.find(s => s.x === goal?.x && s.y === goal.y) ?? schools.find(s => s.x === me.x && s.y === me.y)
  // A team that sends its boat out once and never looks again.
  if (bot.strategy === 'stay') return state.tick ? null : nearest(v, schools) ?? null
  if (bot.strategy === 'nearest') return here ? null : nearest(v, schools) ?? null
  if (bot.strategy === 'biggest') {
    const best = [...schools].filter(s => !s.golden && distance(state.map, me, s) <= me.research).sort((a, b) => b.fish - a.fish || distance(state.map, me, a) - distance(state.map, me, b))[0]
    return best && best !== here ? best : null
  }
  let best = here, score = here ? value(v, here) + STICKINESS : -Infinity
  // The golden rule of thumb only weighs golden schools, while there are any worth going for.
  const options = bot.strategy === 'golden' && schools.some(s => s.golden && value(v, s) > 0) ? schools.filter(s => s.golden) : schools
  if (options !== schools && !here?.golden) score = -Infinity
  for (const s of options) { const x = value(v, s); if (x > score) { best = s; score = x } }
  return best && best !== here ? best : null
}
