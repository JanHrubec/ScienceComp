import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commonsConfig } from '../server/game/config.js'
import { distance, distances, growth, isSea, newMatch, route, step, type Boat, type CommonsConfig, type MatchState, type School } from '../server/game/rules.js'
import { decide } from '../server/game/bots.js'
import { calibrate, evaluate, leaderHolds, play, setup, sizes, winShares, type MatchHistory } from '../server/game/simulate.js'
// Nothing drifts, regrows or turns golden unless a test asks for it.
const quiet: CommonsConfig = { ...commonsConfig, catchTicks: 5, growthTicks: 1e6, driftTicks: 1e6, goldenEvery: 1e6, respawnTicks: 10, schoolStart: 8, schoolMax: 12, growthCap: 2, fuelCost: 1 }
// A hand-made match: `rows` with '#' for land, the harbour at the top left.
function match(rows: string[], schools: Partial<School>[] = [], boats: Partial<Boat>[] = []): MatchState {
  return {
    seed: 1, tick: 0, map: { width: rows[0]!.length, height: rows.length, land: rows, harbour: { x: 0, y: 0 } }, respawns: [], nextId: 100,
    schools: schools.map((s, i) => ({ id: i + 1, x: 0, y: 0, fish: 8, golden: false, until: null, ...s })),
    boats: boats.map((b, i) => ({ team: String.fromCharCode(97 + i), x: 0, y: 0, target: null, fishing: null, hauling: 0, spent: 0, research: 0, fish: 0, bonus: 0, ...b })),
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
    // One school per team plus the extras, each on its own open tile with the starting stock.
    assert.equal(state.schools.length, 3 + commonsConfig.extraSchools)
    assert.equal(new Set(state.schools.map(s => `${s.x},${s.y}`)).size, state.schools.length)
    assert(state.schools.every(s => isSea(map, s.x, s.y) && s.fish === commonsConfig.schoolStart && !s.golden))
    assert(state.boats.every(b => b.x === map.harbour.x && b.y === map.harbour.y && b.target === null))
  }
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

test('a boat on a school catches a fish every few ticks; schools regrow, and an emptied one appears elsewhere', () => {
  const state = match(['....', '....', '....'], [{ x: 3, y: 2, fish: 2 }, { x: 3, y: 0, fish: 5 }], [{ x: 3, y: 2, target: { school: 1 } }])
  const config = { ...quiet, growthTicks: 15 }, boat = state.boats[0]!
  run(state, config, 4)
  assert.deepEqual([boat.fish, boat.hauling, state.schools[0]!.fish], [0, 4, 2])
  run(state, config, 1)
  assert.deepEqual([boat.fish, boat.hauling, state.schools[0]!.fish], [1, 0, 1])
  run(state, config, 5)
  // Emptied at tick 10: it vanishes, the boat has nowhere to go, and a new school is due at tick 20.
  assert.deepEqual([boat.fish, state.schools.map(s => s.id), state.respawns], [2, [2], [20]])
  run(state, config, 1)
  assert.equal(boat.target, null)
  run(state, config, 4)
  assert.equal(state.schools[0]!.fish, 7) // regrew by 2 at tick 15
  run(state, config, 5)
  const fresh = state.schools.find(s => s.id === 100)!
  assert.deepEqual([fresh.fish, state.respawns], [8, []])
  // Away from the harbour and from the other school.
  assert(Math.max(Math.abs(fresh.x), Math.abs(fresh.y)) > 1 && !(fresh.x === 3 && fresh.y === 0))
})

test('a boat sent to a school follows it as it swims, while it can pay', () => {
  const state = match(['......', '......', '......', '......'], [{ x: 3, y: 2 }], [{ x: 3, y: 2, research: 3, target: { school: 1 } }])
  const config = { ...quiet, driftTicks: 1 }, boat = state.boats[0]!, school = state.schools[0]!
  const reports = run(state, config, 3)
  // The school moved every tick and the boat kept up, still hauling.
  assert(reports.every(r => r.moved[0] === 'a'))
  assert.deepEqual([boat.x, boat.y, boat.hauling, boat.research], [school.x, school.y, 3, 0])
  // Out of fuel, it is left behind and its haul starts over.
  assert.deepEqual(step(state, config).stalled, ['a'])
  assert.notDeepEqual([boat.x, boat.y], [school.x, school.y])
  assert.equal(boat.hauling, 0)
})

test('boats sharing a school take turns at the last fish', () => {
  for (const [tick, winner] of [[0, 'b'], [1, 'a']] as const) {
    const state = match(['...', '...', '...'], [{ x: 2, y: 2, fish: 1 }], [{ x: 2, y: 2, hauling: 4 }, { x: 2, y: 2, hauling: 4 }])
    state.tick = tick
    state.boats.forEach(b => { b.fishing = 1 })
    assert.deepEqual(step(state, quiet).caught, { [winner]: 1 })
  }
})

test('golden schools: one per four teams, worth more per fish, and they swim off', () => {
  const config: CommonsConfig = { ...quiet, goldenEvery: 3, goldenTeams: 4, goldenTicks: 4, goldenFish: 2, goldenValue: 4, catchTicks: 1 }
  const state = match(['......', '......', '......', '......'], [], Array.from({ length: 5 }, () => ({})))
  const reports = run(state, config, 3), golden = state.schools.filter(s => s.golden)
  assert.deepEqual(reports[2]!.events.map(e => e.kind), ['appeared', 'appeared'])
  assert(golden.length === 2 && golden.every(s => s.fish === 2 && s.until === 7))
  // A boat on one catches both fish for the bonus, not the catch; the other swims off at tick 7.
  Object.assign(state.boats[0]!, { x: golden[0]!.x, y: golden[0]!.y, target: { school: golden[0]!.id } })
  const later = run(state, config, 4)
  assert.deepEqual([state.boats[0]!.fish, state.boats[0]!.bonus], [0, 8])
  assert.deepEqual(later.flatMap(r => r.events.map(e => [r.tick, e.kind, e.team ?? null])), [[4, 'caught', 'a'], [5, 'caught', 'a'], [6, 'appeared', null], [7, 'gone', null]])
  // Only the golden school that appeared at tick 6 is left, and none respawn.
  assert.deepEqual([state.schools.filter(s => s.golden).length, state.respawns], [1, []])
})

test('thoughtful bots avoid a crowded school and never sail beyond their Research', () => {
  const crowded = { x: 2, y: 0, fish: 9 }, empty = { x: 0, y: 2, fish: 8 }
  const rivals = [{ x: 2, y: 0, target: { school: 1 } }, { x: 2, y: 0, target: { school: 1 } }]
  const state = match(['...', '...', '...'], [crowded, empty], [{ research: 10 }, ...rivals])
  const bot = { strategy: 'planner', income: 5, every: 2 } as const
  assert.deepEqual(decide({ state, me: state.boats[0]!, config: commonsConfig, horizon: 60 }, bot), { school: 2 })
  state.boats[0]!.research = 1
  assert.equal(decide({ state, me: state.boats[0]!, config: commonsConfig, horizon: 60 }, bot), null)
})

test('simulated matches are reproducible from their seed', () => {
  const bots = (['planner', 'nearest', 'biggest', 'golden', 'stay'] as const).map(strategy => ({ strategy, income: 5, every: 2 }))
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
    const first = setup(['--history', pair, 'catchTicks=3', '40']), last = setup(['40', 'catchTicks=3', '--history', pair])
    assert.deepEqual(first, last)
    assert.deepEqual([first.config.catchTicks, first.runs, first.fieldSizes], [3, 40, [2, ...sizes]])
    assert.deepEqual(first.using, calibrate(history, { ...commonsConfig, catchTicks: 3 }).assumptions)
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
    for (const arg of ['width=0', 'catchTicks=1.5', 'goldenEvery=0']) assert.throws(() => setup([arg]), /whole number/, arg)
  } finally { rmSync(dir, { recursive: true, force: true }) }
  // Called directly with a single team, experiments that need a field are skipped rather than NaN.
  const [alone] = evaluate(commonsConfig, 1, [1])
  assert.equal(alone!.invasion.size, 0)
  assert.equal(alone!.settling.mixed.n + alone!.settling.identical.n, 0)
  assert([alone!.research, alone!.attention, alone!.mixed, alone!.golden, alone!.herding].every(m => [...m.values()].every(s => Number.isFinite(s.mean) && Number.isFinite(s.error))))
})

test('convergence metrics share tied places instead of favouring lower indexes', () => {
  assert.deepEqual(winShares([4, 7, 7, 1]), [0, 0.5, 0.5, 0])
  // Two teams level at halfway and one of them wins: a fair pick among the leaders holds half the time.
  assert.deepEqual([leaderHolds([5, 5, 1], [9, 8, 7]), leaderHolds([5, 5, 1], [8, 9, 7]), leaderHolds([5, 3, 1], [9, 9, 9]), leaderHolds([5, 3, 1], [8, 9, 7])], [0.5, 0.5, 1 / 3, 0])
})
