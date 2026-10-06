// The Commons: pure, deterministic rules. No database, HTTP or UI code, so the
// server, tests and simulation all run exactly the same resolution.
import type { BoatReport, ContractDefinition } from '../../shared/domain.js'

export interface CommonsConfig {
  resolutionSeconds: number
  fishingCost: number
  catchAmount: number
  maximumBiomass: number
  startingBiomass: number
  growthCap: number
  groundCount: (teams: number) => number
  startingResearch: number
  contractBonus: number
  contracts: ContractDefinition[]
}
export interface Ground { biomass: number; maximum: number; fishedBy: string[] }
export interface Boat { ground: number | null; order: number | null }
export interface ActiveContract { id: string; progress: number; visited: number[] }
export interface TeamPlay { id: string; research: number; boats: Boat[]; fish: number; bonus: number; contract: ActiveContract | null; completed: string[] }
export interface MatchState { grounds: Ground[]; teams: TeamPlay[] }
export interface TeamReport { id: string; paid: number; caught: number; contract: ActiveContract | null; completed: string | null; fish: number; bonus: number; research: number }
export interface ResolutionReport {
  grounds: { id: number; before: number; caught: number; growth: number; after: number; boats: number }[]
  boats: (BoatReport & { team: string })[]
  teams: TeamReport[]
}

export const BOATS_PER_TEAM = 2
export const groundName = (index: number): string => (index >= 26 ? groundName(Math.floor(index / 26) - 1) : '') + String.fromCharCode(65 + index % 26)
export const groundIndex = (name: string): number => [...name].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1

// Hump-shaped regrowth: slow when nearly empty, fastest in the middle, zero when full.
export function growth(biomass: number, maximum: number, cap: number): number {
  return Math.max(0, Math.min(Math.max(biomass, 1), maximum - biomass, cap))
}
export function newGrounds(teams: number, config: CommonsConfig): Ground[] {
  return Array.from({ length: Math.max(1, config.groundCount(teams)) }, () => ({ biomass: config.startingBiomass, maximum: config.maximumBiomass, fishedBy: [] }))
}
export const newBoats = (): Boat[] => Array.from({ length: BOATS_PER_TEAM }, () => ({ ground: null, order: null }))
export const contractBonus = (contract: ContractDefinition, config: CommonsConfig) => contract.bonus ?? config.contractBonus
// A contract naming a ground that this match does not have is not offered.
export const availableContracts = (config: CommonsConfig, grounds: number) =>
  config.contracts.filter(c => c.kind !== 'catch' || c.ground === undefined || groundIndex(c.ground) < grounds)

function counts(contract: ContractDefinition, ground: number, start: Ground, team: string) {
  if (contract.kind !== 'catch') return false
  if (contract.ground !== undefined && groundIndex(contract.ground) !== ground) return false
  if (contract.minBiomass !== undefined && start.biomass < contract.minBiomass) return false
  if (contract.quiet && start.fishedBy.some(id => id !== team)) return false
  return true
}

// One simultaneous resolution. Orders are whatever the state holds at this moment.
export function resolve(state: MatchState, config: CommonsConfig): { state: MatchState; report: ResolutionReport } {
  const start = state.grounds
  const grounds = start.map(g => ({ ...g, fishedBy: [] as string[] }))
  const teams = state.teams.map(t => ({ ...t, boats: t.boats.map(b => ({ ...b })), contract: t.contract && { ...t.contract, visited: [...t.contract.visited] }, completed: [...t.completed] }))
  const boats: ResolutionReport['boats'] = []
  const paid = new Map<string, number>()

  // 1–2. Move or pay. Boat 1 is paid before boat 2; travelling and idling are free.
  for (const team of teams) {
    paid.set(team.id, 0)
    team.boats.forEach((boat, index) => {
      const from = boat.ground, order = boat.order
      let action: BoatReport['action'], cost = 0
      if (order === null || order >= grounds.length) action = 'idle'
      else if (order !== boat.ground) { action = 'travel'; boat.ground = order }
      else if (team.research >= config.fishingCost) { action = 'fish'; cost = config.fishingCost; team.research -= cost; paid.set(team.id, paid.get(team.id)! + cost) }
      else action = 'unpaid'
      boats.push({ team: team.id, boat: index + 1, from, order, action, paid: cost, caught: 0 })
    })
  }
  // Each fishing boat takes up to the catch amount. A ground that cannot supply
  // everyone is split equally, rounded down; the remainder stays in the water.
  const groundReports = grounds.map((ground, id) => {
    const fishing = boats.filter(b => b.action === 'fish' && b.order === id)
    const each = ground.biomass >= fishing.length * config.catchAmount ? config.catchAmount : Math.floor(ground.biomass / fishing.length)
    for (const boat of fishing) { boat.caught = each; if (!ground.fishedBy.includes(boat.team)) ground.fishedBy.push(boat.team) }
    const before = ground.biomass, caught = each * fishing.length
    ground.biomass -= caught
    return { id, before, caught, growth: 0, after: 0, boats: fishing.length }
  })

  // 3. Contract progress, then completion bonus (once per team per contract).
  const definitions = new Map(config.contracts.map(c => [c.id, c]))
  const reports: TeamReport[] = teams.map(team => {
    const own = boats.filter(b => b.team === team.id && b.action === 'fish')
    const caught = own.reduce((sum, b) => sum + b.caught, 0)
    team.fish += caught
    let completed: string | null = null
    const contract = team.contract, definition = contract && definitions.get(contract.id)
    if (contract && definition) {
      for (const boat of own) {
        if (definition.kind === 'variety') { if (!contract.visited.includes(boat.order!)) contract.visited.push(boat.order!) }
        else if (counts(definition, boat.order!, start[boat.order!]!, team.id)) contract.progress += boat.caught
      }
      if (definition.kind === 'variety') contract.progress = contract.visited.length
      if (contract.progress >= definition.target) {
        completed = contract.id; team.completed.push(contract.id); team.bonus += contractBonus(definition, config); team.contract = null
      }
    }
    return { id: team.id, paid: paid.get(team.id)!, caught, contract: team.contract && { ...team.contract, visited: [...team.contract.visited] }, completed, fish: team.fish, bonus: team.bonus, research: team.research }
  })

  // 4. Every ground regrows from what is left.
  grounds.forEach((ground, id) => {
    const g = growth(ground.biomass, ground.maximum, config.growthCap)
    ground.biomass += g
    groundReports[id]!.growth = g; groundReports[id]!.after = ground.biomass
  })
  return { state: { grounds, teams }, report: { grounds: groundReports, boats, teams: reports } }
}
