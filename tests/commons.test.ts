import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commonsConfig } from '../server/game/config.js'
import { distance, distances, growth, isSea, lookahead, newMatch, route, step, type Boat, type CommonsConfig, type MatchState, type School } from '../server/game/rules.js'
import { decide, strategies, wantsBait } from '../server/game/bots.js'
import { calibrate, evaluate, leaderHolds, play, setup, sizes, winShares, type MatchHistory } from '../server/game/simulate.js'
// Nothing regrows and no hold fills up unless a test asks for it.
const quiet: CommonsConfig = { ...commonsConfig, growthTicks: 1e6, hold: 1e6 }
// A hand-made match: `rows` with '#' for land, the harbour at the top left.
function match(rows: string[], schools: Partial<School>[] = [], boats: Partial<Boat>[] = []): MatchState {
  return {
    seed: 1, tick: 0, map: { width: rows[0]!.length, height: rows.length, land: rows, harbour: { x: 0, y: 0 } }, nextId: 100,
    schools: schools.map((s, i) => ({ id: i + 1, x: 0, y: 0, fish: 20, golden: false, ...s })),
    boats: boats.map((b, i) => ({ team: String.fromCharCode(97 + i), x: 0, y: 0, target: null, fishing: null, hauling: 0, hold: 0, bait: false, spent: 0, research: 0, fish: 0, bonus: 0, ...b })),
  }
}
const run = (state: MatchState, config: CommonsConfig, ticks: number) => Array.from({ length: ticks }, () => step(state, config))
// Team A earns 5 Research a minute and gives an order every minute; team B earns nothing and never orders.
function rehearsal(): MatchHistory {
  const samples = [1, 2, 3, 4].map(minute => ({ tick: minute * 30, teams: [{ id: 'a', name: 'A', research: 10 + minute * 5 - minute * 2, spent: minute * 2 }, { id: 'b', name: 'B', research: 10, spent: 0 }] }))
  return { config: { tickSeconds: 2 }, samples, orders: [40, 70, 100].map(tick => ({ tick, team: 'a' })) }
}

test('regrowth is hump-shaped: slow when nearly empty, fastest in the middle, zero when full', () => {
  assert.deepEqual(Array.from({ length: 13 }, (_, b) => growth(b, 12, 3)), [1, 1, 2, 3, 3, 3, 3, 3, 3, 3, 2, 1, 0])
  assert.equal(growth(13, 12, 3), 0)
})

test('maps are reproducible, keep the harbour open and leave no sea cut off', () => {
  for (const seed of [1, 2, 3, 99, 2024]) {
    const state = newMatch(['x', 'y', 'z'], commonsConfig, seed), { map } = state
    assert.deepEqual(state, newMatch(['x', 'y', 'z'], commonsConfig, seed))
    assert.deepEqual([map.width, map.height, map.land.length], [commonsConfig.width, commonsConfig.height, commonsConfig.height])
    const reach = distances(map, map.harbour)
    let land = 0
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      if (!isSea(map, x, y)) land++
      else assert(reach[y * map.width + x]! >= 0, `${seed}: (${x}, ${y}) cut off`)
      if (Math.abs(x - map.harbour.x) <= 1 && Math.abs(y - map.harbour.y) <= 1) assert(isSea(map, x, y))
    }
    assert(land >= Math.round(commonsConfig.landShare * map.width * map.height))
    assert(state.boats.every(b => b.x === map.harbour.x && b.y === map.harbour.y && b.target === null && b.hold === 0 && !b.bait))
  }
})

test('fishing grounds: one per team plus the extras, full, spaced out, golden ones far out', () => {
  const golden = Math.ceil(8 / commonsConfig.goldenTeams)
  for (let seed = 1; seed <= 50; seed++) {
    const state = newMatch(Array.from({ length: 8 }, (_, i) => String(i)), commonsConfig, seed), { map, schools } = state
    assert.equal(schools.length, 8 + commonsConfig.extraSchools + golden)
    assert(schools.every(s => isSea(map, s.x, s.y) && Math.max(Math.abs(s.x - map.harbour.x), Math.abs(s.y - map.harbour.y)) > 1))
    assert(schools.every(s => s.fish === (s.golden ? commonsConfig.goldenMax : commonsConfig.schoolMax)))
    assert.equal(schools.filter(s => s.golden).length, golden)
    // No two grounds side by side, even diagonally.
    for (const a of schools) for (const b of schools) if (a !== b) assert(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) > 1, `${seed}: grounds ${a.id} and ${b.id} touch`)
    // The first golden ground is among the farthest sea from the harbour (it is placed before anything else).
    const home = (t: { x: number; y: number }) => distance(map, t, map.harbour), far = Math.max(...Array.from({ length: map.width * map.height }, (_, i) => ({ x: i % map.width, y: Math.floor(i / map.width) })).filter(t => isSea(map, t.x, t.y) && Math.max(Math.abs(t.x - map.harbour.x), Math.abs(t.y - map.harbour.y)) > 1).map(home))
    assert(home(schools[0]!) >= far - 2 && schools[0]!.golden)
  }
  // 20 teams still get every ground, packing them closer where the sea runs out of room.
  for (let seed = 1; seed <= 50; seed++) assert.equal(newMatch(Array.from({ length: 20 }, (_, i) => String(i)), commonsConfig, seed).schools.length, 20 + commonsConfig.extraSchools + 5)
})

test('boats sail the shortest route around islands, one tile a tick, burning fuel', () => {
  const state = match(['.....', '.###.', '.....'], [], [{ x: 2, y: 2, research: 4, target: { x: 2, y: 0 } }]), boat = state.boats[0]!
  // Both ways round are six tiles; every boat takes the first of N, E, S, W.
  assert.equal(distance(state.map, boat, { x: 2, y: 0 }), 6)
  assert.deepEqual(route(state.map, boat, { x: 2, y: 0 }), [{ x: 3, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 1 }, { x: 4, y: 0 }, { x: 3, y: 0 }, { x: 2, y: 0 }])
  assert.equal(distance(state.map, boat, { x: 2, y: 1 }), -1)
  const reports = run(state, quiet, 5)
  assert.deepEqual([boat.x, boat.y, boat.research, boat.spent], [4, 0, 0, 4])
  assert.deepEqual(reports.map(r => [r.moved, r.stalled]), [[['a'], []], [['a'], []], [['a'], []], [['a'], []], [[], ['a']]])
  // Refuelled, it arrives and then waits without stalling.
  boat.research = 5
  assert.deepEqual(run(state, quiet, 3).map(r => [r.moved, r.stalled]), [[['a'], []], [['a'], []], [[], []]])
  assert.deepEqual([boat.x, boat.y, boat.research], [2, 0, 3])
})

test('the fuller the ground, the faster the catch; an empty ground stays and regrows', () => {
  let state = match(['...'], [{ x: 2, y: 0, fish: 20 }], [{ x: 2, y: 0, target: { school: 1 } }])
  run(state, quiet, 4)
  assert.deepEqual([state.boats[0]!.fish, state.boats[0]!.hauling, state.schools[0]!.fish], [1, 0, 19])
  state = match(['...'], [{ x: 2, y: 0, fish: 10 }], [{ x: 2, y: 0, target: { school: 1 } }])
  run(state, quiet, 7)
  assert.equal(state.boats[0]!.fish, 0)
  run(state, quiet, 1)
  assert.equal(state.boats[0]!.fish, 1)
  state = match(['...'], [{ x: 2, y: 0, fish: 0 }], [{ x: 2, y: 0, target: { school: 1 } }])
  run(state, { ...quiet, growthTicks: 30 }, 29)
  assert.deepEqual([state.boats[0]!.fish, state.boats[0]!.hauling, state.schools.length], [0, 0, 1])
  run(state, { ...quiet, growthTicks: 30 }, 1)
  assert.equal(state.schools[0]!.fish, 1)
})

test('bait speeds the catch for 1 Research a fish, but never below the reserve', () => {
  let state = match(['...'], [{ x: 2, y: 0 }], [{ x: 2, y: 0, target: { school: 1 }, bait: true, research: 20 }])
  run(state, quiet, 3)
  const boat = state.boats[0]!
  assert.deepEqual([boat.fish, boat.hauling, boat.research, boat.spent], [1, 10, 19, 1])
  state = match(['...'], [{ x: 2, y: 0 }], [{ x: 2, y: 0, target: { school: 1 }, bait: true, research: 10 }])
  run(state, quiet, 3)
  assert.deepEqual([state.boats[0]!.fish, state.boats[0]!.hauling, state.boats[0]!.research], [0, 60, 10])
})

test('a full hold sails home to unload by itself, then back to its ground', () => {
  const config = { ...quiet, hold: 2, catchEffort: 1 }
  let state = match(['....'], [{ x: 2, y: 0 }], [{ x: 2, y: 0, research: 10, target: { school: 1 } }])
  run(state, config, 6)
  const boat = state.boats[0]!
  // Two fish, two tiles home, unload, two tiles back, then a catch on arrival.
  assert.deepEqual([boat.x, boat.hold, boat.research, boat.fish], [2, 1, 6, 3])
  state = match(['....'], [{ x: 2, y: 0 }], [{ x: 2, y: 0, research: 0, hold: 2, target: { school: 1 } }])
  const report = step(state, config)
  assert.deepEqual([report.stalled, state.boats[0]!.fish], [['a'], 0])
})

test('boats sharing a ground take turns at the last fish', () => {
  for (const [tick, winner] of [[0, 'b'], [1, 'a']] as const) {
    const state = match(['...', '...', '...'], [{ x: 2, y: 2, fish: 1 }], [{ x: 2, y: 2, hauling: 79, fishing: 1 }, { x: 2, y: 2, hauling: 79, fishing: 1 }])
    state.tick = tick
    assert.deepEqual(step(state, quiet).caught, { [winner]: 1 })
  }
})

test('golden grounds pay more per fish and regrow slowly up to a small maximum', () => {
  const config = { ...quiet, growthTicks: 10, catchEffort: 1 }
  const state = match(['...'], [{ x: 2, y: 0, fish: 2, golden: true }], [{ x: 2, y: 0, target: { school: 1 } }])
  run(state, config, 2)
  assert.deepEqual([state.boats[0]!.fish, state.boats[0]!.bonus, state.schools[0]!.fish], [0, 2 * config.goldenValue, 0])
  state.boats[0]!.target = { x: 0, y: 0 }
  state.boats[0]!.research = 10
  run(state, config, 8 + 10 * config.goldenMax)
  assert.equal(state.schools[0]!.fish, config.goldenMax)
})

test('ticks use no randomness, and the lookahead predicts them without changing the match', () => {
  const teams = ['a', 'b', 'c'], first = newMatch(teams, commonsConfig, 7), second = { ...structuredClone(first), seed: 12345 }
  for (const state of [first, second]) state.boats.forEach((b, i) => { b.research = 500; b.bait = i === 1; b.target = { school: state.schools[i]!.id } })
  run(first, commonsConfig, 200); run(second, commonsConfig, 200)
  assert.deepEqual({ ...first, seed: 0 }, { ...second, seed: 0 })
  const before = structuredClone(first), ahead = lookahead(first, commonsConfig, 3)
  assert.deepEqual(first, before)
  const real = structuredClone(first), tiles = new Map(teams.map(t => [t, [] as { x: number; y: number }[]]))
  for (let i = 0; i < 3; i++) { step(real, commonsConfig); for (const b of real.boats) tiles.get(b.team)!.push({ x: b.x, y: b.y }) }
  assert.deepEqual(ahead, tiles)
})

test('thoughtful bots weigh distance by what Research is worth to them, avoid crowds and bait when they can afford it', () => {
  const config = commonsConfig, view = (state: MatchState) => ({ state, me: state.boats[0]!, config, horizon: 150 })
  const far = () => match(['..........'], [{ x: 2, y: 0, fish: 10 }, { x: 9, y: 0, fish: 20 }], [{ research: 10 }])
  assert.deepEqual(decide(view(far()), { strategy: 'planner', income: 2, every: 2 }), { school: 1 })
  for (const income of [5, 9]) assert.deepEqual(decide(view(far()), { strategy: 'planner', income, every: 2 }), { school: 2 })
  const crowd = match(['...', '...', '...'], [{ x: 2, y: 0 }, { x: 0, y: 2, fish: 18 }], [{ research: 10 }, { x: 2, y: 0, target: { school: 1 } }, { x: 2, y: 0, target: { school: 1 } }])
  assert.deepEqual(decide(view(crowd), { strategy: 'planner', income: 5, every: 2 }), { school: 2 })
  const rich = match(['...'], [], [{ research: 30 }])
  assert.equal(wantsBait(view(rich), { strategy: 'planner', income: 5, every: 2 }), true)
  assert.equal(wantsBait(view(rich), { strategy: 'biggest', income: 5, every: 2 }), false)
  rich.boats[0]!.research = 29
  assert.equal(wantsBait(view(rich), { strategy: 'planner', income: 5, every: 2 }), false)
})

test('simulated matches are reproducible from their seed', () => {
  const bots = strategies.map(strategy => ({ strategy, income: 5, every: 2 }))
  const first = play(bots, commonsConfig, 7)
  assert.deepEqual(first, play(bots, commonsConfig, 7))
  assert.equal(first.standings.length, 60)
})

test('a rehearsal history calibrates Research income and attention', () => {
  const history = rehearsal(), { teams, assumptions } = calibrate(history, commonsConfig)
  assert.deepEqual(teams.map(t => [t.name, t.perMinute, t.ordersPerMinute]), [['A', 5, 1], ['B', 0, 0]])
  assert.deepEqual(assumptions.incomes, { weak: 1.25, average: 2.5, strong: 3.75 })
  assert(assumptions.every[0] < assumptions.every[1])
  assert.throws(() => calibrate({ ...history, samples: history.samples.slice(0, 2) }, commonsConfig), /at least three minutes/)
  assert.throws(() => calibrate({ ...history, samples: history.samples.map(s => ({ ...s, teams: [] })) }, commonsConfig), /no teams/)
})

test('the simulation applies every override to the calibration, in any order, and a one-team rehearsal only calibrates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'commons-history-')), pair = join(dir, 'pair.json'), solo = join(dir, 'solo.json'), history = rehearsal()
  writeFileSync(pair, JSON.stringify(history))
  writeFileSync(solo, JSON.stringify({ ...history, samples: history.samples.map(s => ({ ...s, teams: s.teams.slice(0, 1) })) }))
  try {
    const first = setup(['--history', pair, 'catchEffort=40', '40']), last = setup(['40', 'catchEffort=40', '--history', pair])
    assert.deepEqual(first, last)
    assert.deepEqual([first.config.catchEffort, first.runs, first.fieldSizes], [40, 40, [2, ...sizes]])
    assert.deepEqual(first.using, calibrate(history, { ...commonsConfig, catchEffort: 40 }).assumptions)
    // Faster catches change how often bots give orders, so calibrating before the override would differ.
    assert.notDeepEqual(first.using.every, setup(['--history', pair]).using.every)
    const one = setup(['--history', solo])
    assert.deepEqual([one.teams.map(t => [t.name, t.perMinute]), one.fieldSizes], [[['A', 5]], sizes])
    assert([...Object.values(one.using.incomes), ...one.using.every].every(Number.isFinite))
    assert.throws(() => setup(['--history']), /needs a match history/)
    assert.throws(() => setup(['speed=3']), /Unknown setting/)
    // An empty value is not 0, and a malformed one is not its first number.
    for (const arg of ['fuelCost=', 'fuelCost= ', 'fuelCost=5=9', 'fuelCost', 'fuelCost=five']) assert.throws(() => setup([arg]), /give fuelCost a single number/, arg)
    for (const seconds of [4000, 0, -2]) assert.throws(() => setup([`tickSeconds=${seconds}`]), /tickSeconds must be/)
    for (const arg of ['width=0', 'catchEffort=1.5', 'hold=0']) assert.throws(() => setup([arg]), /whole number/, arg)
  } finally { rmSync(dir, { recursive: true, force: true }) }
  // Called directly with a single team, experiments that need a field are skipped rather than NaN.
  const [alone] = evaluate(commonsConfig, 1, [1])
  assert.equal(alone!.invasion.size, 0)
  assert.equal(alone!.settling.mixed.n + alone!.settling.identical.n, 0)
  assert.equal(alone!.choices.has('first') || alone!.choices.has('strong biggest'), false)
  assert([alone!.research, alone!.attention, alone!.mixed, alone!.golden, alone!.herding, alone!.choices].every(m => [...m.values()].every(s => Number.isFinite(s.mean) && Number.isFinite(s.error))))
})

test('convergence metrics share tied places instead of favouring lower indexes', () => {
  assert.deepEqual(winShares([4, 7, 7, 1]), [0, 0.5, 0.5, 0])
  // Two teams level at halfway and one of them wins: a fair pick among the leaders holds half the time.
  assert.deepEqual([leaderHolds([5, 5, 1], [9, 8, 7]), leaderHolds([5, 5, 1], [8, 9, 7]), leaderHolds([5, 3, 1], [9, 9, 9]), leaderHolds([5, 3, 1], [8, 9, 7])], [0.5, 0.5, 1 / 3, 0])
})
