import type { CommonsConfig } from './rules.js'
// Every balancing value for The Commons. Edit between events, then restart the
// server (rebuild for production). Map, grounds and starting Research apply when
// the admin starts a match; check changes with `npm run simulate`. Times are in ticks.
export const commonsConfig: CommonsConfig = {
  tickSeconds: 2, // a boat sails one tile per tick
  width: 16,
  height: 10,
  landShare: 0.12,
  fuelCost: 1, // Research per tile sailed
  catchEffort: 80, // each tick a boat adds its ground's fish to its catch meter; a fish lands at 80 (20 fish: one every 8 s)
  hold: 20, // fish aboard before the boat sails home by itself to unload, so far grounds cost fuel per fish
  extraSchools: 2, // fishing grounds: one per team plus these (golden ones come on top)
  schoolMax: 20, // grounds start full
  growthTicks: 30, // every 60 s each ground regrows by up to growthCap (goldenCap for golden ones)
  growthCap: 2,
  goldenTeams: 4, // one golden ground per 4 teams, among the tiles farthest from the harbour
  goldenMax: 5,
  goldenCap: 1,
  goldenValue: 3, // points per golden fish
  baitBoost: 1.5, // bait fills the catch meter 1.5× as fast…
  baitCost: 1, // …for 1 Research per fish landed…
  baitReserve: 10, // …and pauses rather than take the team below 10 Research
  startingResearch: 10, // granted to every team when the match starts, so all boats leave harbour at once
}
