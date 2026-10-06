import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commonsConfig } from '../server/game/config.js'
import { availableContracts, groundIndex, groundName, growth, newBoats, newGrounds, resolve, type CommonsConfig, type MatchState, type TeamPlay } from '../server/game/rules.js'
import { calibrate, play, type MatchHistory } from '../server/game/simulate.js'
const config: CommonsConfig = { ...commonsConfig, fishingCost: 5, catchAmount: 2, maximumBiomass: 12, startingBiomass: 8, growthCap: 3, contractBonus: 8, groundCount: teams => teams + 2 }
const team = (id: string, research = 100, extra: Partial<TeamPlay> = {}): TeamPlay => ({ id, research, boats: newBoats(), fish: 0, bonus: 0, contract: null, completed: [], ...extra })
const match = (teams: TeamPlay[], biomass?: number[]): MatchState => ({ grounds: biomass ? biomass.map(b => ({ biomass: b, maximum: 12, fishedBy: [] })) : newGrounds(teams.length, config), teams })
const at = (ground: number) => ({ ground, order: ground })

test('regrowth is hump-shaped: slow when nearly empty, fastest in the middle, zero when full', () => {
  assert.deepEqual(Array.from({ length: 13 }, (_, b) => growth(b, 12, 3)), [1, 1, 2, 3, 3, 3, 3, 3, 3, 3, 2, 1, 0])
  assert.equal(growth(13, 12, 3), 0)
  assert.deepEqual(['A', 'B', 'Z', 'AA', 'AB'].map(groundIndex), [0, 1, 25, 26, 27])
  for (let i = 0; i < 60; i++) assert.equal(groundIndex(groundName(i)), i)
})

test('grounds scale only with team count and start equal', () => {
  // One per team up to 4 teams, one spare from 5, two from 15.
  assert.deepEqual([1, 2, 3, 4, 5, 6, 8, 12, 14, 15, 20].map(n => commonsConfig.groundCount(n)), [2, 2, 3, 4, 6, 7, 9, 13, 15, 17, 22])
  for (const teams of [3, 8, 20]) {
    const grounds = newGrounds(teams, commonsConfig)
    assert.equal(grounds.length, commonsConfig.groundCount(teams))
    assert(grounds.every(g => g.biomass === commonsConfig.startingBiomass && g.maximum === commonsConfig.maximumBiomass))
  }
})

test('leaving harbour or switching ground costs one resolution of travel; idling is free', () => {
  let state = match([team('a')])
  state.teams[0]!.boats[0]!.order = 1
  let step = resolve(state, config)
  assert.deepEqual(step.report.boats.map(b => [b.action, b.paid, b.caught]), [['travel', 0, 0], ['idle', 0, 0]])
  assert.equal(step.state.teams[0]!.boats[0]!.ground, 1)
  assert.equal(step.state.teams[0]!.research, 100)
  step = resolve(step.state, config)
  assert.deepEqual(step.report.boats[0], { team: 'a', boat: 1, from: 1, order: 1, action: 'fish', paid: 5, caught: 2 })
  assert.equal(step.state.teams[0]!.fish, 2)
  assert.equal(step.state.teams[0]!.research, 95)
  step.state.teams[0]!.boats[0]!.order = 2
  step = resolve(step.state, config)
  assert.equal(step.report.boats[0]!.action, 'travel')
  step.state.teams[0]!.boats[0]!.order = null
  step = resolve(step.state, config)
  assert.deepEqual([step.report.boats[0]!.action, step.state.teams[0]!.boats[0]!.ground], ['idle', 2])
  // Ordering the ground an idle boat is already on needs no travel.
  step.state.teams[0]!.boats[0]!.order = 2
  assert.equal(resolve(step.state, config).report.boats[0]!.action, 'fish')
})

test('Research pays boat 1 first; a boat that cannot pay does not fish', () => {
  const short = team('a', 7, { boats: [at(0), at(1)] }), broke = team('b', -5, { boats: [at(2), at(2)] })
  const { state, report } = resolve(match([short, broke]), config)
  assert.deepEqual(report.boats.map(b => b.action), ['fish', 'unpaid', 'unpaid', 'unpaid'])
  assert.deepEqual(report.teams.map(t => [t.paid, t.caught, t.research]), [[5, 2, 2], [0, 0, -5]])
  assert.equal(state.grounds[1]!.biomass, 11)
})

test('a short ground is split equally, rounded down, and the remainder stays', () => {
  const teams = ['a', 'b', 'c'].map(id => team(id, 100, { boats: [at(0), { ground: null, order: null }] }))
  let { state, report } = resolve(match(teams, [5, 8]), config)
  assert.deepEqual(report.boats.filter(b => b.action === 'fish').map(b => b.caught), [1, 1, 1])
  assert.deepEqual(report.grounds[0], { id: 0, before: 5, caught: 3, growth: 2, after: 4, boats: 3 })
  assert.deepEqual(state.grounds[0]!.fishedBy, ['a', 'b', 'c'])
  // Enough for everyone: each boat takes the full catch amount.
  ;({ state, report } = resolve(match(teams.map(t => ({ ...t, boats: [at(1), at(1)] })), [5, 12]), config))
  // An emptied ground still recovers by one.
  assert.deepEqual(report.grounds[1], { id: 1, before: 12, caught: 12, growth: 1, after: 1, boats: 6 })
  assert.equal(state.grounds[1]!.biomass, 1)
  assert.deepEqual(resolve(state, config).report.boats.filter(b => b.order === 1).map(b => b.caught), [0, 0, 0, 0, 0, 0])
})

test('resolution is pure and deterministic', () => {
  const state = match([team('a', 50, { boats: [at(0), at(1)] }), team('b', 50, { boats: [at(0), { ground: 0, order: 2 }] })])
  const copy = structuredClone(state)
  const first = resolve(state, config), second = resolve(state, config)
  assert.deepEqual(state, copy)
  assert.deepEqual(first, second)
})

test('contract counters use start-of-resolution conditions and pay the bonus once', () => {
  const contracts: CommonsConfig['contracts'] = [
    { id: 'rich', kind: 'catch', target: 4, minBiomass: 8 },
    { id: 'quiet', kind: 'catch', target: 4, quiet: true },
    { id: 'at-b', kind: 'catch', target: 2, ground: 'B', bonus: 3 },
    { id: 'survey', kind: 'variety', target: 2 },
    { id: 'far', kind: 'catch', target: 2, ground: 'Z' },
  ]
  const rules = { ...config, contracts }
  assert.deepEqual(availableContracts(rules, 4).map(c => c.id), ['rich', 'quiet', 'at-b', 'survey'])
  // A variety contract needs at least as many grounds as its target.
  assert.deepEqual(availableContracts(rules, 1).map(c => c.id), ['rich', 'quiet'])
  // Ground 0 starts with 9 (counts), ground 1 with 7 (does not, until it has regrown to 8).
  let state = match([team('a', 100, { boats: [at(0), at(1)], contract: { id: 'rich', progress: 0, visited: [] } })], [9, 7])
  let step = resolve(state, rules)
  assert.deepEqual(step.report.teams[0]!.contract, { id: 'rich', progress: 2, visited: [] })
  assert.equal(step.report.teams[0]!.completed, null)
  assert.deepEqual(step.state.grounds.map(g => g.biomass), [10, 8])
  step = resolve(step.state, rules)
  assert.deepEqual([step.report.teams[0]!.completed, step.state.teams[0]!.contract, step.state.teams[0]!.bonus], ['rich', null, 8])
  assert.deepEqual(step.state.teams[0]!.completed, ['rich'])
  // Quiet: grounds another team fished last resolution do not count; your own fishing does not spoil it.
  state = match([
    team('a', 100, { boats: [at(0), at(1)], contract: { id: 'quiet', progress: 0, visited: [] } }),
    team('b', 100, { boats: [at(1), { ground: null, order: null }] }),
  ], [12, 12])
  // Nobody fished anywhere before the first resolution, so both catches count.
  assert.equal(resolve(state, rules).report.teams[0]!.completed, 'quiet')
  state = { grounds: [{ biomass: 12, maximum: 12, fishedBy: ['a'] }, { biomass: 12, maximum: 12, fishedBy: ['b'] }], teams: [team('a', 100, { boats: [at(0), at(1)], contract: { id: 'quiet', progress: 0, visited: [] } })] }
  assert.equal(resolve(state, rules).report.teams[0]!.contract!.progress, 2)
  // Named ground with its own bonus, and the variety counter.
  state = match([team('a', 100, { boats: [at(1), at(0)], contract: { id: 'at-b', progress: 0, visited: [] } }), team('b', 100, { boats: [at(0), at(2)], contract: { id: 'survey', progress: 0, visited: [] } })], [12, 12, 12])
  step = resolve(state, rules)
  assert.deepEqual(step.report.teams.map(t => [t.completed, t.bonus]), [['at-b', 3], ['survey', 8]])
  // A team without an active contract makes no progress, and completed contracts stay completed.
  step = resolve(step.state, rules)
  assert.deepEqual(step.state.teams.map(t => [t.bonus, t.completed]), [[3, ['at-b']], [8, ['survey']]])
})

test('every configured contract uses a known building block and a unique ID', () => {
  const ids = commonsConfig.contracts.map(c => c.id)
  assert.equal(new Set(ids).size, ids.length)
  assert(ids.length >= 6 && ids.length <= 8)
  for (const c of commonsConfig.contracts) {
    assert(c.target > 0)
    assert(c.kind === 'variety' || c.kind === 'catch')
    if (c.kind === 'catch' && c.ground !== undefined) assert.match(c.ground, /^[A-Z]+$/)
  }
})

test('simulated matches are reproducible from their seed', () => {
  const bots = (['planner', 'greedy', 'spread', 'stay'] as const).map(strategy => ({ strategy, contracts: 'rational' as const, income: 5, attention: 0.7 }))
  assert.deepEqual(play(bots, commonsConfig, 7), play(bots, commonsConfig, 7))
})

test('a rehearsal history calibrates Research income and attention', () => {
  // Team A earns 15 Research per 3-minute interval, pays 5 a resolution and changes orders
  // before every resolution; team B earns nothing and never changes its orders.
  const history: MatchHistory = { config: { resolutionSeconds: 180, startingResearch: 0 }, resolutions: [] }
  let a = 0
  for (let n = 0; n < 4; n++) {
    a += 15
    history.resolutions.push({
      before: { teams: [{ id: 'a', name: 'A', research: a, boats: [{ order: n % 2 }, { order: null }], contract: null }, { id: 'b', name: 'B', research: 0, boats: [{ order: 0 }, { order: 0 }], contract: null }] },
      report: { teams: [{ id: 'a', research: a - 5 }, { id: 'b', research: 0 }] },
    })
    a -= 5
  }
  const { teams, assumptions } = calibrate(history, commonsConfig)
  assert.deepEqual(teams.map(t => [t.name, t.perMinute, t.changeRate]), [['A', 5, 1], ['B', 0, 0]])
  assert.deepEqual(assumptions.incomes, { weak: 1.25, average: 2.5, strong: 3.75 })
  assert(assumptions.attention[0] < assumptions.attention[1] && assumptions.attention[1] <= 1)
  assert.throws(() => calibrate({ ...history, resolutions: history.resolutions.slice(0, 2) }, commonsConfig), /at least three/)
})
