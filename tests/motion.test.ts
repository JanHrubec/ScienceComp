import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commonsConfig as config } from '../server/game/config.js'
import { isSea, lookahead, newMatch, rng, step, type MatchState } from '../server/game/rules.js'
import { along, detour, partway } from '../src/motion.js'
import type { Tile } from '../shared/domain.js'
const tile = (x: number, y: number): Tile => ({ x, y })
const gap = (a: Tile, b: Tile) => Math.hypot(a.x - b.x, a.y - b.y)

test('along clamps to the path and finds points between tiles', () => {
  const path = [tile(0, 0), tile(1, 0), tile(1, 1)]
  assert.deepEqual(along(path, -2), tile(0, 0))
  assert.deepEqual(along(path, 0.5), tile(0.5, 0))
  assert.deepEqual(along(path, 1.5), tile(1, 0.5))
  assert.deepEqual(along(path, 9), tile(1, 1))
  assert.deepEqual(partway([tile(0, 0), tile(2, 0), tile(2, 2)], 0.75), tile(2, 1))
})

test('a reversal is drawn back to the shared tile, then out along the new path', () => {
  assert.deepEqual(detour([tile(5, 5), tile(6, 5), tile(7, 5)], 0.6, [tile(5, 5), tile(4, 5), tile(3, 5)], 0.8, 0), [tile(5.6, 5), tile(5, 5), tile(5, 5), tile(4.2, 5)])
  // Two ticks later and on another course, the paths share no tile: the boat jumps.
  assert.equal(detour([tile(5, 5), tile(6, 5), tile(7, 5), tile(8, 5)], 2.2, [tile(5, 7), tile(5, 8), tile(5, 9), tile(5, 10)], 0.2, 2), null)
})

// Real matches: every drawn point stays on water, and a right guess is never redrawn backwards by more than a tile.
test('boats drawn between snapshots never cross land', () => {
  const onSea = (s: MatchState, p: Tile) => {
    const whole = (v: number) => Math.abs(v - Math.round(v)) < 1e-9
    if (whole(p.x)) return isSea(s.map, Math.round(p.x), Math.floor(p.y + 1e-9)) && isSea(s.map, Math.round(p.x), Math.ceil(p.y - 1e-9))
    if (whole(p.y)) return isSea(s.map, Math.floor(p.x + 1e-9), Math.round(p.y)) && isSea(s.map, Math.ceil(p.x - 1e-9), Math.round(p.y))
    return false
  }
  const paths = (s: MatchState) => { const ahead = lookahead(s, config, 3); return new Map(s.boats.map(b => [b.team, [tile(b.x, b.y), ...ahead.get(b.team)!]])) }
  let fixes = 0
  for (let seed = 1; seed <= 50; seed++) {
    const r = rng(seed), s = newMatch(['a', 'b', 'c', 'd'], config, seed), ground = () => ({ school: s.schools[Math.floor(r() * s.schools.length)]!.id })
    for (const b of s.boats) { b.research = 1000; b.target = ground(); b.bait = r() < 0.5 }
    for (let n = 0; n < 20; n++) {
      const old = paths(s), oldTick = s.tick, ticks = Math.floor(r() * 4), change = r() < 0.4, when = Math.floor(r() * (ticks + 1)), who = s.boats[Math.floor(r() * 4)]!
      for (let g = 0; g <= ticks; g++) { if (change && g === when) who.target = r() < 0.2 ? null : ground(); if (g < ticks) step(s, config) }
      const next = paths(s), tau = s.tick - 0.3 + r() * 1.3
      for (const b of s.boats) {
        const before = old.get(b.team)!, after = next.get(b.team)!, u = tau - oldTick, v = tau + 0.2 - s.tick, Q = along(before, u), end = along(after, v)
        if (gap(Q, along(after, tau - s.tick)) <= 0.05) continue
        const via = detour(before, u, after, v, ticks), where = { seed, n, team: b.team, ticks, change }
        if (!via) { assert.ok(ticks >= 2 && change, `only a late course change may jump: ${JSON.stringify(where)}`); continue }
        fixes++
        for (let k = 0; k <= 100; k++) assert.ok(onSea(s, partway(via, k / 100)), `crosses land: ${JSON.stringify(where)}`)
        assert.deepEqual(via[0], Q); assert.ok(gap(via.at(-1)!, end) < 1e-9)
        const length = via.slice(1).reduce((sum, p, i) => sum + gap(p, via[i]!), 0)
        if (!change) assert.ok(length <= gap(Q, end) + 1.01, `backtracks: ${JSON.stringify(where)}`)
      }
    }
  }
  assert.ok(fixes > 100)
})
