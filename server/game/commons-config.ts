import type { CommonsRules } from '../../shared/commons.js'
// Every balancing value for The Commons. Rules in shared/commons.ts read only
// these values. Change them between events, then reset; `npm run simulate`
// checks a change before students see it.
export const commonsRules: CommonsRules = {
  resolutionSeconds: 3 * 60,
  fishingCost: 1,
  catchAmount: 2,
  maxBiomass: 12,
  startingBiomass: 8,
  growthCap: 3,
  startingResearch: 0,
  // About 10% of a team's maximum catch (56 fish in 15 resolutions).
  contractBonus: 5,
  groundCount: teams => teams + 2,
  // Two building blocks only: a catch counter, optionally limited to a named
  // ground, a minimum start-of-resolution biomass or grounds no other team
  // fished in the previous resolution; or a count of different grounds.
  contracts: [
    { id: 'full-nets', counter: 'catch', target: 10, condition: { minBiomass: 10 } },
    { id: 'deep-water', counter: 'catch', target: 6, condition: { minBiomass: 11 } },
    { id: 'quiet-water', counter: 'catch', target: 12, condition: { quiet: true } },
    { id: 'survey', counter: 'variety', target: 5 },
    { id: 'ground-a', counter: 'catch', target: 12, condition: { ground: 'A' } },
    { id: 'ground-b', counter: 'catch', target: 12, condition: { ground: 'B' } },
  ],
}
