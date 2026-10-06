// Balance check for The Commons: `npm run simulate -- [runs] [key=value…] [--history file]`,
// for example `npm run simulate -- 200 contractBonus=6 growthCap=2` to try numeric
// overrides of config.ts, or `--history match-history.json` to replace the assumed
// Research incomes and attention with those measured in a rehearsal (the admin's
// Match history download). Bots use the same pure rules as the server.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { commonsConfig } from './config.js'
import { availableContracts, newBoats, newGrounds, resolve, type CommonsConfig, type MatchState } from './rules.js'
import { contractModes, decide, strategies, type Bot, type ContractMode, type Strategy } from './bots.js'
import { DURATION_SECONDS } from '../competition.js'

export interface Assumptions { incomes: { weak: number; average: number; strong: number }; attention: [number, number]; source: string }
// Until a rehearsal is measured: Research per minute for about 2, 5 and 9 first-try
// correct answers per 10 minutes, and teams that look in before 50–90% of resolutions.
export const assumed: Assumptions = { incomes: { weak: 2, average: 5, strong: 9 }, attention: [0.5, 0.9], source: 'assumed' }
export const sizes = [3, 6, 8, 12, 20]
const fixedStrategies = strategies.filter(s => s !== 'planner')

export function rng(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
// Fisher–Yates: every order equally likely (sorting by a random comparator is not).
export function shuffle<T>(items: T[], random: () => number) {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!] }
  return out
}

// Standings with ties: teams level on points share a place, so no team leads just by
// having the lower index. Here, each team's share of first place.
export function winShares(scores: number[]) {
  const best = Math.max(...scores), tied = scores.filter(s => s === best).length
  return scores.map(s => s === best ? 1 / tied : 0)
}
// The top three as a leaderboard shows them: each team's place (1 + teams strictly
// ahead) if it scores at least the third-highest score, otherwise 0. Places, not
// just membership, so a 3-team field still shows its order changing.
export function podium(scores: number[]) {
  const sorted = [...scores].sort((a, b) => b - a), third = sorted[Math.min(2, scores.length - 1)]!
  return scores.map(s => s >= third ? sorted.indexOf(s) + 1 : 0)
}
// Chance that a team drawn from those leading at halfway is the one drawn from the final winners.
export const leaderHolds = (half: number[], final: number[]) => { const f = winShares(final); return winShares(half).reduce((p, h, i) => p + h * f[i]!, 0) }
// The last resolution (1-based) after which the top three differ from the resolution before; 0 if never.
export const lastChange = (standings: number[][]) => standings.reduce((last, s, k) => k && podium(s).join() !== podium(standings[k - 1]!).join() ? k + 1 : last, 0)

export function play(bots: Bot[], config: CommonsConfig, seed: number) {
  const random = rng(seed), rounds = Math.floor(DURATION_SECONDS / config.resolutionSeconds), minutes = config.resolutionSeconds / 60
  let state: MatchState = { grounds: newGrounds(bots.length, config), teams: bots.map((_, i) => ({ id: String(i), research: config.startingResearch, boats: newBoats(), fish: 0, bonus: 0, contract: null, completed: [] })) }
  const paid = bots.map(() => 0), wanted = bots.map(() => 0), taken: string[][] = bots.map(() => []), standings: number[][] = [], biomass: number[] = []
  // Resolutions whose locked orders or contract differ from the previous one's, as a rehearsal history records them.
  const changes = bots.map(() => 0), locked = bots.map(() => '')
  for (let round = 1; round <= rounds; round++) {
    state.teams.forEach((team, i) => { team.research += bots[i]!.income * minutes * (0.5 + random()) })
    const scores = new Map(state.teams.map(t => [t.id, t.fish + t.bonus]))
    // Teams look in occasionally, in no fixed order, and see orders given before theirs.
    for (const i of shuffle(state.teams.map((_, i) => i), random)) {
      const me = state.teams[i]!, before = me.contract?.id
      if (round === 1 || random() < bots[i]!.attention) decide({ state, me, config, scores, left: rounds - round + 1, random }, bots[i]!)
      if (me.contract && me.contract.id !== before) taken[i]!.push(me.contract.id)
    }
    state.teams.forEach((t, i) => { const now = JSON.stringify([t.boats.map(b => b.order), t.contract?.id]); if (round > 1 && now !== locked[i]) changes[i]!++; locked[i] = now })
    const result = resolve(state, config)
    for (const boat of result.report.boats) if (boat.action === 'fish' || boat.action === 'unpaid') { wanted[Number(boat.team)]!++; if (boat.action === 'fish') paid[Number(boat.team)]!++ }
    state = result.state
    standings.push(state.teams.map(t => t.fish + t.bonus))
    biomass.push(state.grounds.reduce((sum, g) => sum + g.biomass, 0) / state.grounds.length)
  }
  return { scores: state.teams.map(t => t.fish + t.bonus), fish: state.teams.map(t => t.fish), completed: state.teams.map(t => t.completed), taken, paid, wanted, changes, standings, biomass, rounds }
}

class Stat {
  n = 0; sum = 0; squares = 0
  add(x: number) { this.n++; this.sum += x; this.squares += x * x; return this }
  get mean() { return this.n ? this.sum / this.n : 0 }
  // Half-width of a 95% confidence interval for the mean.
  get error() { return this.n > 1 ? 1.96 * Math.sqrt(Math.max(0, this.squares / this.n - this.mean ** 2) / (this.n - 1)) : 0 }
  toString() { return this.n ? `${this.mean >= 0 ? ' ' : ''}${this.mean.toFixed(1)} ±${this.error.toFixed(1)}` : '-' }
}
const statMap = () => new Map<string, Stat>()
const stat = (map: Map<string, Stat>, key: string) => map.get(key) ?? map.set(key, new Stat()).get(key)!
const percent = (s: Stat) => s.n ? `${Math.round(s.mean * 100)}%` : '-'
const convergence = () => ({ leaderHolds: new Stat(), lastChange: new Stat() })
function converge(into: ReturnType<typeof convergence>, standings: number[][]) {
  into.leaderHolds.add(leaderHolds(standings[Math.max(0, Math.floor(standings.length / 2) - 1)]!, standings.at(-1)!)); into.lastChange.add(lastChange(standings))
}

let assumptions = assumed
const middle = (using: Assumptions) => (using.attention[0] + using.attention[1]) / 2
function team(random: () => number, strategy: Strategy, contracts: ContractMode, income = assumptions.incomes.average): Bot {
  const [low, high] = assumptions.attention
  return { strategy, contracts, income, attention: low + random() * (high - low) }
}

export function evaluate(config: CommonsConfig, runs: number, fieldSizes = sizes, using = assumed) {
  assumptions = using
  const incomes = using.incomes, attention = middle(using)
  return fieldSizes.map(size => {
    const research = statMap(), invasion = statMap(), mixed = statMap(), wins = statMap(), contracts = statMap(), bonus = statMap(), completion = statMap()
    const settling = { mixed: convergence(), identical: convergence() }, pressure = statMap()
    for (let run = 0; run < runs; run++) {
      const random = rng(run * 7919 + size * 104729), seed = run * 31 + size
      // 1. Research: thoughtful teams at three income levels.
      const levels = Object.entries(incomes)
      let bots = Array.from({ length: size }, (_, i) => team(random, 'planner', 'opportunistic', levels[i % 3]![1]))
      let result = play(bots, config, seed)
      bots.forEach((_, i) => stat(research, levels[i % 3]![0]).add(result.paid[i]! / Math.max(1, result.wanted[i]!)))
      // 2. Invasion: one fixed-strategy team, placed at random, among thoughtful ones
      // (score minus the field's mean). It needs at least one thoughtful team.
      if (size > 1) for (const strategy of fixedStrategies) {
        const at = Math.floor(random() * size)
        bots = Array.from({ length: size }, (_, i) => team(random, i === at ? strategy : 'planner', 'opportunistic'))
        result = play(bots, config, seed)
        stat(invasion, strategy).add(result.scores[at]! - (result.scores.reduce((a, b) => a + b, 0) - result.scores[at]!) / (size - 1))
      }
      // 3. Mixed field: strategies drawn at random. Teams tied for the win share it.
      bots = Array.from({ length: size }, () => team(random, strategies[Math.floor(random() * strategies.length)]!, 'opportunistic'))
      result = play(bots, config, seed)
      const shares = winShares(result.scores)
      bots.forEach((bot, i) => { stat(mixed, bot.strategy).add(result.scores[i]!); stat(wins, bot.strategy).add(shares[i]!) })
      if (size > 1) converge(settling.mixed, result.standings)
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
      // 6. Identical thoughtful teams (same income, contract attitude and attention):
      // does a lead persist when no team is better than another? Chance is 1 / size.
      if (size > 1) converge(settling.identical, play(Array.from({ length: size }, (): Bot => ({ strategy: 'planner', contracts: 'opportunistic', income: incomes.average, attention })), config, seed).standings)
    }
    return { size, grounds: config.groundCount(size), research, invasion, mixed, wins, contracts, bonus, completion, convergence: settling, pressure }
  })
}

export function report(config: CommonsConfig, runs: number, using = assumed, fieldSizes = sizes) {
  const rounds = Math.floor(DURATION_SECONDS / config.resolutionSeconds), results = evaluate(config, runs, fieldSizes, using), checks: [boolean, string][] = [], incomes = using.incomes
  const line = (label: string, values: string[]) => console.log(`  ${label.padEnd(30)}${values.map(v => v.padStart(20)).join('')}`)
  console.log(`The Commons: ${rounds} resolutions; cost ${config.fishingCost}, catch ${config.catchAmount}, max ${config.maximumBiomass}, start ${config.startingBiomass}, growth cap ${config.growthCap}, bonus ${config.contractBonus}; ${runs} runs per size; ±95% intervals`)
  console.log(`Teams (${using.source}): Research per minute ${incomes.weak.toFixed(1)} / ${incomes.average.toFixed(1)} / ${incomes.strong.toFixed(1)} (weak / average / strong); look in before ${Math.round(using.attention[0] * 100)}–${Math.round(using.attention[1] * 100)}% of resolutions\n`)
  line('Teams', results.map(r => String(r.size)))
  line('Grounds (sustainable : demand)', results.map(r => `${r.grounds} (${r.grounds * config.growthCap}:${r.size * 2 * config.catchAmount})`))
  console.log('\n1. Research: share of wanted fishing paid for (thoughtful teams)')
  for (const level of Object.keys(incomes)) line(`${level} (${incomes[level as keyof typeof incomes].toFixed(1)}/min)`, results.map(r => percent(stat(r.research, level))))
  console.log('\n2. Strategies')
  console.log('  One fixed-strategy team among thoughtful teams: its score minus theirs (the commons rewards one free rider)')
  for (const s of fixedStrategies) line(s, results.map(r => String(stat(r.invasion, s))))
  console.log('  Mixed fields: mean score (win share)')
  for (const s of strategies) line(s, results.map(r => stat(r.mixed, s).n ? `${stat(r.mixed, s).mean.toFixed(1)} (${percent(stat(r.wins, s))})` : '-'))
  console.log('\n3. Contracts (thoughtful teams): score relative to the field (bonus earned)')
  for (const m of contractModes) line(m, results.map(r => `${stat(r.contracts, m)}  (${stat(r.bonus, m).mean.toFixed(1)})`))
  console.log('  Attempts per team, and share of attempts completed (timing / steering teams)')
  for (const c of config.contracts) line(c.id, results.map(r => ['opportunistic', 'rational'].map(m => { const s = r.completion.get(`${m} ${c.id}`); return s ? `${(s.n / (runs * r.size / 4)).toFixed(1)}:${Math.round(s.mean * 100)}%` : '-' }).join(' ')))
  const lastAt = (s: Stat) => s.n ? `${s.mean.toFixed(1)} of ${rounds}` : '-'
  console.log('\n4. Convergence: how often the halfway leader wins, and when the top three last changed (tied teams share a place)')
  console.log('  Mixed fields')
  line('Halfway leader wins', results.map(r => percent(r.convergence.mixed.leaderHolds)))
  line('Top three last changed at', results.map(r => lastAt(r.convergence.mixed.lastChange)))
  console.log(`  Identical thoughtful teams: average income, opportunistic contracts, look in before ${Math.round(middle(using) * 100)}% of resolutions`)
  line('Halfway leader wins (chance)', results.map(r => r.convergence.identical.leaderHolds.n ? `${percent(r.convergence.identical.leaderHolds)} (${Math.round(100 / r.size)}%)` : '-'))
  line('Top three last changed at', results.map(r => lastAt(r.convergence.identical.lastChange)))
  console.log('\n5. Pressure on the grounds: mean catch per team / mean stock halfway / at the end')
  for (const s of ['greedy', 'planner']) line(`all ${s}`, results.map(r => `${stat(r.pressure, `${s} catch`).mean.toFixed(1)} / ${stat(r.pressure, `${s} middle`).mean.toFixed(1)} / ${stat(r.pressure, `${s} biomass`).mean.toFixed(1)}`))

  for (const r of results) {
    const field = stat(r.mixed, 'planner').mean
    checks.push([stat(r.research, 'average').mean >= 0.8, `${r.size} teams: an average team can pay for at least 80% of its fishing`])
    // Meaningfully: by more than 3% of a score and beyond the combined 95% margin of both means.
    const planner = stat(r.mixed, 'planner'), gap = (s: Strategy) => stat(r.mixed, s).mean - planner.mean
    const ahead = fixedStrategies.filter(s => gap(s) > Math.max(0.03 * field, Math.hypot(stat(r.mixed, s).error, planner.error)))
    const closest = fixedStrategies.reduce((a, s) => gap(s) > gap(a) ? s : a)
    checks.push([!ahead.length, `${r.size} teams: in mixed fields no fixed strategy beats thoughtful play by more than 3% (closest: ${closest} ${gap(closest) >= 0 ? '+' : ''}${gap(closest).toFixed(1)})`])
    const gain = stat(r.contracts, 'rational').mean - stat(r.contracts, 'none').mean
    const timed = stat(r.contracts, 'opportunistic').mean - stat(r.contracts, 'none').mean
    checks.push([[gain, timed].every(x => x > 0.03 * field && x < 0.15 * field), `${r.size} teams: well-timed contracts gain 3–15% of a score (${timed.toFixed(1)} taking aligned ones, ${gain.toFixed(1)} steering, of ${field.toFixed(0)})`])
    checks.push([stat(r.contracts, 'zealot').mean < Math.min(stat(r.contracts, 'rational').mean, stat(r.contracts, 'opportunistic').mean), `${r.size} teams: chasing contracts regardless of timing does worse than timing them`])
    // Any contract-taking team: pooled attempts per available contract.
    const pooled = availableContracts(config, r.grounds).map(c => ['opportunistic', 'rational'].map(m => r.completion.get(`${m} ${c.id}`)).reduce((a, s) => ({ n: a.n + (s?.n ?? 0), done: a.done + (s?.sum ?? 0) }), { n: 0, done: 0 }))
    checks.push([pooled.every(p => p.n > 0 && p.done / p.n >= 0.1 && p.done / p.n <= 0.9), `${r.size} teams: every contract is attempted, and completed in 10–90% of attempts`])
    if (r.size > 1) checks.push([r.convergence.mixed.leaderHolds.mean < 0.7, `${r.size} teams: the halfway leader does not usually hold on`])
    const greedy = stat(r.pressure, 'greedy catch').mean, planned = stat(r.pressure, 'planner catch').mean
    checks.push([greedy < 0.9 * planned && stat(r.pressure, 'planner middle').mean >= 4, `${r.size} teams: the commons bites (all-greedy fields catch ${greedy.toFixed(0)}, thoughtful fields ${planned.toFixed(0)}) without collapsing under thoughtful play`])
  }
  const topFixed = results.map(r => fixedStrategies.reduce((a, s) => stat(r.mixed, s).mean > stat(r.mixed, a).mean ? s : a))
  checks.push([new Set(topFixed).size > 1, `no single fixed strategy is best in every field size (${topFixed.join(', ')})`])
  console.log('\nScorecard')
  for (const [ok, text] of checks) console.log(`  ${ok ? 'PASS ' : 'CHECK'} ${text}`)
  // Two boats every resolution, 80% of the time, from an average team's income.
  const affordable = Math.floor(incomes.average * config.resolutionSeconds / 60 / (2 * 0.8))
  if (results.some(r => stat(r.research, 'average').mean < 0.8)) console.log(`\n  Hint: with these incomes, fishingCost ${Math.max(1, affordable)} or less lets an average team pay for about 80% of its fishing.`)
  return { results, checks }
}

interface HistoryTeam { id: string; name?: string; research: number; boats: { order: number | null }[]; contract: { id: string } | null }
export interface MatchHistory {
  config: { resolutionSeconds: number; startingResearch: number }
  resolutions: { before: { teams: HistoryTeam[] }; report: { teams: { id: string; research: number }[] } }[]
}
const quantile = (values: number[], q: number) => { const v = [...values].sort((a, b) => a - b), i = (v.length - 1) * q, lo = Math.floor(i); return v[lo]! + (v[Math.ceil(i)]! - v[lo]!) * (i - lo) }

// Measures each team of a rehearsal: Research earned per minute between resolutions
// (after its fishing payments) and the share of resolutions before which it changed
// an order or contract. Bot attention is then set so that bots change orders as often.
export function calibrate(history: MatchHistory, config: CommonsConfig) {
  const records = history.resolutions, minutes = history.config.resolutionSeconds / 60
  if (records.length < 3) throw new Error('The match history needs at least three resolutions.')
  if (!records[0]!.before.teams.length) throw new Error('The match history has no teams.')
  const teams = records[0]!.before.teams.map(first => {
    let earned = 0, intervals = 0, changes = 0, compared = 0
    records.forEach((record, k) => {
      const now = record.before.teams.find(t => t.id === first.id)
      const previous = k ? records[k - 1]!.report.teams.find(t => t.id === first.id)?.research : history.config.startingResearch
      if (!now || previous === undefined) return
      earned += now.research - previous; intervals++
      const before = k ? records[k - 1]!.before.teams.find(t => t.id === first.id) : undefined
      if (before) { compared++; if (JSON.stringify([before.boats.map(b => b.order), before.contract?.id]) !== JSON.stringify([now.boats.map(b => b.order), now.contract?.id])) changes++ }
    })
    return { name: first.name ?? first.id, perMinute: Math.max(0, earned / (intervals * minutes)), changeRate: compared ? changes / compared : 0 }
  })
  // How often thoughtful bots change orders at each attention level, in a field of this size.
  const levels = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map(attention => {
    let changes = 0, observed = 0
    for (let run = 0; run < 12; run++) {
      const result = play(teams.map(() => ({ strategy: 'planner', contracts: 'opportunistic', income: assumed.incomes.average, attention })), config, run)
      changes += result.changes.reduce((a, b) => a + b, 0); observed += teams.length * (result.rounds - 1)
    }
    return { attention, rate: changes / observed }
  })
  const attentionFor = (rate: number) => {
    const above = levels.findIndex(l => l.rate >= rate)
    if (above <= 0) return above === 0 ? levels[0]!.attention : 1
    const a = levels[above - 1]!, b = levels[above]!
    return a.attention + (b.attention - a.attention) * (rate - a.rate) / Math.max(1e-9, b.rate - a.rate)
  }
  const rates = teams.map(t => t.changeRate), incomes = teams.map(t => t.perMinute)
  const assumptions: Assumptions = {
    incomes: { weak: quantile(incomes, 0.25), average: quantile(incomes, 0.5), strong: quantile(incomes, 0.75) },
    attention: [attentionFor(quantile(rates, 0.25)), attentionFor(quantile(rates, 0.75))],
    source: `measured from ${teams.length} team${teams.length === 1 ? '' : 's'} over ${records.length} resolutions`,
  }
  return { teams, assumptions }
}

// Reads every argument before calibrating, so overrides apply to the calibration
// as well as the report, whatever their order.
export function setup(args: string[]) {
  const config: CommonsConfig = { ...commonsConfig }
  let runs = 200, history: string | undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--history') { history = args[++i]; if (history === undefined) throw new Error('--history needs a match history file.') }
    else if (/^\d+$/.test(arg)) runs = Number(arg)
    else {
      const [key, value] = arg.split('=')
      if (!(key! in config) || typeof config[key as keyof CommonsConfig] !== 'number' || !Number.isFinite(Number(value))) throw new Error(`Unknown numeric setting: ${arg}`)
      Object.assign(config, { [key!]: Number(value) })
    }
  }
  const calibrated = history === undefined ? null : calibrate(JSON.parse(readFileSync(history, 'utf8')) as MatchHistory, config)
  // The rehearsal's team count joins the field sizes. A lone team still calibrates
  // income and attention, but one team is no field to evaluate.
  const count = calibrated?.teams.length ?? 0
  return { config, runs, teams: calibrated?.teams ?? [], using: calibrated?.assumptions ?? assumed, fieldSizes: count < 2 || sizes.includes(count) ? sizes : [...sizes, count].sort((a, b) => a - b) }
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  const { config, runs, teams, using, fieldSizes } = setup(process.argv.slice(2))
  for (const t of teams) console.log(`  ${t.name.padEnd(30)} ${t.perMinute.toFixed(1).padStart(5)} Research/min, changed orders before ${Math.round(t.changeRate * 100)}% of resolutions`)
  if (teams.length) console.log('')
  report(config, runs, using, fieldSizes)
}
