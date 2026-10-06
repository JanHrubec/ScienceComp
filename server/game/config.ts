import type { CommonsConfig } from './rules.js'
// Every balancing value for The Commons. Edit between events, then restart the
// server (rebuild for production). Ground count, biomass and starting Research
// apply when the admin starts a match; check changes with `npm run simulate`.
export const commonsConfig: CommonsConfig = {
  resolutionSeconds: 180,
  fishingCost: 5, // Research per fishing boat per resolution
  catchAmount: 2, // fish per boat per resolution
  maximumBiomass: 12,
  startingBiomass: 8,
  growthCap: 3,
  groundCount: teams => teams + 2,
  startingResearch: 0, // granted to every team when the match starts
  contractBonus: 8, // points; a contract may set its own `bonus`
  // Building blocks only: a catch counter (optionally limited to a named ground,
  // a minimum biomass at the start of the resolution, and/or grounds no other
  // team fished in the previous resolution) or a variety counter.
  contracts: [
    { id: 'full-nets', kind: 'catch', target: 14, minBiomass: 10 },
    { id: 'quiet-waters', kind: 'catch', target: 20, quiet: true },
    { id: 'quiet-and-full', kind: 'catch', target: 12, minBiomass: 9, quiet: true },
    { id: 'survey', kind: 'variety', target: 5 },
    { id: 'ground-a', kind: 'catch', target: 14, ground: 'A' },
    { id: 'ground-b', kind: 'catch', target: 14, ground: 'B' },
  ],
}
