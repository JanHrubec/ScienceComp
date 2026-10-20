// Invariant: every drawn point lies on a segment between neighbouring sea tiles, so a boat never crosses land.
import type { Tile } from '../shared/domain'
const same = (a?: Tile, b?: Tile) => !!a && !!b && a.x === b.x && a.y === b.y
export function along(path: Tile[], u: number): Tile {
  const i = Math.min(Math.max(Math.floor(u), 0), path.length - 1), a = path[i]!, b = path[Math.min(i + 1, path.length - 1)]!, f = Math.min(Math.max(u - i, 0), 1)
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
}
export function partway(points: Tile[], k: number): Tile {
  const legs = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y))
  let left = k * legs.reduce((a, b) => a + b, 0)
  for (const [i, leg] of legs.entries()) { if (left <= leg && leg > 0) return along([points[i]!, points[i + 1]!], left / leg); left -= leg }
  return points.at(-1)!
}
// From where `old` is drawn back to the last tile both paths share, then out along `next`; null when they cannot be joined.
export function detour(old: Tile[], u: number, next: Tile[], v: number, gap: number): Tile[] | null {
  const at = Math.min(Math.max(Math.floor(u), 0), old.length - 1)
  let m = 0
  while (gap + m <= Math.max(gap, at) && same(old[gap + m], next[m])) m++
  if (!m && !(gap === 1 && Math.abs(old[0]!.x - next[0]!.x) + Math.abs(old[0]!.y - next[0]!.y) <= 1)) return null
  const turn = m ? gap + m - 1 : 0
  return [along(old, u), ...(turn <= at ? old.slice(turn, at + 1).reverse() : old.slice(at + 1, turn + 1)), ...next.slice(m ? m - 1 : 0, Math.max(0, Math.floor(v)) + 1), along(next, v)]
}
