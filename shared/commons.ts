// The Commons: pure fishing rules shared by the server, the simulation and the
// browser. No database or UI code belongs here, so a match can be replayed or
// simulated from plain data. Balancing values live in server/game/commons-config.ts.
export const BOATS_PER_TEAM = 2

export type CatchCondition = { ground: string } | { minBiomass: number } | { quiet: true }
export type ContractDefinition =
  | { id: string; counter: 'catch'; target: number; condition?: CatchCondition; bonus?: number }
  | { id: string; counter: 'variety'; target: number; bonus?: number }
export interface CommonsRules {
  resolutionSeconds: number
  fishingCost: number
  catchAmount: number
  maxBiomass: number
  startingBiomass: number
  growthCap: number
  startingResearch: number
  contractBonus: number
  groundCount: (teams: number) => number
  contracts: ContractDefinition[]
}

export interface Boat { location: string | null; order: string | null }
export interface Ground { id: string; biomass: number; max: number; lastFishedBy: string[] }
export interface ActiveContract { id: string; progress: number; grounds: string[] }
export interface CommonsTeam { id: string; research: number; fish: number; bonus: number; boats: Boat[]; contract: ActiveContract | null; completed: string[] }
export interface CommonsMatch { grounds: Ground[]; teams: CommonsTeam[] }

export type BoatAction = 'idle' | 'travel' | 'fish' | 'unpaid'
export interface BoatRecord { from: string | null; order: string | null; to: string | null; action: BoatAction; caught: number }
export interface TeamRecord {
  id: string; boats: BoatRecord[]; paid: number; caught: number; research: number; fish: number; bonus: number
  contract: { id: string; progress: number; target: number; completed: boolean } | null
}
export interface GroundRecord { id: string; before: number; caught: number; growth: number; after: number; fishedBy: string[] }
export interface ResolutionRecord { grounds: GroundRecord[]; teams: TeamRecord[] }

export const groundName = (index: number): string => (index >= 26 ? groundName(Math.floor(index / 26) - 1) : '') + String.fromCharCode(65 + index % 26)
export const growth = (biomass: number, max: number, cap: number) => Math.max(0, Math.min(Math.max(biomass, 1), max - biomass, cap))
export const bonusFor = (contract: ContractDefinition, rules: Pick<CommonsRules, 'contractBonus'>) => contract.bonus ?? rules.contractBonus
export function createGrounds(teamCount: number, rules: CommonsRules): Ground[] {
  return Array.from({ length: Math.max(1, rules.groundCount(teamCount)) }, (_, index) => ({ id: groundName(index), biomass: rules.startingBiomass, max: rules.maxBiomass, lastFishedBy: [] }))
}
// A contract naming a ground that this match does not have is not offered.
export function availableContracts(rules: CommonsRules, grounds: { id: string }[]) {
  return rules.contracts.filter(c => c.counter !== 'catch' || !c.condition || !('ground' in c.condition) || grounds.some(g => g.id === (c.condition as { ground: string }).ground))
}
function qualifies(condition: CatchCondition | undefined, ground: Ground, teamId: string) {
  if (!condition) return true
  if ('ground' in condition) return ground.id === condition.ground
  if ('minBiomass' in condition) return ground.biomass >= condition.minBiomass
  return ground.lastFishedBy.every(id => id === teamId)
}

// One simultaneous resolution. Orders are read as given; the result is a new
// match state plus a record that is enough to replay this step.
export function resolve(match: CommonsMatch, rules: CommonsRules): { match: CommonsMatch; record: ResolutionRecord } {
  const start = new Map(match.grounds.map(g => [g.id, g]))
  // Boats change ground, idle, or pay to fish. Boat 1 is paid first.
  const plans = match.teams.map(team => {
    let research = team.research
    const boats = team.boats.map((boat): BoatRecord => {
      const order = boat.order !== null && start.has(boat.order) ? boat.order : null
      const base = { from: boat.location, order, caught: 0 }
      if (order === null) return { ...base, to: boat.location, action: 'idle' }
      if (order !== boat.location) return { ...base, to: order, action: 'travel' }
      if (research < rules.fishingCost) return { ...base, to: order, action: 'unpaid' }
      research -= rules.fishingCost
      return { ...base, to: order, action: 'fish' }
    })
    return { team, research, boats }
  })
  // Each boat takes up to the catch amount; a short ground is split equally,
  // rounded down, and the remainder stays in the water.
  const fishedBy = new Map<string, string[]>(match.grounds.map(g => [g.id, []]))
  for (const plan of plans) for (const boat of plan.boats) if (boat.action === 'fish') fishedBy.get(boat.to!)!.push(plan.team.id)
  const perBoat = new Map(match.grounds.map(g => {
    const boats = fishedBy.get(g.id)!.length
    return [g.id, boats ? Math.min(rules.catchAmount, Math.floor(g.biomass / boats)) : 0]
  }))
  for (const plan of plans) for (const boat of plan.boats) if (boat.action === 'fish') boat.caught = perBoat.get(boat.to!)!
  const groundRecords = match.grounds.map((g): GroundRecord => {
    const caught = perBoat.get(g.id)! * fishedBy.get(g.id)!.length, left = g.biomass - caught, grown = growth(left, g.max, rules.growthCap)
    return { id: g.id, before: g.biomass, caught, growth: grown, after: left + grown, fishedBy: fishedBy.get(g.id)! }
  })
  const teams: CommonsTeam[] = [], teamRecords: TeamRecord[] = []
  for (const { team, research, boats } of plans) {
    const caught = boats.reduce((sum, b) => sum + b.caught, 0)
    let bonus = team.bonus, contract = team.contract, completed = team.completed, contractRecord: TeamRecord['contract'] = null
    const definition = contract && rules.contracts.find(c => c.id === contract!.id)
    if (contract && definition) {
      const fished = boats.filter(b => b.action === 'fish')
      const grounds = definition.counter === 'variety' ? [...new Set([...contract.grounds, ...fished.filter(b => b.caught > 0).map(b => b.to!)])] : contract.grounds
      const progress = Math.min(definition.target, definition.counter === 'variety' ? grounds.length
        : contract.progress + fished.filter(b => qualifies(definition.condition, start.get(b.to!)!, team.id)).reduce((sum, b) => sum + b.caught, 0))
      const done = progress >= definition.target
      contractRecord = { id: definition.id, progress, target: definition.target, completed: done }
      if (done) { bonus += bonusFor(definition, rules); completed = [...completed, definition.id]; contract = null } else contract = { id: definition.id, progress, grounds }
    }
    const next = { ...team, research, fish: team.fish + caught, bonus, contract, completed, boats: boats.map(b => ({ location: b.to, order: b.order })) }
    teams.push(next)
    teamRecords.push({ id: team.id, boats, paid: team.research - research, caught, research, fish: next.fish, bonus, contract: contractRecord })
  }
  const grounds = match.grounds.map((g, i) => ({ ...g, biomass: groundRecords[i].after, lastFishedBy: [...fishedBy.get(g.id)!] }))
  return { match: { grounds, teams }, record: { grounds: groundRecords, teams: teamRecords } }
}
