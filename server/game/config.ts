import type { CommonsConfig } from './rules.js'
// Every balancing value for The Commons. Edit between events, then restart the
// server (rebuild for production). Map, schools and starting Research apply when
// the admin starts a match; check changes with `npm run simulate`. Times are in ticks.
export const commonsConfig: CommonsConfig = {
  tickSeconds: 2, // a boat sails one tile per tick
  width: 16,
  height: 10,
  landShare: 0.12,
  fuelCost: 1, // Research per tile sailed
  catchTicks: 5, // a boat on a school catches one fish every 5 ticks (10 s)
  extraSchools: 2, // schools: one per team plus these
  schoolStart: 8,
  schoolMax: 12,
  growthTicks: 15, // every 30 s, each school regrows by up to growthCap
  growthCap: 2,
  driftTicks: 15, // every 30 s, each school swims one tile; boats sent to it follow, burning fuel
  respawnTicks: 10, // an emptied school reappears elsewhere 20 s later
  goldenEvery: 90, // every 3 minutes golden schools appear…
  goldenTeams: 4, // …one per 4 teams…
  goldenFish: 3,
  goldenValue: 4, // …each fish worth 4 points…
  goldenTicks: 75, // …and swim off after 2.5 minutes
  startingResearch: 10, // granted to every team when the match starts, so all boats leave harbour at once
}
