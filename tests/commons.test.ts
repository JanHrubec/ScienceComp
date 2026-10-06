import { test } from 'node:test'
import assert from 'node:assert/strict'
import { availableContracts, createGrounds, groundName, growth, resolve, type CommonsMatch, type CommonsRules, type CommonsTeam } from '../shared/commons.js'
import { commonsRules } from '../server/game/commons-config.js'
const rules: CommonsRules = { ...commonsRules, contracts: [
  { id: 'rich', counter: 'catch', target: 4, condition: { minBiomass: 8 } },
  { id: 'quiet', counter: 'catch', target: 4, condition: { quiet: true } },
  { id: 'variety', counter: 'variety', target: 2 },
  { id: 'at-b', counter: 'catch', target: 3, condition: { ground: 'B' }, bonus: 11 },
  { id: 'at-z', counter: 'catch', target: 3, condition: { ground: 'Z' } },
] }
const team = (id: string, research: number, boats: [string | null, string | null][], extra: Partial<CommonsTeam> = {}): CommonsTeam =>
  ({ id, research, fish: 0, bonus: 0, boats: boats.map(([location, order]) => ({ location, order })), contract: null, completed: [], ...extra })
const ground = (id: string, biomass: number, lastFishedBy: string[] = []) => ({ id, biomass, max: 12, lastFishedBy })

test('regrowth is hump-shaped: slow when empty, fastest in the middle, zero when full', () => {
  assert.deepEqual(Array.from({ length: 13 }, (_, b) => growth(b, 12, 3)), [1, 1, 2, 3, 3, 3, 3, 3, 3, 3, 2, 1, 0])
  assert.deepEqual([groundName(0), groundName(25), groundName(26), groundName(27)], ['A', 'Z', 'AA', 'AB'])
  const grounds = createGrounds(3, commonsRules)
  assert.deepEqual(grounds.map(g => [g.id, g.biomass, g.max]), [['A', 8, 12], ['B', 8, 12], ['C', 8, 12], ['D', 8, 12], ['E', 8, 12]])
  assert.deepEqual(availableContracts(rules, grounds).map(c => c.id), ['rich', 'quiet', 'variety', 'at-b'])
})

test('changing ground costs one resolution of travel; fishing then costs Research per boat', () => {
  let match: CommonsMatch = { grounds: [ground('A', 8), ground('B', 8)], teams: [team('t', 5, [[null, 'A'], [null, null]])] }
  let step = resolve(match, rules)
  assert.deepEqual(step.record.teams[0].boats.map(b => b.action), ['travel', 'idle'])
  assert.equal(step.record.teams[0].paid, 0)
  assert.deepEqual(step.match.teams[0].boats, [{ location: 'A', order: 'A' }, { location: null, order: null }])
  assert.equal(step.match.grounds[0].biomass, 11)
  step = resolve(step.match, rules)
  assert.deepEqual(step.record.teams[0].boats.map(b => [b.action, b.caught]), [['fish', 2], ['idle', 0]])
  assert.deepEqual([step.match.teams[0].research, step.match.teams[0].fish], [4, 2])
  assert.deepEqual(step.record.grounds[0], { id: 'A', before: 11, caught: 2, growth: 3, after: 12, fishedBy: ['t'] })
  // Switching away travels again, without paying, and lands at the new ground.
  match = { ...step.match, teams: [{ ...step.match.teams[0], boats: [{ location: 'A', order: 'B' }, { location: null, order: null }] }] }
  step = resolve(match, rules)
  assert.deepEqual([step.record.teams[0].boats[0].action, step.record.teams[0].paid, step.match.teams[0].boats[0].location], ['travel', 0, 'B'])
})

test('boat 1 is paid first; an unpaid boat does not fish', () => {
  const step = resolve({ grounds: [ground('A', 8)], teams: [team('t', 1.5, [['A', 'A'], ['A', 'A']])] }, rules)
  assert.deepEqual(step.record.teams[0].boats.map(b => b.action), ['fish', 'unpaid'])
  assert.deepEqual([step.match.teams[0].research, step.match.teams[0].fish, step.record.grounds[0].caught], [0.5, 2, 2])
  const broke = resolve({ grounds: [ground('A', 8)], teams: [team('t', -10, [['A', 'A'], ['A', null]])] }, rules)
  assert.deepEqual(broke.record.teams[0].boats.map(b => b.action), ['unpaid', 'idle'])
  assert.equal(broke.match.teams[0].research, -10)
})

test('a short ground is split equally, rounded down, and the remainder stays', () => {
  const step = resolve({ grounds: [ground('A', 5)], teams: [team('x', 9, [['A', 'A'], ['A', 'A']]), team('y', 9, [['A', 'A'], [null, null]])] }, rules)
  assert.deepEqual(step.record.teams.map(t => t.caught), [2, 1])
  // 5 fish for 3 boats: one each, 2 remain, then +2 regrowth.
  assert.deepEqual(step.record.grounds[0], { id: 'A', before: 5, caught: 3, growth: 2, after: 4, fishedBy: ['x', 'x', 'y'] })
  const empty = resolve({ grounds: [ground('A', 1)], teams: [team('x', 9, [['A', 'A']]), team('y', 9, [['A', 'A']])] }, rules)
  assert.deepEqual(empty.record.teams.map(t => [t.caught, t.paid]), [[0, 1], [0, 1]])
  assert.equal(empty.match.grounds[0].biomass, 2)
})

test('contracts count only qualifying catches, complete once and pay their bonus', () => {
  const contract = (id: string) => ({ contract: { id, progress: 0, grounds: [] } })
  let match: CommonsMatch = {
    grounds: [ground('A', 9), ground('B', 7, ['y']), ground('C', 9, ['x'])],
    teams: [team('x', 50, [['A', 'A'], ['B', 'B']], contract('rich')), team('y', 50, [['C', 'C']], contract('quiet')), team('z', 50, [['B', 'B']], contract('at-b'))],
  }
  let step = resolve(match, rules)
  // x: only ground A started with at least 8. y: x fished C last time. z: at B.
  assert.deepEqual(step.record.teams.map(t => t.contract), [
    { id: 'rich', progress: 2, target: 4, completed: false },
    { id: 'quiet', progress: 0, target: 4, completed: false },
    { id: 'at-b', progress: 2, target: 3, completed: false },
  ])
  step = resolve(step.match, rules)
  assert.deepEqual(step.record.teams.map(t => t.contract?.progress), [4, 2, 3])
  assert.deepEqual(step.match.teams.map(t => [t.bonus, t.contract, t.completed]), [[commonsRules.contractBonus, null, ['rich']], [0, { id: 'quiet', progress: 2, grounds: [] }, []], [11, null, ['at-b']]])
  assert.deepEqual(step.match.teams.map(t => t.fish), [8, 4, 4])
  // A team's own boats never spoil "quiet" water; variety needs a catch at each ground.
  match = { grounds: [ground('A', 8, ['v']), ground('B', 0)], teams: [team('v', 9, [['A', 'A'], ['B', 'B']], contract('variety'))] }
  step = resolve(match, rules)
  assert.deepEqual([step.record.teams[0].contract, step.match.teams[0].contract?.grounds], [{ id: 'variety', progress: 1, target: 2, completed: false }, ['A']])
})

test('resolution is deterministic and independent of team order', () => {
  const match: CommonsMatch = { grounds: [ground('A', 5), ground('B', 9, ['p'])], teams: [team('p', 3, [['A', 'A'], ['B', 'A']]), team('q', 1, [['A', 'A'], ['A', 'A']]), team('r', 4, [['B', 'B'], [null, 'B']])] }
  const once = resolve(match, rules), twice = resolve(structuredClone(match), rules)
  assert.deepEqual(once, twice)
  const reversed = resolve({ ...match, teams: [...match.teams].reverse() }, rules)
  assert.deepEqual([...reversed.record.teams].reverse(), once.record.teams)
  assert.deepEqual(reversed.match.grounds.map(g => [g.biomass, [...g.lastFishedBy].sort()]), once.match.grounds.map(g => [g.biomass, [...g.lastFishedBy].sort()]))
  assert.deepEqual(match.teams[0].boats[1], { location: 'B', order: 'A' }, 'input is not mutated')
})

test('shipped configuration offers 6–8 distinct contracts on the grounds of a 1-team match', () => {
  const ids = commonsRules.contracts.map(c => c.id)
  assert(ids.length >= 6 && ids.length <= 8)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(availableContracts(commonsRules, createGrounds(1, commonsRules)).length, ids.length)
  assert(commonsRules.contracts.every(c => c.target > 0))
})
