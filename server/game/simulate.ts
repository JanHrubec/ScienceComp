// Balance check for The Commons: `npm run simulate -- [runs] [key=value…]`, for
// example `npm run simulate -- 200 contractBonus=6 growthCap=2` to try numeric
// overrides of config.ts. Bots use the same pure rules as the server.
import { pathToFileURL } from 'node:url'
import { commonsConfig } from './config.js'
import { availableContracts, newBoats, newGrounds, resolve, type CommonsConfig, type MatchState } from './rules.js'
import { contractModes, decide, strategies, type Bot, type ContractMode, type Strategy } from './bots.js'
import { DURATION_SECONDS } from '../competition.js'

// Research per minute from questions: about 2, 5 and 9 first-try correct answers per 10 minutes.
export const incomes = { weak: 2, average: 5, strong: 9 }
export const sizes = [3, 6, 8, 12, 20]
const fixedStrategies = strategies.filter(s => s !== 'planner')

export function rng(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

export function play(bots: Bot[], config: CommonsConfig, seed: number) {
  const random = rng(seed), rounds = Math.floor(DURATION_SECONDS / config.resolutionSeconds), minutes = config.resolutionSeconds / 60
  let state: MatchState = { grounds: newGrounds(bots.length, config), teams: bots.map((_, i) => ({ id: String(i), research: config.startingResearch, boats: newBoats(), fish: 0, bonus: 0, contract: null, completed: [] })) }
  const paid = bots.map(() => 0), wanted = bots.map(() => 0), taken: string[][] = bots.map(() => []), leaders: number[][] = [], biomass: number[] = []
  for (let round = 1; round <= rounds; round++) {
    state.teams.forEach((team, i) => { team.research += bots[i]!.income * minutes * (0.5 + random()) })
    const scores = new Map(state.teams.map(t => [t.id, t.fish + t.bonus]))
    // Teams look in occasionally, in no fixed order, and see orders given before theirs.
    for (const i of state.teams.map((_, i) => i).sort(() => random() - 0.5)) {
      const me = state.teams[i]!, before = me.contract?.id
      if (round === 1 || random() < bots[i]!.attention) decide({ state, me, config, scores, left: rounds - round + 1, random }, bots[i]!)
      if (me.contract && me.contract.id !== before) taken[i]!.push(me.contract.id)
    }
    const result = resolve(state, config)
    for (const boat of result.report.boats) if (boat.action === 'fish' || boat.action === 'unpaid') { wanted[Number(boat.team)]!++; if (boat.action === 'fish') paid[Number(boat.team)]!++ }
    state = result.state
    leaders.push(state.teams.map((_, i) => i).sort((a, b) => score(b) - score(a) || a - b))
    biomass.push(state.grounds.reduce((sum, g) => sum + g.biomass, 0) / state.grounds.length)
  }
  function score(i: number) { const t = state.teams[i]!; return t.fish + t.bonus }
  return { scores: state.teams.map((_, i) => score(i)), fish: state.teams.map(t => t.fish), completed: state.teams.map(t => t.completed), taken, paid, wanted, leaders, biomass, rounds }
}

class Stat {
  n = 0; sum = 0; squares = 0
  add(x: number) { this.n++; this.sum += x; this.squares += x * x; return this }
  get mean() { return this.n ? this.sum / this.n : 0 }
  // Half-width of a 95% confidence interval for the mean.
  get error() { return this.n > 1 ? 1.96 * Math.sqrt(Math.max(0, this.squares / this.n - this.mean ** 2) / (this.n - 1)) : 0 }
  toString() { return `${this.mean >= 0 ? ' ' : ''}${this.mean.toFixed(1)} ±${this.error.toFixed(1)}` }
}
const statMap = () => new Map<string, Stat>()
const stat = (map: Map<string, Stat>, key: string) => map.get(key) ?? map.set(key, new Stat()).get(key)!

function team(random: () => number, strategy: Strategy, contracts: ContractMode, income = incomes.average): Bot {
  return { strategy, contracts, income, attention: 0.5 + random() * 0.4 }
}

export function evaluate(config: CommonsConfig, runs: number, fieldSizes = sizes) {
  return fieldSizes.map(size => {
    const research = statMap(), invasion = statMap(), mixed = statMap(), wins = statMap(), contracts = statMap(), bonus = statMap(), completion = statMap()
    const convergence = { leaderHolds: new Stat(), lastChange: new Stat() }, pressure = statMap()
    for (let run = 0; run < runs; run++) {
      const random = rng(run * 7919 + size * 104729), seed = run * 31 + size
      // 1. Research: thoughtful teams at three income levels.
      const levels = Object.entries(incomes)
      let bots = Array.from({ length: size }, (_, i) => team(random, 'planner', 'opportunistic', levels[i % 3]![1]))
      let result = play(bots, config, seed)
      bots.forEach((_, i) => stat(research, levels[i % 3]![0]).add(result.paid[i]! / Math.max(1, result.wanted[i]!)))
      // 2. Invasion: one fixed-strategy team among thoughtful ones (score minus the field's mean).
      for (const strategy of fixedStrategies) {
        bots = Array.from({ length: size }, (_, i) => team(random, i ? 'planner' : strategy, 'opportunistic'))
        result = play(bots, config, seed)
        stat(invasion, strategy).add(result.scores[0]! - result.scores.slice(1).reduce((a, b) => a + b, 0) / (size - 1))
      }
      // 3. Mixed field: strategies drawn at random.
      bots = Array.from({ length: size }, () => team(random, strategies[Math.floor(random() * strategies.length)]!, 'opportunistic'))
      result = play(bots, config, seed)
      const best = Math.max(...result.scores)
      bots.forEach((bot, i) => { stat(mixed, bot.strategy).add(result.scores[i]!); stat(wins, bot.strategy).add(result.scores[i] === best ? 1 : 0) })
      const half = result.leaders[Math.floor(result.rounds / 2) - 1]!, final = result.leaders.at(-1)!
      convergence.leaderHolds.add(half[0] === final[0] ? 1 : 0)
      convergence.lastChange.add(result.leaders.reduce((last, r, k) => k && r.slice(0, 3).join() !== result.leaders[k - 1]!.slice(0, 3).join() ? k + 1 : last, 0))
      // 4. Contracts: thoughtful teams with every contract attitude, relative to the field.
      bots = Array.from({ length: size }, (_, i) => team(random, 'planner', contractModes[(i + run) % contractModes.length]!))
      result = play(bots, config, seed)
      const mean = result.scores.reduce((a, b) => a + b, 0) / size
      bots.forEach((bot, i) => {
        stat(contracts, bot.contracts).add(result.scores[i]! - mean); stat(bonus, bot.contracts).add(result.scores[i]! - result.fish[i]!)
        // Per attempt: was it completed? Abandoned or unfinished attempts count as failures.
        if (bot.contracts === 'rational' || bot.contracts === 'opportunistic') for (const id of result.taken[i]!) stat(completion, `${bot.contracts} ${id}`).add(0)
        if (bot.contracts === 'rational' || bot.contracts === 'opportunistic') for (const id of result.completed[i]!) { const s = stat(completion, `${bot.contracts} ${id}`); s.sum++; s.squares++ }
      })
      // 5. Pressure: uniform fields, without contracts.
      for (const strategy of ['greedy', 'planner'] as const) {
        result = play(Array.from({ length: size }, () => team(random, strategy, 'none')), config, seed)
        stat(pressure, `${strategy} catch`).add(result.fish.reduce((a, b) => a + b, 0) / size)
        stat(pressure, `${strategy} biomass`).add(result.biomass.at(-1)!)
        stat(pressure, `${strategy} middle`).add(result.biomass[Math.floor(result.rounds / 2) - 1]!)
      }
    }
    return { size, grounds: config.groundCount(size), research, invasion, mixed, wins, contracts, bonus, completion, convergence, pressure }
  })
}

export function report(config: CommonsConfig, runs: number) {
  const rounds = Math.floor(DURATION_SECONDS / config.resolutionSeconds), results = evaluate(config, runs), checks: [boolean, string][] = []
  const line = (label: string, values: string[]) => console.log(`  ${label.padEnd(30)}${values.map(v => v.padStart(20)).join('')}`)
  console.log(`The Commons: ${rounds} resolutions; cost ${config.fishingCost}, catch ${config.catchAmount}, max ${config.maximumBiomass}, start ${config.startingBiomass}, growth cap ${config.growthCap}, bonus ${config.contractBonus}; ${runs} runs per size; ±95% intervals\n`)
  line('Teams', results.map(r => String(r.size)))
  line('Grounds (sustainable : demand)', results.map(r => `${r.grounds} (${r.grounds * config.growthCap}:${r.size * 2 * config.catchAmount})`))
  console.log('\n1. Research: share of wanted fishing paid for (thoughtful teams)')
  for (const level of Object.keys(incomes)) line(`${level} (${incomes[level as keyof typeof incomes]}/min)`, results.map(r => `${Math.round(stat(r.research, level).mean * 100)}%`))
  console.log('\n2. Strategies')
  console.log('  One fixed-strategy team among thoughtful teams: its score minus theirs (the commons rewards one free rider)')
  for (const s of fixedStrategies) line(s, results.map(r => String(stat(r.invasion, s))))
  console.log('  Mixed fields: mean score (win share)')
  for (const s of strategies) line(s, results.map(r => `${stat(r.mixed, s).mean.toFixed(1)} (${Math.round(stat(r.wins, s).mean * 100)}%)`))
  console.log('\n3. Contracts (thoughtful teams): score relative to the field (bonus earned)')
  for (const m of contractModes) line(m, results.map(r => `${stat(r.contracts, m)}  (${stat(r.bonus, m).mean.toFixed(1)})`))
  console.log('  Attempts per team, and share of attempts completed (timing / steering teams)')
  for (const c of config.contracts) line(c.id, results.map(r => ['opportunistic', 'rational'].map(m => { const s = r.completion.get(`${m} ${c.id}`); return s ? `${(s.n / (runs * r.size / 4)).toFixed(1)}:${Math.round(s.mean * 100)}%` : '-' }).join(' ')))
  console.log('\n4. Convergence (mixed fields)')
  line('Halfway leader wins', results.map(r => `${Math.round(r.convergence.leaderHolds.mean * 100)}%`))
  line('Top three last changed at', results.map(r => `${r.convergence.lastChange.mean.toFixed(1)} of ${rounds}`))
  console.log('\n5. Pressure on the grounds: mean catch per team / mean stock halfway / at the end')
  for (const s of ['greedy', 'planner']) line(`all ${s}`, results.map(r => `${stat(r.pressure, `${s} catch`).mean.toFixed(1)} / ${stat(r.pressure, `${s} middle`).mean.toFixed(1)} / ${stat(r.pressure, `${s} biomass`).mean.toFixed(1)}`))

  for (const r of results) {
    const field = stat(r.mixed, 'planner').mean
    checks.push([stat(r.research, 'average').mean >= 0.8, `${r.size} teams: an average team can pay for at least 80% of its fishing`])
    checks.push([fixedStrategies.every(s => stat(r.mixed, s).mean <= field + stat(r.mixed, s).error), `${r.size} teams: in mixed fields no fixed strategy outscores thoughtful play`])
    const gain = stat(r.contracts, 'rational').mean - stat(r.contracts, 'none').mean
    const timed = stat(r.contracts, 'opportunistic').mean - stat(r.contracts, 'none').mean
    checks.push([[gain, timed].every(x => x > 0.03 * field && x < 0.15 * field), `${r.size} teams: well-timed contracts gain 3–15% of a score (${timed.toFixed(1)} taking aligned ones, ${gain.toFixed(1)} steering, of ${field.toFixed(0)})`])
    checks.push([stat(r.contracts, 'zealot').mean < Math.min(stat(r.contracts, 'rational').mean, stat(r.contracts, 'opportunistic').mean), `${r.size} teams: chasing contracts regardless of timing does worse than timing them`])
    // Any contract-taking team: pooled attempts per available contract.
    const pooled = availableContracts(config, r.grounds).map(c => ['opportunistic', 'rational'].map(m => r.completion.get(`${m} ${c.id}`)).reduce((a, s) => ({ n: a.n + (s?.n ?? 0), done: a.done + (s?.sum ?? 0) }), { n: 0, done: 0 }))
    checks.push([pooled.every(p => p.n > 0 && p.done / p.n >= 0.1 && p.done / p.n <= 0.9), `${r.size} teams: every contract is attempted, and completed in 10–90% of attempts`])
    checks.push([r.convergence.leaderHolds.mean < 0.7, `${r.size} teams: the halfway leader does not usually hold on`])
    const greedy = stat(r.pressure, 'greedy catch').mean, planned = stat(r.pressure, 'planner catch').mean
    checks.push([greedy < 0.9 * planned && stat(r.pressure, 'planner middle').mean >= 4, `${r.size} teams: the commons bites (all-greedy fields catch ${greedy.toFixed(0)}, thoughtful fields ${planned.toFixed(0)}) without collapsing under thoughtful play`])
  }
  const topFixed = results.map(r => fixedStrategies.reduce((a, s) => stat(r.mixed, s).mean > stat(r.mixed, a).mean ? s : a))
  checks.push([new Set(topFixed).size > 1, `no single fixed strategy is best in every field size (${topFixed.join(', ')})`])
  console.log('\nScorecard')
  for (const [ok, text] of checks) console.log(`  ${ok ? 'PASS ' : 'CHECK'} ${text}`)
  return { results, checks }
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  const [runs, ...overrides] = process.argv.slice(2)
  const config: CommonsConfig = { ...commonsConfig }
  for (const pair of [...(Number(runs) ? [] : [runs!]), ...overrides].filter(Boolean)) {
    const [key, value] = pair.split('=')
    if (!(key! in config) || typeof config[key as keyof CommonsConfig] !== 'number' || !Number.isFinite(Number(value))) throw new Error(`Unknown numeric setting: ${pair}`)
    Object.assign(config, { [key!]: Number(value) })
  }
  report(config, Number(runs) || 200)
}
