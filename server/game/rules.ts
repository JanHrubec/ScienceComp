// The Commons: pure, deterministic rules for the live map game. No database, HTTP
// or UI code, so the server, tests and simulation all run exactly the same ticks.
export interface CommonsConfig {
  tickSeconds: number
  width: number
  height: number
  landShare: number
  fuelCost: number
  catchTicks: number
  extraSchools: number
  schoolStart: number
  schoolMax: number
  growthTicks: number
  growthCap: number
  driftTicks: number
  respawnTicks: number
  goldenEvery: number
  goldenTeams: number
  goldenFish: number
  goldenValue: number
  goldenTicks: number
  startingResearch: number
}
export interface Tile { x: number; y: number }
// `land` rows use '#' for island and '.' for sea. Boats start in the harbour, a sea tile.
export interface GameMap { width: number; height: number; land: string[]; harbour: Tile }
export interface School extends Tile { id: number; fish: number; golden: boolean; until: number | null }
// A boat is sent to a tile or to a school, which it then follows.
export type Order = Tile | { school: number }
// `hauling` counts the ticks a boat has spent on school `fishing` towards its next
// catch, `spent` the Research it has burnt so far. `research`, `fish` and `bonus` are the team's.
export interface Boat extends Tile { team: string; target: Order | null; fishing: number | null; hauling: number; spent: number; research: number; fish: number; bonus: number }
export interface MatchState { seed: number; tick: number; map: GameMap; schools: School[]; respawns: number[]; nextId: number; boats: Boat[] }
export interface GoldenEvent extends Tile { kind: 'appeared' | 'caught' | 'gone'; team?: string }
// `stalled`: teams whose boat had somewhere to go but not the Research to sail.
export interface TickReport { tick: number; moved: string[]; stalled: string[]; caught: Record<string, number>; events: GoldenEvent[] }

// Deterministic randomness: the same seed and tick always give the same numbers.
export function rng(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const tickRandom = (seed: number, tick: number) => rng((seed ^ Math.imul(tick + 1, 0x9e3779b1)) | 0)

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

// Where schools may be: sea away from the harbour, one school to a tile.
const open = (state: MatchState, t: Tile) => isSea(state.map, t.x, t.y) && !near(t, state.map.harbour, 1) && !state.schools.some(s => s.x === t.x && s.y === t.y)
function freeSea(state: MatchState, random: () => number): Tile | null {
  const options: Tile[] = []
  for (let y = 0; y < state.map.height; y++) for (let x = 0; x < state.map.width; x++) if (open(state, { x, y })) options.push({ x, y })
  return options.length ? options[Math.floor(random() * options.length)]! : null
}
// Where a boat is heading: a tile, or wherever the school it was sent to is now.
// A boat sent to a school that has gone stops where it is.
export function destination(state: MatchState, boat: Boat): Tile | null {
  if (!boat.target || !('school' in boat.target)) return boat.target
  const id = boat.target.school
  return state.schools.find(s => s.id === id) ?? (boat.target = null)
}
function spawn(state: MatchState, random: () => number, golden: boolean, config: CommonsConfig) {
  const at = freeSea(state, random)
  if (!at) return null
  const school = { id: state.nextId++, ...at, fish: golden ? config.goldenFish : config.schoolStart, golden, until: golden ? state.tick + config.goldenTicks : null }
  state.schools.push(school)
  return school
}

export function newMatch(teams: string[], config: CommonsConfig, seed: number): MatchState {
  const random = rng(seed), map = makeMap(config.width, config.height, config.landShare, random)
  const state: MatchState = { seed, tick: 0, map, schools: [], respawns: [], nextId: 1, boats: [] }
  for (let i = 0; i < teams.length + config.extraSchools; i++) spawn(state, random, false, config)
  state.boats = teams.map(team => newBoat(state, team))
  return state
}
export const newBoat = (state: MatchState, team: string): Boat => ({ team, ...state.map.harbour, target: null, fishing: null, hauling: 0, spent: 0, research: 0, fish: 0, bonus: 0 })

// One tick, advancing `state` in place. Schools drift now and then; every boat
// sails one tile towards its destination, paying fuel, so a boat sent to a school
// follows it. A boat that spends `catchTicks` ticks in a row on one school catches a
// fish. Emptied schools vanish and reappear elsewhere; schools regrow; every
// `goldenEvery` ticks golden schools appear, one per `goldenTeams` teams, each
// swimming off after `goldenTicks`.
export function step(state: MatchState, config: CommonsConfig): TickReport {
  const tick = ++state.tick, report: TickReport = { tick, moved: [], stalled: [], caught: {}, events: [] }, random = tickRandom(state.seed, tick)
  if (tick % config.driftTicks === 0) for (const school of state.schools) {
    const options = steps.map(([dx, dy]) => ({ x: school.x + dx, y: school.y + dy })).filter(t => open(state, t))
    if (options.length) Object.assign(school, options[Math.floor(random() * options.length)])
  }
  for (const boat of state.boats) {
    const goal = destination(state, boat), next = goal && nextTile(state.map, boat, goal)
    if (!next) continue
    if (boat.research < config.fuelCost) { report.stalled.push(boat.team); continue }
    boat.research -= config.fuelCost; boat.spent += config.fuelCost; report.moved.push(boat.team)
    boat.x = next.x; boat.y = next.y
  }
  // Boats sharing a school take turns at the last fish: the order rotates every tick.
  const boats = state.boats, order = boats.map((_, i) => boats[(i + tick) % boats.length]!)
  for (const boat of order) {
    const school = state.schools.find(s => s.x === boat.x && s.y === boat.y && s.fish > 0)
    if (school?.id !== boat.fishing) { boat.fishing = school?.id ?? null; boat.hauling = 0 }
    if (!school || ++boat.hauling < config.catchTicks) continue
    boat.hauling = 0; school.fish--
    report.caught[boat.team] = (report.caught[boat.team] ?? 0) + 1
    if (school.golden) { boat.bonus += config.goldenValue; report.events.push({ kind: 'caught', team: boat.team, x: school.x, y: school.y }) }
    else boat.fish++
  }
  state.schools = state.schools.filter(school => {
    if (school.golden && school.fish > 0 && tick >= school.until!) report.events.push({ kind: 'gone', x: school.x, y: school.y })
    else if (school.fish > 0) return true
    else if (!school.golden) state.respawns.push(tick + config.respawnTicks)
    return false
  })
  if (tick % config.growthTicks === 0) for (const school of state.schools) if (!school.golden) school.fish += growth(school.fish, config.schoolMax, config.growthCap)
  state.respawns = state.respawns.filter(at => at > tick || !spawn(state, random, false, config))
  if (tick % config.goldenEvery === 0) for (let n = state.schools.filter(s => s.golden).length; n < Math.ceil(state.boats.length / config.goldenTeams); n++) {
    const golden = spawn(state, random, true, config)
    if (golden) report.events.push({ kind: 'appeared', x: golden.x, y: golden.y })
  }
  return report
}
