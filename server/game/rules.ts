// The Commons: pure, deterministic rules for the live map game. No database, HTTP
// or UI code, so the server, tests and simulation all run exactly the same ticks.
import type { BoatOrder, Tile } from '../../shared/domain.js'
export interface CommonsConfig {
  tickSeconds: number
  width: number
  height: number
  landShare: number
  fuelCost: number
  catchEffort: number
  hold: number
  extraSchools: number
  schoolMax: number
  growthTicks: number
  growthCap: number
  goldenTeams: number
  goldenMax: number
  goldenCap: number
  goldenValue: number
  baitBoost: number
  baitCost: number
  baitReserve: number
  startingResearch: number
}
// `land` rows use '#' for island and '.' for sea. Boats start in the harbour, a sea tile.
export interface GameMap { width: number; height: number; land: string[]; harbour: Tile }
// A school is a fixed fishing ground: it never moves or vanishes. Golden ones pay goldenValue a fish.
export interface School extends Tile { id: number; fish: number; golden: boolean }
// `hauling`: the catch meter on ground `fishing`. `hold`: fish aboard (when full, the boat
// sails home to unload). `bait`: the team's switch. `spent`: Research burnt on fuel and bait.
// `research`, `fish` and `bonus` are the team's.
export interface Boat extends Tile { team: string; target: BoatOrder | null; fishing: number | null; hauling: number; hold: number; bait: boolean; spent: number; research: number; fish: number; bonus: number }
export interface MatchState { seed: number; tick: number; map: GameMap; schools: School[]; nextId: number; boats: Boat[] }
// `stalled`: teams whose boat had somewhere to go but not the Research to sail.
export interface TickReport { tick: number; moved: string[]; stalled: string[]; caught: Record<string, number> }

// Deterministic randomness: the same seed always gives the same map.
export function rng(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

// Hump-shaped regrowth: slow when nearly empty, fastest in the middle, zero when full.
export function growth(fish: number, maximum: number, cap: number): number {
  return Math.max(0, Math.min(Math.max(fish, 1), maximum - fish, cap))
}
export const isSea = (map: GameMap, x: number, y: number) => x >= 0 && y >= 0 && x < map.width && y < map.height && map.land[y]![x] === '.'
const near = (a: Tile, b: Tile, r: number) => Math.abs(a.x - b.x) <= r && Math.abs(a.y - b.y) <= r
const steps = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const

// Small islands scattered at random, never next to the harbour, and no sea cut off from it.
export function makeMap(width: number, height: number, landShare: number, random: () => number): GameMap {
  const harbour = { x: Math.floor(width / 2), y: Math.floor(height / 2) }
  const land = Array.from({ length: height }, () => Array<boolean>(width).fill(false))
  const wanted = Math.round(width * height * landShare)
  for (let count = 0, tries = 0; count < wanted && tries < 500; tries++) {
    let x = Math.floor(random() * width), y = Math.floor(random() * height)
    for (let size = 1 + Math.floor(random() * 4); size > 0 && count < wanted; size--) {
      if (!land[y]![x] && !near({ x, y }, harbour, 1)) { land[y]![x] = true; count++ }
      const [dx, dy] = steps[Math.floor(random() * 4)]!
      x = Math.min(width - 1, Math.max(0, x + dx)); y = Math.min(height - 1, Math.max(0, y + dy))
    }
  }
  const map = { width, height, harbour, land: land.map(row => row.map(l => l ? '#' : '.').join('')) }
  const reached = distances(map, harbour)
  return { ...map, land: land.map((row, y) => row.map((_, x) => reached[y * width + x]! >= 0 ? '.' : '#').join('')) }
}

// Sailing distance from `from` to every tile (-1: land or unreachable), cached per map.
const cache = new WeakMap<GameMap, Map<number, Int16Array>>()
export function distances(map: GameMap, from: Tile): Int16Array {
  const key = from.y * map.width + from.x, known = cache.get(map) ?? cache.set(map, new Map()).get(map)!
  if (known.has(key)) return known.get(key)!
  const d = new Int16Array(map.width * map.height).fill(-1), queue = [key]
  if (isSea(map, from.x, from.y)) d[key] = 0; else queue.pop()
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i]!, x = at % map.width, y = Math.floor(at / map.width)
    for (const [dx, dy] of steps) {
      const n = (y + dy) * map.width + x + dx
      if (isSea(map, x + dx, y + dy) && d[n] === -1) { d[n] = d[at]! + 1; queue.push(n) }
    }
  }
  known.set(key, d)
  return d
}
export const distance = (map: GameMap, a: Tile, b: Tile) => distances(map, b)[a.y * map.width + a.x]!
// The next tile on a shortest route, always the first in N, E, S, W order, so every boat agrees.
export function nextTile(map: GameMap, from: Tile, to: Tile): Tile | null {
  const d = distances(map, to), here = d[from.y * map.width + from.x]!
  if (here <= 0) return null
  for (const [dx, dy] of steps) {
    const x = from.x + dx, y = from.y + dy
    if (isSea(map, x, y) && d[y * map.width + x] === here - 1) return { x, y }
  }
  return null
}
export function route(map: GameMap, from: Tile, to: Tile): Tile[] {
  const path: Tile[] = []
  for (let at = nextTile(map, from, to); at; at = nextTile(map, at, to)) path.push(at)
  return path
}

// Where a ground may go: sea away from the harbour and, at spacing `gap`, from other grounds.
const open = (state: MatchState, t: Tile, gap: number) => isSea(state.map, t.x, t.y) && !near(t, state.map.harbour, 1) && !state.schools.some(s => s.x === t.x && s.y === t.y || gap && near(s, t, gap))
// A free tile for a ground, kept a tile apart from the others while the sea has room.
// Golden grounds go among the tiles farthest from the harbour.
function freeSea(state: MatchState, random: () => number, far: boolean): Tile | null {
  let options: Tile[] = []
  for (const gap of [1, 0]) {
    for (let y = 0; y < state.map.height; y++) for (let x = 0; x < state.map.width; x++) if (open(state, { x, y }, gap)) options.push({ x, y })
    if (options.length) break
  }
  if (far) { const home = (t: Tile) => distance(state.map, t, state.map.harbour), top = Math.max(...options.map(home)); options = options.filter(t => home(t) >= top - 2) }
  return options.length ? options[Math.floor(random() * options.length)]! : null
}
// Where a boat is heading: home to unload when its hold is full, otherwise its order.
export function destination(state: MatchState, boat: Boat, config: CommonsConfig): Tile | null {
  if (boat.hold >= config.hold) return state.map.harbour
  if (!boat.target || !('school' in boat.target)) return boat.target
  const id = boat.target.school
  return state.schools.find(s => s.id === id) ?? null
}
function spawn(state: MatchState, random: () => number, golden: boolean, config: CommonsConfig) {
  const at = freeSea(state, random, golden)
  if (at) state.schools.push({ id: state.nextId++, ...at, fish: golden ? config.goldenMax : config.schoolMax, golden })
}

export function newMatch(teams: string[], config: CommonsConfig, seed: number): MatchState {
  const random = rng(seed), map = makeMap(config.width, config.height, config.landShare, random)
  const state: MatchState = { seed, tick: 0, map, schools: [], nextId: 1, boats: [] }
  for (let i = 0; i < Math.ceil(teams.length / config.goldenTeams); i++) spawn(state, random, true, config)
  for (let i = 0; i < teams.length + config.extraSchools; i++) spawn(state, random, false, config)
  state.boats = teams.map(team => newBoat(state, team))
  return state
}
export const newBoat = (state: MatchState, team: string): Boat => ({ team, ...state.map.harbour, target: null, fishing: null, hauling: 0, hold: 0, bait: false, spent: 0, research: 0, fish: 0, bonus: 0 })

// One tick, advancing `state` in place, with no randomness. Every boat sails one tile
// towards its destination, paying fuel, and unloads its hold in the harbour. A boat on
// a ground fills its catch meter by the ground's stock each tick (more with bait) and
// lands a fish whenever the meter reaches `catchEffort`, so fuller grounds fish faster.
// Then, every `growthTicks`, each ground regrows.
export function step(state: MatchState, config: CommonsConfig): TickReport {
  const tick = ++state.tick, report: TickReport = { tick, moved: [], stalled: [], caught: {} }
  for (const boat of state.boats) {
    const goal = destination(state, boat, config), next = goal && nextTile(state.map, boat, goal)
    if (next) {
      if (boat.research < config.fuelCost) { report.stalled.push(boat.team); continue }
      boat.research -= config.fuelCost; boat.spent += config.fuelCost; report.moved.push(boat.team)
      boat.x = next.x; boat.y = next.y
    }
    if (boat.x === state.map.harbour.x && boat.y === state.map.harbour.y) boat.hold = 0
  }
  // Boats sharing a ground take turns at the last fish: the order rotates every tick.
  const boats = state.boats, order = boats.map((_, i) => boats[(i + tick) % boats.length]!)
  for (const boat of order) {
    const school = boat.hold < config.hold ? state.schools.find(s => s.x === boat.x && s.y === boat.y && s.fish > 0) : undefined
    if (school?.id !== boat.fishing) { boat.fishing = school?.id ?? null; boat.hauling = 0 }
    if (!school) continue
    const baited = boat.bait && boat.research >= config.baitCost + config.baitReserve
    boat.hauling += school.fish * (baited ? config.baitBoost : 1)
    if (boat.hauling < config.catchEffort) continue
    boat.hauling -= config.catchEffort; school.fish--; boat.hold++
    if (baited) { boat.research -= config.baitCost; boat.spent += config.baitCost }
    report.caught[boat.team] = (report.caught[boat.team] ?? 0) + 1
    if (school.golden) boat.bonus += config.goldenValue
    else boat.fish++
  }
  if (tick % config.growthTicks === 0) for (const s of state.schools) s.fish += s.golden ? growth(s.fish, config.goldenMax, config.goldenCap) : growth(s.fish, config.schoolMax, config.growthCap)
  return report
}
// Each boat's tiles over the next `ticks` ticks if nobody gives an order or earns Research.
export function lookahead(state: MatchState, config: CommonsConfig, ticks: number): Map<string, Tile[]> {
  const future = structuredClone({ ...state, map: undefined }) as unknown as MatchState, tiles = new Map<string, Tile[]>()
  future.map = state.map // shares the cached sailing distances
  for (let i = 0; i < ticks; i++) { step(future, config); for (const b of future.boats) tiles.set(b.team, [...tiles.get(b.team) ?? [], { x: b.x, y: b.y }]) }
  return tiles
}
