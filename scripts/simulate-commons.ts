// Balance checks for The Commons (see the plan's "Risks to test by
// simulation"). Uses the real rules and configuration:  npm run simulate
// Try a change without editing the config:  RULES='{"contractBonus":4}' npm run simulate
import { commonsRules } from '../server/game/commons-config.js'
import { DURATION_SECONDS } from '../server/competition.js'
import { BOATS_PER_TEAM, availableContracts, createGrounds, resolve, type CatchCondition, type CommonsMatch, type CommonsTeam, type ContractDefinition, type Ground } from '../shared/commons.js'

const rules = { ...commonsRules, ...JSON.parse(process.env.RULES || '{}') } as typeof commonsRules
const RESOLUTIONS = Math.floor(DURATION_SECONDS / rules.resolutionSeconds)
const MATCHES = Number(process.env.MATCHES || 300)
const RESEARCH_PER_ANSWER = 10
type Rng = () => number
function mulberry32(seed: number): Rng { return () => { seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
interface View { match: CommonsMatch; me: CommonsTeam; memory: Record<string, unknown>; resolution: number }
type Strategy = (view: View, rng: Rng) => void

// Boats that would fish ground g next, counting this boat.
const crowd = (v: View, g: Ground, boat: number) => 1 + v.match.teams.reduce((n, t) => n + t.boats.filter((b, i) => b.order === g.id && !(t.id === v.me.id && i === boat)).length, 0)
const share = (v: View, g: Ground, boat: number) => Math.min(rules.catchAmount, g.biomass / crowd(v, g, boat))
function best<T>(items: T[], score: (item: T) => number, rng: Rng): T {
  let top: T[] = [], value = -Infinity
  for (const item of items) { const s = score(item); if (s > value + 1e-9) { top = [item]; value = s } else if (Math.abs(s - value) <= 1e-9) top.push(item) }
  return top[Math.floor(rng() * top.length)]
}
const groundOf = (v: View, id: string | null) => v.match.grounds.find(g => g.id === id)
function forBoats(v: View, decide: (boat: number) => string | null) { for (let i = 0; i < BOATS_PER_TEAM; i++) v.me.boats[i].order = decide(i) }

// Stay while a full catch is available, otherwise chase the largest share.
function greedyChoice(v: View, i: number, rng: Rng, extra: (g: Ground) => number = () => 0) {
  const here = groundOf(v, v.me.boats[i].location)
  if (here && share(v, here, i) >= rules.catchAmount && extra(here) >= 0) return here.id
  return best(v.match.grounds, g => share(v, g, i) + extra(g) + (g.id === here?.id ? rules.catchAmount / 2 : 0), rng).id
}
const strategies: Record<string, Strategy> = {
  greedy: (v, rng) => forBoats(v, i => greedyChoice(v, i, rng)),
  // Least-crowded ground; leave only when clearly more crowded than elsewhere.
  spread: (v, rng) => forBoats(v, i => {
    const here = groundOf(v, v.me.boats[i].location), least = best(v.match.grounds, g => -crowd(v, g, i) * 100 + g.biomass, rng)
    return here && crowd(v, here, i) <= crowd(v, least, i) + 1 && here.biomass > 2 ? here.id : least.id
  }),
  // Choose once, then never travel again.
  anchored: (v, rng) => forBoats(v, i => v.me.boats[i].order ?? best(v.match.grounds, g => -crowd(v, g, i) * 100 + g.biomass, rng).id),
  // Copy the current leader's orders.
  follow: (v, rng) => {
    const leader = [...v.match.teams].filter(t => t.id !== v.me.id).sort((a, b) => b.fish + b.bonus - a.fish - a.bonus)[0]
    if (!leader || leader.fish + leader.bonus <= v.me.fish + v.me.bonus) return strategies.greedy(v, rng)
    forBoats(v, i => leader.boats[i].order ?? greedyChoice(v, i, rng))
  },
  // Rest a boat when its ground drops below the fast-growth band.
  steward: (v, rng) => forBoats(v, i => {
    const here = groundOf(v, v.me.boats[i].location)
    if (here && here.biomass < 4 && v.match.grounds.every(g => g.biomass < 6)) return null
    return here && here.biomass >= 4 && crowd(v, here, i) <= 2 ? here.id : best(v.match.grounds, g => share(v, g, i) - crowd(v, g, i), rng).id
  }),
  random: (v, rng) => forBoats(v, i => v.me.boats[i].location === null || rng() < .3 ? v.match.grounds[Math.floor(rng() * v.match.grounds.length)].id : v.me.boats[i].location),
  // Greedy, but takes contracts and steers towards qualifying grounds.
  contracts: (v, rng) => {
    const open = availableContracts(rules, v.match.grounds).filter(c => !v.me.completed.includes(c.id))
    // Abandon a contract that has made no progress for five resolutions.
    if (v.me.contract && v.me.contract.progress !== v.memory.progress) { v.memory.progress = v.me.contract.progress; v.memory.since = v.resolution }
    if (v.me.contract && v.resolution - (v.memory.since as number) > 5) v.me.contract = null
    if (!v.me.contract) {
      const choice = best(open, c => estimate(v, c) / c.target, rng)
      if (choice && estimate(v, choice) > 0) { v.me.contract = { id: choice.id, progress: 0, grounds: [] }; v.memory.since = v.resolution; v.memory.progress = 0 }
    }
    const active = v.me.contract && rules.contracts.find(c => c.id === v.me.contract!.id)
    forBoats(v, i => greedyChoice(v, i, rng, g => !active ? 0 : active.counter === 'variety'
      ? (v.me.contract!.grounds.includes(g.id) || v.me.boats.some((b, j) => j !== i && b.order === g.id) ? -1 : 1.5)
      : counts(v, active.condition, g) ? share(v, g, i) : -0.5))
  },
}
function counts(v: View, condition: CatchCondition | undefined, g: Ground) {
  if (!condition) return true
  if ('ground' in condition) return g.id === condition.ground
  if ('minBiomass' in condition) return g.biomass >= condition.minBiomass
  return g.lastFishedBy.every(id => id === v.me.id)
}
function estimate(v: View, c: ContractDefinition) {
  if (c.counter === 'variety') return 1
  return v.match.grounds.filter(g => counts(v, c.condition, g)).map(g => share(v, g, 0)).sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0)
}

interface Result { scores: number[]; bonus: number[]; completed: string[][]; wanted: number; paid: number; ranks: number[][] }
// answersPerResolution: average correct first-try answers a team adds per resolution.
function play(lineup: string[], seed: number, answersPerResolution: number): Result {
  const rng = mulberry32(seed)
  let match: CommonsMatch = { grounds: createGrounds(lineup.length, rules), teams: lineup.map((_, i) => ({ id: `t${i}`, research: rules.startingResearch, fish: 0, bonus: 0, boats: Array.from({ length: BOATS_PER_TEAM }, () => ({ location: null, order: null })), contract: null, completed: [] })) }
  const memory = lineup.map(() => ({} as Record<string, unknown>)), ranks: number[][] = []
  let wanted = 0, paid = 0
  for (let r = 1; r <= RESOLUTIONS; r++) {
    // Teams react in a random order and see orders already given.
    for (const i of [...lineup.keys()].sort(() => rng() - .5)) {
      const team = match.teams[i]
      for (let k = 0; k < 3; k++) if (rng() < answersPerResolution / 3) team.research += RESEARCH_PER_ANSWER
      const before = team.contract?.id
      strategies[lineup[i]]({ match, me: team, memory: memory[i], resolution: r }, rng)
      if (team.contract && team.contract.id !== before) team.contract = { id: team.contract.id, progress: 0, grounds: [] }
    }
    const result = resolve(match, rules)
    for (const t of result.record.teams) for (const b of t.boats) if (b.action === 'fish' || b.action === 'unpaid') { wanted++; if (b.action === 'fish') paid++ }
    match = result.match
    const scores = match.teams.map(t => t.fish + t.bonus)
    ranks.push(scores.map(s => scores.filter(o => o > s).length))
  }
  return { scores: match.teams.map(t => t.fish + t.bonus), bonus: match.teams.map(t => t.bonus), completed: match.teams.map(t => t.completed), wanted, paid, ranks }
}

const names = Object.keys(strategies)
const pct = (n: number) => `${Math.round(n * 100)}%`.padStart(5)
console.log(`The Commons: ${RESOLUTIONS} resolutions every ${rules.resolutionSeconds / 60} min, catch ${rules.catchAmount}, cost ${rules.fishingCost}, max ${rules.maxBiomass}, start ${rules.startingBiomass}, growth cap ${rules.growthCap}, bonus ${rules.contractBonus}`)
console.log(`Upper bound per team: ${(RESOLUTIONS - 1) * BOATS_PER_TEAM * rules.catchAmount} fish. ${MATCHES} matches per row.\n`)

console.log('1. Research: share of wanted fishing a team could pay for (mixed strategies, 8 teams)')
for (const answers of [0.1, 0.25, 0.5, 1, 2]) {
  let wanted = 0, paid = 0
  for (let m = 0; m < MATCHES; m++) { const r = play(Array.from({ length: 8 }, (_, i) => names[(i + m) % names.length]), m, answers); wanted += r.wanted; paid += r.paid }
  console.log(`   ${String(answers).padEnd(4)} correct answers per resolution (${String(Math.round(answers * RESOLUTIONS)).padStart(2)} per match): ${pct(paid / wanted)} paid`)
}

console.log('\n2. Fixed strategies: mean score relative to the match average (1.00 = average), random lineups')
console.log(`   ${'teams'.padEnd(6)}${names.map(n => n.padStart(10)).join('')}`)
for (const teams of [3, 8, 20]) {
  const total: Record<string, number> = {}, count: Record<string, number> = {}, wins: Record<string, number> = {}
  for (let m = 0; m < MATCHES; m++) {
    const rng = mulberry32(1000 + m), lineup = Array.from({ length: teams }, () => names[Math.floor(rng() * names.length)])
    const { scores } = play(lineup, 5000 + m, 1), mean = scores.reduce((a, b) => a + b, 0) / teams || 1
    const top = Math.max(...scores)
    lineup.forEach((name, i) => { total[name] = (total[name] || 0) + scores[i] / mean; count[name] = (count[name] || 0) + 1; if (scores[i] === top) wins[name] = (wins[name] || 0) + 1 })
  }
  console.log(`   ${String(teams).padEnd(6)}${names.map(n => (count[n] ? (total[n] / count[n]).toFixed(2) : '-').padStart(10)).join('')}`)
}

console.log('\n   Invasion: one team of each strategy among teams that all play another (score relative to the others)')
for (const teams of [3, 8, 20]) for (const host of ['greedy', 'spread', 'steward']) {
  const row = names.filter(n => n !== host).map(invader => {
    let ratio = 0
    for (let m = 0; m < Math.ceil(MATCHES / 3); m++) { const { scores } = play([invader, ...Array(teams - 1).fill(host)], 9000 + m, 1); ratio += scores[0] / (scores.slice(1).reduce((a, b) => a + b, 0) / (teams - 1) || 1) }
    return `${invader} ${(ratio / Math.ceil(MATCHES / 3)).toFixed(2)}`
  })
  console.log(`   ${String(teams).padEnd(3)} among ${host.padEnd(8)} ${row.join('  ')}`)
}

console.log('\n3. Contracts: half the teams greedy, half also taking contracts')
for (const teams of [3, 8, 20]) {
  const fish = { greedy: 0, contracts: 0 }, n = { greedy: 0, contracts: 0 }, done: Record<string, number> = {}
  let bonus = 0
  for (let m = 0; m < MATCHES; m++) {
    const lineup = Array.from({ length: teams }, (_, i) => (i + m) % 2 ? 'greedy' : 'contracts') as ('greedy' | 'contracts')[]
    const r = play(lineup, 3000 + m, 1)
    lineup.forEach((name, i) => { fish[name] += r.scores[i] - r.bonus[i]; n[name]++; if (name === 'contracts') { bonus += r.bonus[i]; for (const id of r.completed[i]) done[id] = (done[id] || 0) + 1 } })
  }
  console.log(`   ${String(teams).padEnd(3)} teams: fish ${(fish.greedy / n.greedy).toFixed(1)} greedy vs ${(fish.contracts / n.contracts).toFixed(1)} contract-takers, who add ${(bonus / n.contracts).toFixed(1)} bonus`)
  console.log(`       completed per contract-taker: ${Object.entries(done).sort().map(([id, k]) => `${id} ${(k / n.contracts).toFixed(2)}`).join(', ')}`)
}

console.log('\n4. Convergence: how late the leaderboard still changes (mixed strategies)')
for (const teams of [3, 8, 20]) {
  let lastChange = 0, leaderChanges = 0
  for (let m = 0; m < MATCHES; m++) {
    const rng = mulberry32(2000 + m), { ranks } = play(Array.from({ length: teams }, () => names[Math.floor(rng() * names.length)]), 7000 + m, 1)
    const final = ranks[ranks.length - 1]
    let settled = ranks.length
    while (settled > 1 && ranks[settled - 2].every((rank, i) => rank === final[i])) settled--
    lastChange += settled
    leaderChanges += ranks.slice(1).filter((r, i) => r.indexOf(0) !== ranks[i].indexOf(0)).length
  }
  console.log(`   ${String(teams).padEnd(3)} teams: final order first reached at resolution ${(lastChange / MATCHES).toFixed(1)} of ${RESOLUTIONS}; ${(leaderChanges / MATCHES).toFixed(1)} leader changes per match`)
}
