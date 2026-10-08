// Balance check for The Commons: `npm run simulate -- [runs] [key=value…] [--history file]`,
// for example `npm run simulate -- 100 fuelCost=2 width=20` to try numeric overrides
// of config.ts, or `--history match-history.json` to replace the assumed Research
// incomes and attention with those measured in a rehearsal (the admin's Match history
// download). Bots use the same pure rules as the server.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { commonsConfig } from './config.js'
import { newMatch, rng, step, type CommonsConfig } from './rules.js'
import { decide, strategies, type Bot, type Strategy } from './bots.js'
import { DURATION_SECONDS } from '../competition.js'

// `every`: the range of minutes between a team's looks at the game.
export interface Assumptions { incomes: { weak: number; average: number; strong: number }; every: [number, number]; source: string }
// Until a rehearsal is measured: Research per minute for about 2, 5 and 9 first-try
// correct answers per 10 minutes, and teams that look in every 1 to 4 minutes.
export const assumed: Assumptions = { incomes: { weak: 2, average: 5, strong: 9 }, every: [1, 4], source: 'assumed' }
export const sizes = [3, 6, 8, 12, 20]
export const looks = [1, 2, 5, 10]
const fixedStrategies = strategies.filter(s => s !== 'planner')

// Standings with ties: teams level on points share a place, so no team leads just by
// having the lower index. Here, each team's share of first place.
export function winShares(scores: number[]) {
  const best = Math.max(...scores), tied = scores.filter(s => s === best).length
  return scores.map(s => s === best ? 1 / tied : 0)
}
// Chance that a team drawn from those leading at halfway is the one drawn from the final winners.
export const leaderHolds = (half: number[], final: number[]) => { const f = winShares(final); return winShares(half).reduce((p, h, i) => p + h * f[i]!, 0) }

// One match. Teams earn Research every minute and look in now and then, at random
// times averaging `every` minutes apart; in between, their boats carry on alone.
export function play(bots: Bot[], config: CommonsConfig, seed: number) {
  const random = rng(seed), ticks = Math.floor(DURATION_SECONDS / config.tickSeconds), minute = Math.max(1, Math.round(60 / config.tickSeconds))
  const state = newMatch(bots.map((_, i) => String(i)), config, seed)
  state.boats.forEach(b => { b.research = config.startingResearch })
  const look = bots.map(() => 1), moved = bots.map(() => 0), stalled = bots.map(() => 0), orders = bots.map(() => 0), standings: number[][] = []
  const golden = { appeared: 0, caught: 0, gone: 0 }
  for (let tick = 1; tick <= ticks; tick++) {
    if (tick % minute === 1 % minute) state.boats.forEach((b, i) => { b.research += bots[i]!.income * (0.5 + random()) })
    state.boats.forEach((me, i) => {
      if (tick < look[i]!) return
      const bot = bots[i]!, interval = bot.every * minute
      const target = decide({ state, me, config, horizon: Math.max(minute, interval) }, bot)
      if (target) { me.target = target; orders[i]!++ }
      look[i] = tick + Math.max(1, Math.round(interval * (0.5 + random())))
    })
    const report = step(state, config)
    for (const team of report.moved) moved[Number(team)]!++
    for (const team of report.stalled) stalled[Number(team)]!++
    for (const e of report.events) golden[e.kind]++
    if (tick % minute === 0) standings.push(state.boats.map(b => b.fish + b.bonus))
  }
  return { scores: state.boats.map(b => b.fish + b.bonus), bonus: state.boats.map(b => b.bonus), moved, stalled, orders, standings, golden, minutes: ticks / minute }
}

class Stat {
  n = 0; sum = 0; squares = 0
  add(x: number) { this.n++; this.sum += x; this.squares += x * x; return this }
  get mean() { return this.n ? this.sum / this.n : 0 }
  // Half-width of a 95% confidence interval for the mean.
  get error() { return this.n > 1 ? 1.96 * Math.sqrt(Math.max(0, this.squares / this.n - this.mean ** 2) / (this.n - 1)) : 0 }
  toString() { return this.n ? `${this.mean.toFixed(1)} ±${this.error.toFixed(1)}` : '-' }
}
const statMap = () => new Map<string, Stat>()
const stat = (map: Map<string, Stat>, key: string) => map.get(key) ?? map.set(key, new Stat()).get(key)!
const percent = (s: Stat) => s.n ? `${Math.round(s.mean * 100)}%` : '-'
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length

export function evaluate(config: CommonsConfig, runs: number, fieldSizes = sizes, using = assumed) {
  const { incomes } = using, [low, high] = using.every
  const team = (random: () => number, strategy: Strategy, income = incomes.average): Bot => ({ strategy, income, every: low + random() * (high - low) })
  return fieldSizes.map(size => {
    const research = statMap(), attention = statMap(), invasion = statMap(), mixed = statMap(), wins = statMap(), golden = statMap(), herding = statMap()
    const settling = { mixed: new Stat(), identical: new Stat() }
    const halfway = (standings: number[][]) => leaderHolds(standings[Math.floor(standings.length / 2) - 1]!, standings.at(-1)!)
    for (let run = 0; run < runs; run++) {
      const random = rng(run * 7919 + size * 104729), seed = run * 31 + size
      // 1. Research: thoughtful teams at three income levels; score relative to the field.
      const levels = Object.entries(incomes)
      let bots = Array.from({ length: size }, (_, i) => team(random, 'planner', levels[(i + run) % 3]![1]))
      let result = play(bots, config, seed), field = mean(result.scores)
      bots.forEach((_, i) => {
        const level = levels[(i + run) % 3]![0]
        stat(research, `${level} paid`).add(result.moved[i]! / Math.max(1, result.moved[i]! + result.stalled[i]!))
        stat(research, level).add(result.scores[i]! / field)
      })
      stat(golden, 'share').add(result.bonus.reduce((a, b) => a + b, 0) / Math.max(1, field * size))
      stat(golden, 'missed').add(result.golden.gone / Math.max(1, result.golden.appeared))
      // 2. Attention: thoughtful teams that look in every 1, 2, 5 or 10 minutes; score relative to the field.
      bots = Array.from({ length: size }, (_, i): Bot => ({ strategy: 'planner', income: incomes.average, every: looks[(i + run) % looks.length]! }))
      result = play(bots, config, seed); field = mean(result.scores)
      bots.forEach((bot, i) => stat(attention, String(bot.every)).add(result.scores[i]! / field))
      // 3. Invasion: one rule-of-thumb team, placed at random, among thoughtful ones
      // (score minus the field's mean). It needs at least one thoughtful team.
      if (size > 1) for (const strategy of fixedStrategies) {
        const at = Math.floor(random() * size)
        bots = Array.from({ length: size }, (_, i) => team(random, i === at ? strategy : 'planner'))
        result = play(bots, config, seed)
        stat(invasion, strategy).add(result.scores[at]! - (result.scores.reduce((a, b) => a + b, 0) - result.scores[at]!) / (size - 1))
      }
      // 4. Mixed field: strategies drawn at random. Teams tied for the win share it.
      bots = Array.from({ length: size }, () => team(random, strategies[Math.floor(random() * strategies.length)]!))
      result = play(bots, config, seed)
      const shares = winShares(result.scores)
      bots.forEach((bot, i) => { stat(mixed, bot.strategy).add(result.scores[i]!); stat(wins, bot.strategy).add(shares[i]!) })
      if (size > 1) settling.mixed.add(halfway(result.standings))
      // 5. Herding: uniform fields of teams that all go for the biggest school, or all plan.
      for (const strategy of ['biggest', 'planner'] as const) stat(herding, strategy).add(mean(play(Array.from({ length: size }, () => team(random, strategy)), config, seed).scores))
      // 6. Identical thoughtful teams (same income and attention): does a lead persist
      // when no team is better than another? Chance is 1 / size.
      if (size > 1) settling.identical.add(halfway(play(Array.from({ length: size }, (): Bot => ({ strategy: 'planner', income: incomes.average, every: (low + high) / 2 })), config, seed).standings))
    }
    return { size, research, attention, invasion, mixed, wins, golden, herding, settling }
  })
}

export function report(config: CommonsConfig, runs: number, using = assumed, fieldSizes = sizes) {
  const results = evaluate(config, runs, fieldSizes, using), checks: [boolean, string][] = [], { incomes } = using
  const line = (label: string, values: string[]) => console.log(`  ${label.padEnd(30)}${values.map(v => v.padStart(16)).join('')}`)
  console.log(`The Commons: ${config.width}×${config.height} map, ${DURATION_SECONDS / 60} minutes in ${config.tickSeconds}-second ticks; fuel ${config.fuelCost}/tile, a fish every ${config.catchTicks} ticks, schools ${config.schoolStart}–${config.schoolMax} (+${config.growthCap} per ${config.growthTicks} ticks), golden ${config.goldenFish}×${config.goldenValue} every ${config.goldenEvery} ticks for ${config.goldenTicks}; ${runs} runs per size; ±95% intervals`)
  console.log(`Teams (${using.source}): Research per minute ${incomes.weak.toFixed(1)} / ${incomes.average.toFixed(1)} / ${incomes.strong.toFixed(1)} (weak / average / strong); look in every ${using.every[0].toFixed(1)}–${using.every[1].toFixed(1)} minutes\n`)
  line('Teams', results.map(r => String(r.size)))
  console.log('\n1. Research (thoughtful teams): share of wanted sailing they could pay for / score relative to the field')
  for (const level of Object.keys(incomes)) line(`${level} (${incomes[level as keyof typeof incomes].toFixed(1)}/min)`, results.map(r => `${percent(stat(r.research, `${level} paid`))} / ${percent(stat(r.research, level))}`))
  console.log('\n2. Attention (thoughtful teams, average income): score relative to the field')
  for (const every of looks) line(`looks in every ${every} min`, results.map(r => percent(stat(r.attention, String(every)))))
  console.log('\n3. Strategies')
  console.log('  One rule-of-thumb team among thoughtful teams: its score minus theirs')
  for (const s of fixedStrategies) line(s, results.map(r => String(stat(r.invasion, s))))
  console.log('  Mixed fields: mean score (win share)')
  for (const s of strategies) line(s, results.map(r => stat(r.mixed, s).n ? `${stat(r.mixed, s).mean.toFixed(0)} (${percent(stat(r.wins, s))})` : '-'))
  console.log('\n4. Golden fish (thoughtful teams): share of all points / share of golden schools that swam off')
  line('golden', results.map(r => `${percent(stat(r.golden, 'share'))} / ${percent(stat(r.golden, 'missed'))}`))
  console.log('\n5. Herding: mean score when every team goes for the biggest school, or every team plans')
  for (const s of ['biggest', 'planner']) line(`all ${s}`, results.map(r => stat(r.herding, s).mean.toFixed(0)))
  console.log('\n6. Convergence: how often the halfway leader wins (tied teams share a place)')
  line('Mixed fields', results.map(r => percent(r.settling.mixed)))
  line('Identical teams (chance)', results.map(r => r.settling.identical.n ? `${percent(r.settling.identical)} (${Math.round(100 / r.size)}%)` : '-'))

  for (const r of results) {
    const field = stat(r.mixed, 'planner').mean, look = (every: number) => stat(r.attention, String(every)).mean
    checks.push([stat(r.research, 'average paid').mean >= 0.9, `${r.size} teams: an average team can pay for at least 90% of the sailing it wants`])
    const gap = stat(r.research, 'strong').mean - stat(r.research, 'weak').mean
    checks.push([gap >= 0.05 && gap <= 0.5, `${r.size} teams: Research matters without deciding everything (strong teams score ${Math.round(gap * 100)}% of the field more than weak ones; 5–50%)`])
    // Mostly golden-fish races, which the team that looks first wins.
    checks.push([look(2) >= 0.8 * look(1) && look(5) >= 0.65 * look(1), `${r.size} teams: no constant attention needed (looking every 2 minutes scores ${Math.round(100 * look(2) / look(1))}% and every 5 minutes ${Math.round(100 * look(5) / look(1))}% of every minute; at least 80% and 65%)`])
    checks.push([look(10) < 0.95 * look(5), `${r.size} teams: looking in still pays (every 10 minutes scores ${Math.round(100 * look(10) / look(5))}% of every 5)`])
    // Confidently: the gap minus the combined 95% margin of both means still exceeds 3% of a score.
    const planner = stat(r.mixed, 'planner'), ahead = (s: Strategy) => stat(r.mixed, s).mean - planner.mean
    const beating = fixedStrategies.filter(s => ahead(s) - Math.hypot(stat(r.mixed, s).error, planner.error) > 0.03 * field)
    const closest = fixedStrategies.reduce((a, s) => ahead(s) > ahead(a) ? s : a)
    checks.push([!beating.length, `${r.size} teams: in mixed fields no rule of thumb beats thoughtful play by more than 3% (closest: ${closest} ${ahead(closest) >= 0 ? '+' : ''}${ahead(closest).toFixed(1)})`])
    const share = stat(r.golden, 'share').mean
    checks.push([share >= 0.05 && share <= 0.25, `${r.size} teams: golden fish are worth chasing without deciding the match (${Math.round(share * 100)}% of points; 5–25%)`])
    checks.push([stat(r.herding, 'biggest').mean < 0.9 * stat(r.herding, 'planner').mean, `${r.size} teams: crowding the biggest school is punished (${stat(r.herding, 'biggest').mean.toFixed(0)} against ${stat(r.herding, 'planner').mean.toFixed(0)} a team)`])
    // In mixed fields the better team should win; among equals, an early lead should not settle the match.
    if (r.size > 1) checks.push([r.settling.identical.mean < 0.75, `${r.size} teams: among identical teams the halfway leader is not locked in (wins ${percent(r.settling.identical)}; chance ${Math.round(100 / r.size)}%)`])
  }
  const topFixed = results.map(r => fixedStrategies.reduce((a, s) => stat(r.mixed, s).mean > stat(r.mixed, a).mean ? s : a))
  checks.push([new Set(topFixed).size > 1, `no single rule of thumb is best in every field size (${topFixed.join(', ')})`])
  console.log('\nScorecard')
  for (const [ok, text] of checks) console.log(`  ${ok ? 'PASS ' : 'CHECK'} ${text}`)
  return { results, checks }
}

export interface MatchHistory {
  config: { tickSeconds: number }
  samples: { tick: number; teams: { id: string; name?: string; research: number; spent: number }[] }[]
  orders: { tick: number; team: string }[]
}
const quantile = (values: number[], q: number) => { const v = [...values].sort((a, b) => a - b), i = (v.length - 1) * q, lo = Math.floor(i); return v[lo]! + (v[Math.ceil(i)]! - v[lo]!) * (i - lo) }

// Measures each team of a rehearsal: Research earned per minute (what it holds plus
// what it burnt, from the first to the last minute sample) and orders per minute.
// Bot attention is then set so that thoughtful bots give orders as often.
export function calibrate(history: MatchHistory, config: CommonsConfig) {
  const { samples } = history
  if (samples.length < 3) throw new Error('The match history needs at least three minutes of play.')
  const first = samples[0]!, last = samples.at(-1)!, minutes = (last.tick - first.tick) * history.config.tickSeconds / 60
  if (!first.teams.length) throw new Error('The match history has no teams.')
  const teams = first.teams.map(start => {
    const end = last.teams.find(t => t.id === start.id) ?? start
    const given = history.orders.filter(o => o.team === start.id && o.tick > first.tick && o.tick <= last.tick).length
    return { name: start.name ?? start.id, perMinute: Math.max(0, (end.research + end.spent - start.research - start.spent) / minutes), ordersPerMinute: given / minutes }
  })
  // How often thoughtful bots give orders when they look in every so many minutes, in a field of this size.
  const levels = [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12].map(every => {
    let orders = 0, observed = 0
    for (let run = 0; run < 6; run++) {
      const result = play(teams.map((): Bot => ({ strategy: 'planner', income: assumed.incomes.average, every })), config, run)
      orders += result.orders.reduce((a, b) => a + b, 0); observed += teams.length * result.minutes
    }
    return { every, rate: orders / observed }
  })
  // Rates fall as looks grow rarer: interpolate, clamped to the range measured.
  const everyFor = (rate: number) => {
    const below = levels.findIndex(l => l.rate <= rate)
    if (below <= 0) return below === 0 ? levels[0]!.every : levels.at(-1)!.every
    const a = levels[below - 1]!, b = levels[below]!
    return a.every + (b.every - a.every) * (a.rate - rate) / Math.max(1e-9, a.rate - b.rate)
  }
  const rates = teams.map(t => t.ordersPerMinute), incomes = teams.map(t => t.perMinute)
  const assumptions: Assumptions = {
    incomes: { weak: quantile(incomes, 0.25), average: quantile(incomes, 0.5), strong: quantile(incomes, 0.75) },
    every: [everyFor(quantile(rates, 0.75)), everyFor(quantile(rates, 0.25))],
    source: `measured from ${teams.length} team${teams.length === 1 ? '' : 's'} over ${Math.round(minutes)} minutes`,
  }
  return { teams, assumptions }
}

// Reads every argument before calibrating, so overrides apply to the calibration
// as well as the report, whatever their order.
export function setup(args: string[]) {
  const config: CommonsConfig = { ...commonsConfig }
  let runs = 100, history: string | undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--history') { history = args[++i]; if (history === undefined) throw new Error('--history needs a match history file.') }
    else if (/^\d+$/.test(arg)) runs = Number(arg)
    else {
      const [key = '', ...values] = arg.split('='), value = values.join('=')
      if (!Object.hasOwn(config, key)) throw new Error(`Unknown setting: ${arg}`)
      // Number('') is 0, so an empty value would quietly zero the setting.
      if (values.length !== 1 || !value.trim() || !Number.isFinite(Number(value))) throw new Error(`${arg}: give ${key} a single number, as in ${key}=${commonsConfig[key as keyof CommonsConfig]}.`)
      Object.assign(config, { [key]: Number(value) })
    }
  }
  // A match needs at least one tick, and the map and timers whole numbers of tiles and ticks.
  if (!(config.tickSeconds > 0 && config.tickSeconds <= DURATION_SECONDS)) throw new Error(`tickSeconds must be more than 0 and at most ${DURATION_SECONDS} (the match length).`)
  for (const key of ['width', 'height', 'catchTicks', 'growthTicks', 'goldenEvery'] as const) if (!(Number.isInteger(config[key]) && config[key] >= 1)) throw new Error(`${key} must be a whole number of at least 1.`)
  const calibrated = history === undefined ? null : calibrate(JSON.parse(readFileSync(history, 'utf8')) as MatchHistory, config)
  // The rehearsal's team count joins the field sizes. A lone team still calibrates
  // income and attention, but one team is no field to evaluate.
  const count = calibrated?.teams.length ?? 0
  return { config, runs, teams: calibrated?.teams ?? [], using: calibrated?.assumptions ?? assumed, fieldSizes: count < 2 || sizes.includes(count) ? sizes : [...sizes, count].sort((a, b) => a - b) }
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  const { config, runs, teams, using, fieldSizes } = setup(process.argv.slice(2))
  for (const t of teams) console.log(`  ${t.name.padEnd(30)} ${t.perMinute.toFixed(1).padStart(5)} Research/min, ${t.ordersPerMinute.toFixed(2)} orders/min`)
  if (teams.length) console.log('')
  report(config, runs, using, fieldSizes)
}
