// Balance check for The Commons: `npm run simulate`. Bots use only what players
// see (grounds, every boat and order, active contracts, the leaderboard) and the
// same pure rules and configuration as the server.
import { commonsConfig } from './config.js'
import { availableContracts, contractBonus, growth, groundIndex, newBoats, newGrounds, resolve, type CommonsConfig, type MatchState, type TeamPlay } from './rules.js'
import { DURATION_SECONDS } from '../competition.js'

type Strategy = 'greedy' | 'spread' | 'conserve' | 'follow' | 'stay'
interface Bot { strategy: Strategy; contracts: boolean; income: number; attention: number }
const strategies: Strategy[] = ['greedy', 'spread', 'conserve', 'follow', 'stay']
// Research per minute from questions: roughly 2, 5 and 9 first-try correct answers per 10 minutes.
const incomes = { weak: 2, average: 5, strong: 9 }

function rng(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

function decide(state: MatchState, me: TeamPlay, bot: Bot, config: CommonsConfig, scores: Map<string, number>, left: number, random: () => number) {
  const grounds = state.grounds, all = state.teams.flatMap(t => t.boats.map((b, i) => ({ team: t.id, i, ...b })))
  const others = (boat: number) => all.filter(b => !(b.team === me.id && b.i === boat))
  const heading = (g: number, boat: number) => others(boat).filter(b => b.order === g).length
  const fishingNext = (g: number, boat: number) => others(boat).filter(b => b.order === g && b.ground === g).length
  const contract = me.contract && config.contracts.find(c => c.id === me.contract!.id)
  function value(g: number, boat: number) {
    const here = me.boats[boat]!.ground === g, b = grounds[g]!.biomass
    let v: number
    if (here) v = Math.min(config.catchAmount, Math.floor(b / (fishingNext(g, boat) + 1)))
    else {
      const taken = Math.min(b, fishingNext(g, boat) * config.catchAmount), later = b - taken + growth(b - taken, grounds[g]!.maximum, config.growthCap)
      v = Math.min(config.catchAmount, Math.floor(later / (heading(g, boat) + 1))) * 0.5
    }
    if (bot.strategy === 'conserve' && b < 5) v = 0
    if (contract?.kind === 'catch' && (contract.ground === undefined || groundIndex(contract.ground) === g) && (contract.minBiomass === undefined || b >= contract.minBiomass) && (!contract.quiet || !grounds[g]!.fishedBy.some(id => id !== me.id))) v *= 1.6
    if (contract?.kind === 'variety' && !me.contract!.visited.includes(g)) v *= here ? 1 : 2.2
    return v + random() * 0.01
  }
  const best = (boat: number) => grounds.map((_, g) => g).reduce((a, g) => value(g, boat) > value(a, boat) ? g : a, 0)
  me.boats.forEach((boat, i) => {
    if (bot.strategy === 'stay') { if (boat.order === null) boat.order = grounds.map((_, g) => g).reduce((a, g) => heading(g, i) + random() * 0.5 < heading(a, i) ? g : a, 0); return }
    if (bot.strategy === 'spread') {
      const load = (g: number) => heading(g, i) - grounds[g]!.biomass / 100 + random() * 0.01
      const target = grounds.map((_, g) => g).reduce((a, g) => load(g) < load(a) ? g : a, 0)
      if (boat.order === null || heading(boat.order, i) > heading(target, i) + 1) boat.order = target
      return
    }
    if (bot.strategy === 'follow') {
      // Go where the current leader is actually fishing.
      const leader = state.teams.filter(t => t.id !== me.id).sort((a, b) => scores.get(b.id)! - scores.get(a.id)!)[0]
      const spot = leader && scores.get(leader.id)! > 0 ? leader.boats.find((b, j) => b.order !== null && b.order === b.ground && (j === i || !leader.boats[i]!.order))?.order : null
      if (spot !== null && spot !== undefined && left > 1) { boat.order = spot; return }
    }
    const target = best(i)
    if (bot.strategy === 'conserve' && value(target, i) < 0.5) { boat.order = null; return }
    // Moving costs a resolution, so only move for a clearly better ground.
    if (boat.ground !== null && boat.order === boat.ground && value(boat.ground, i) >= value(target, i) - 0.6) return
    if (left <= 1 && boat.ground !== null) { boat.order = boat.ground; return }
    boat.order = target
  })
  if (bot.contracts && !me.contract) {
    const options = availableContracts(config, grounds.length).filter(c => !me.completed.includes(c.id))
    const pace = (c: typeof options[number]) => {
      if (c.kind === 'variety') return c.target <= left ? contractBonus(c, config) / Math.max(1, c.target - 1) : 0
      const ok = (g: number) => (c.ground === undefined || groundIndex(c.ground) === g) && (c.minBiomass === undefined || grounds[g]!.biomass >= c.minBiomass) && (!c.quiet || !grounds[g]!.fishedBy.some(id => id !== me.id))
      const rate = me.boats.filter(b => b.order !== null && ok(b.order)).length * config.catchAmount
      return rate && c.target / rate <= left ? contractBonus(c, config) / (c.target / rate) : 0
    }
    const choice = options.reduce<typeof options[number] | null>((a, c) => pace(c) > (a ? pace(a) : 0) ? c : a, null)
    if (choice) me.contract = { id: choice.id, progress: 0, visited: [] }
  }
}

function play(bots: Bot[], config: CommonsConfig, seed: number) {
  const random = rng(seed), rounds = Math.floor(DURATION_SECONDS / config.resolutionSeconds), minutes = config.resolutionSeconds / 60
  let state: MatchState = { grounds: newGrounds(bots.length, config), teams: bots.map((_, i) => ({ id: String(i), research: config.startingResearch, boats: newBoats(), fish: 0, bonus: 0, contract: null, completed: [] })) }
  const fishingRounds = bots.map(() => ({ wanted: 0, paid: 0 })), ranks: string[][] = [], biomass: number[] = []
  for (let round = 1; round <= rounds; round++) {
    state.teams.forEach((team, i) => { team.research += bots[i]!.income * minutes * (0.5 + random()) })
    const scores = new Map(state.teams.map(t => [t.id, t.fish + t.bonus]))
    for (const i of state.teams.map((_, i) => i).sort(() => random() - 0.5)) {
      if (round === 1 || random() < bots[i]!.attention) decide(state, state.teams[i]!, bots[i]!, config, scores, rounds - round + 1, random)
    }
    const result = resolve(state, config)
    for (const boat of result.report.boats) if (boat.action === 'fish' || boat.action === 'unpaid') { fishingRounds[Number(boat.team)]!.wanted++; if (boat.action === 'fish') fishingRounds[Number(boat.team)]!.paid++ }
    state = result.state
    ranks.push([...state.teams].sort((a, b) => b.fish + b.bonus - (a.fish + a.bonus) || Number(a.id) - Number(b.id)).map(t => t.id))
    biomass.push(state.grounds.reduce((sum, g) => sum + g.biomass, 0) / state.grounds.length)
  }
  // Last resolution at which the leader or the top three changed.
  const lastChange = ranks.reduce((last, r, i) => i && (r.slice(0, 3).join() !== ranks[i - 1]!.slice(0, 3).join()) ? i + 1 : last, 0)
  return { teams: state.teams, fishingRounds, lastChange, biomass, rounds }
}

const pct = (n: number) => `${Math.round(n * 100)}%`
const pad = (s: string | number, n: number) => String(s).padStart(n)
function report(config: CommonsConfig, runs = 300) {
  const rounds = Math.floor(DURATION_SECONDS / config.resolutionSeconds)
  console.log(`The Commons: ${rounds} resolutions, fishing cost ${config.fishingCost}, catch ${config.catchAmount}, max ${config.maximumBiomass}, start ${config.startingBiomass}, growth cap ${config.growthCap}, bonus ${config.contractBonus}, ${runs} runs each\n`)
  for (const size of [3, 8, 20]) {
    const grounds = config.groundCount(size)
    console.log(`== ${size} teams, ${grounds} grounds (sustainable yield ${grounds * config.growthCap}/resolution vs ${size * 2 * config.catchAmount} demanded at full fishing)`)
    // 1. Mixed populations: every strategy, with and without contracts, at every income level.
    const totals = new Map<string, { score: number; fish: number; n: number; wins: number }>()
    const afford = new Map<string, { wanted: number; paid: number }>()
    const contractsDone = new Map<string, number>(), perContract = new Map<string, number>()
    let contractTeams = 0
    let lastChange = 0, homogeneous = ''
    for (let run = 0; run < runs; run++) {
      const random = rng(run * 7919 + size)
      const bots: Bot[] = Array.from({ length: size }, (_, i) => ({ strategy: strategies[Math.floor(random() * strategies.length)]!, contracts: random() < 0.5, income: Object.values(incomes)[i % 3]!, attention: 0.5 + random() * 0.4 }))
      const result = play(bots, config, run)
      lastChange += result.lastChange
      const best = Math.max(...result.teams.map(t => t.fish + t.bonus))
      result.teams.forEach((team, i) => {
        const bot = bots[i]!, key = `${bot.strategy}${bot.contracts ? '+contracts' : ''}`
        const entry = totals.get(key) ?? { score: 0, fish: 0, n: 0, wins: 0 }
        entry.score += team.fish + team.bonus; entry.fish += team.fish; entry.n++; if (team.fish + team.bonus === best) entry.wins++
        totals.set(key, entry)
        const level = Object.entries(incomes).find(([, v]) => v === bot.income)![0]
        const a = afford.get(level) ?? { wanted: 0, paid: 0 }
        a.wanted += result.fishingRounds[i]!.wanted; a.paid += result.fishingRounds[i]!.paid; afford.set(level, a)
        if (bot.contracts) contractsDone.set(key, (contractsDone.get(key) ?? 0) + team.completed.length)
        if (bot.contracts) for (const id of team.completed) perContract.set(id, (perContract.get(id) ?? 0) + 1)
        if (bot.contracts) contractTeams++
      })
    }
    console.log('  Strategy (mixed fields)      mean score   win share   contracts/team')
    for (const [key, v] of [...totals].sort((a, b) => b[1].score / b[1].n - a[1].score / a[1].n)) {
      console.log(`  ${key.padEnd(28)} ${pad((v.score / v.n).toFixed(1), 10)} ${pad(pct(v.wins / v.n), 11)} ${pad(contractsDone.has(key) ? (contractsDone.get(key)! / v.n).toFixed(2) : '-', 16)}`)
    }
    console.log('  Contracts (with minus without, same strategy): ' + strategies.map(st => {
      const a = totals.get(`${st}+contracts`), b = totals.get(st)
      if (!a || !b) return ''
      const sign = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`
      return `${st} ${sign(a.score / a.n - b.score / b.n)} (bonus ${((a.score - a.fish) / a.n).toFixed(1)}, fish ${sign(a.fish / a.n - b.fish / b.n)})`
    }).join(', '))
    console.log('  Completion rate per contract-taking team: ' + availableContracts(config, grounds).map(c => `${c.id} ${pct((perContract.get(c.id) ?? 0) / Math.max(1, contractTeams))}`).join(', '))
    console.log('  Research: share of attempted fishing a team could pay for')
    for (const [level, a] of afford) console.log(`    ${level.padEnd(8)} (${(incomes as Record<string, number>)[level]} Research/min) ${pct(a.paid / Math.max(1, a.wanted))}`)
    console.log(`  Leaderboard: top three last changed at resolution ${(lastChange / runs).toFixed(1)} of ${rounds} on average`)
    // 2. Homogeneous fields show whether any single strategy exhausts the grounds.
    for (const strategy of strategies) {
      const bots: Bot[] = Array.from({ length: size }, (_, i) => ({ strategy, contracts: false, income: incomes.average, attention: 0.7 + (i % 3) * 0.1 }))
      const result = play(bots, config, 11)
      homogeneous += `    all ${strategy.padEnd(9)} mean catch ${pad((result.teams.reduce((s, t) => s + t.fish, 0) / size).toFixed(1), 5)}, mean biomass at end ${result.biomass.at(-1)!.toFixed(1)}\n`
    }
    console.log('  Homogeneous fields:\n' + homogeneous)
  }
}

report(commonsConfig, Number(process.argv[2]) || 300)
