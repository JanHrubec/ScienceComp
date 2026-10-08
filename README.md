# Science Competition

Vue 3 + TypeScript + Vite, with an Express server and SQLite. Includes 300 questions in English and Czech, team access codes, admin controls, independent subject progress, Research, five team-wide skips and **The Commons**, a live fishing game on a shared map, fuelled by Research. No individual student accounts or external services.

## Run locally

Use **Node.js 24 or newer** and npm. Run commands from this directory.

```sh
npm install
cp .env.example .env
# Edit .env and set ADMIN_PASSWORD to a private password.
npm run dev
```

Open **http://localhost:5173**. Admin is **http://localhost:5173/admin**. Use Add team to create teams and distribute their codes. Participants see a waiting screen until you press Start game. A blank code generates an easy-to-type four-character code; manual codes accept 4–8 letters/numbers and are case-insensitive. The server refuses the placeholder password.

For other devices on the same Wi-Fi, use `http://YOUR-COMPUTER-LAN-IP:5173`. Keep the computer awake and permit connections through its firewall. All devices must use the same hostname/IP to share the same browser origin. Internet is not needed after dependencies are installed. Browser sessions on different devices are independent and can all join the same team.

## Production / event use

```sh
npm ci
npm run build
npm start
```

Open **http://localhost:3001**, or `http://YOUR-COMPUTER-LAN-IP:3001` on other devices. One Node process serves both the built frontend and API. Keep `questions/`, `.env` and the `data/` directory alongside the built app; run from the project root. The database directory is created automatically. Use one server process for this small event.

Configuration in `.env`:

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Required private admin password; no default usable password |
| `PORT` | Server port, default 3001 |
| `DATABASE_PATH` | SQLite file, default `./data/competition.sqlite` |
| `QUESTION_DIR` | Question directory, default `./questions` |
| `COOKIE_SECURE` | `false` for local HTTP; `true` behind HTTPS |
| `TRUST_PROXY` | `1` only behind exactly one trusted reverse proxy; otherwise `0` |

For an internet deployment, terminate HTTPS at a reverse proxy and set secure cookies. This version is designed for a small supervised school event. Login endpoints have a generous per-IP rate limit to accommodate a shared school network. Node 24 may print an experimental warning for its built-in SQLite module; no native database package needs compiling.

## Competition rules

- All five subject tracks are independent, ordered and selected by the team's age category.
- The admin starts one shared **60-minute** competition. Until then, questions are withheld and all play actions are blocked. At zero, both questions and game orders stop on the server. The timer appears on login, admin, Questions, Game and Standings screens and survives refreshes/restarts.
- Multiple choice: correct on the first attempt earns **+10 Research**; the second attempt earns **0**. **Every valid submission from the third onward costs 5 Research**, whether correct or incorrect. Incorrect answers on the first two attempts cost nothing. Only a correct answer advances.
- Text and numerical: correct on the first attempt earns the configured reward (default 10), the second earns half, and later attempts earn zero. Incorrect answers earn zero and never advance or reveal the answer. Malformed numerical input is rejected without counting an attempt.
- Attempts are shared by the whole team. Penalties can take Research below zero; teams must earn their way back to at least 1 Research to move. Multiple-choice scoring is fixed; per-question `reward` configures only open answers.
- Five skips per team across all subjects (`TEAM_SKIP_LIMIT` in `shared/domain.ts`). A skip advances without reward and cannot be reversed.
- The admin sees Research (spendable balance) and Score (game score). Net question score, subject progress and skip usage expand within each row.
- The Game tab is **The Commons** (rules below). Highest score (fish caught plus golden points) wins when the timer expires. The third tab, **Standings**, lists every team by score. It freezes with **5 minutes remaining** (55 minutes into the 60-minute round), and stays frozen across refreshes, new logins and server restarts. The game continues; your own score in Game and the admin totals stay live. The freeze hides the leaderboard, not the game: every school and boat stays public, so a determined team that watched every catch could estimate other teams' scores. The end screen only says “Competition over.”; organizers announce winners using the scores in admin. Score is points, not spendable Research. The map, boats and scores survive server restarts.
- Other devices refresh shared state every 1.5 seconds. Switching tabs is immediate; form state is retained until the question advances. The browser never receives accepted answers.

Admin can rename/delete teams and change codes. Existing sessions remain valid after code changes. Changing a team's age category clears that team's progress, Research, skips and score and sends its boat back to the harbour, after a UI confirmation (the shared map is not restored for a single-team edit). Deleting a team removes its sessions and its boat. **Reset competition** asks for one confirmation, then clears progress, attempts, Research, skips, scores, the map and game history, and returns the timer and all teams to waiting. It keeps the roster, codes and sessions. Start game cannot restart or extend a running/finished round; reset first. To remove the roster, delete teams explicitly.

## Subject booklets

Edit URLs in **`server/booklets.ts`**, then restart the server (rebuild for production). Physics, Biology, Chemistry and Computer Science use the supplied PDF links. ESS has an empty URL, so it has no Booklet button. Booklets open in a new tab. There are no booklet settings in admin.

The 60-minute duration is `DURATION_SECONDS` in `server/competition.ts`. Set it between events; it is deliberately not an admin setting.

## Edit questions

There is **one JSON file per subject**, each containing all age categories:

- `questions/physics.json`
- `questions/computer-science.json`
- `questions/biology.json`
- `questions/chemistry.json`
- `questions/ess.json`

Each has `subject` and `tracks`, with keys `11–13`, `14–16`, `17–18` (en dashes). Array order is competition order. There are 20 questions in each supplied track. More or fewer are supported. Read [questions/README.md](questions/README.md) for the schema and examples.

All 15 tracks aim for a gradual, age-relative ramp from question 1 to 20, with no fixed jump at question 5. Calculations sit alongside predictions, experiments, model comparisons and short answers using familiar words or supplied labels. Younger questions build subject intuition; older questions combine more conditions, evidence and operations. Unfamiliar rules are supplied where useful, and English and Czech provide equivalent information. The bank samples the major IB themes rather than covering an entire course. See [coverage and progression](questions/COVERAGE.md) for the topic map and [editing guidance](questions/README.md) for the schema. Difficulty is an editorial estimate; rehearsal with students is the best way to check balance across subjects.

Question IDs remain stable even when their position changes; progress follows array order. Start a fresh round after loading this reordered bank.

Use the **English / Čeština** selector in the header to change language. It translates questions, choices and interface controls immediately, preserving the current draft and attempts. The preference is saved on that browser; teammates may choose different languages. Either language’s explicitly listed text answers are accepted, and numerical answers accept a decimal point or comma. UI translations live in `src/i18n.ts`; question translations are the `cs` fields in the subject files. Booklet PDFs use the existing links in either language.

Restart the server after edits. Validation runs before it listens and rejects missing fields, wrong types, missing Czech translations, mismatched translated choices, invalid choice indexes, duplicate IDs, unknown properties and empty tracks. Preserve IDs and ordering during an event: progress is stored as a completed-question count. Prefer content changes between events followed by an admin reset. Subject leads should review their file before the event for local curriculum fit and desired difficulty.

## Development and verification

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

API tests use temporary SQLite files and verify bilingual schema validation, private answer projection, English/Czech answer normalisation, decimal comma input, all retry tiers and penalties, negative balances, legacy database migration, global skips, concurrent same/different-subject answers, game orders (and rejected ones), sailing and fuel, fishing, lazily caught-up ticks played exactly once by concurrent reads, game persistence/reset/history, the standings freeze interleaved with ticks and live admin totals, the upgrades from the diamond prototype and the three-ground Commons (including ending an unreset round and keeping its scores), reset working when catch-up cannot (the admin roster read failing with a 500, not a 401), polls that take no write lock unless a tick or the freeze is due, age tracks, waiting/start/expiry enforcement, admin actions, session/timer persistence and a real server/database restart. `tests/commons.test.ts` covers the pure game rules (map generation, shortest routes around islands, fuel and stalling, catching, regrowth and respawning, following a drifting school, turns at the last fish, golden schools), the planner bot, and the simulation: reproducible matches, tie-aware convergence metrics, calibration (including a 1-team rehearsal and an empty one) whatever the argument order, and rejection of empty or malformed overrides. Browser tests use an isolated in-memory server on port 3101 (with a test-only clock control to make time pass), exercise separate browser contexts, delayed boat orders where only the latest waiting one is sent, tapping open sea on the map, the Game tab alert, waiting orders dropped when a device signs out and another team signs in on it, the admin dashboard and its one-click reset staying reachable when the roster cannot load, language switching without draft/attempt loss, Czech text and numerical submissions, independent device preferences, and save desktop/mobile screenshots in `test-results/`. Run `npm run build` before browser tests so the production UI exists.

For a manual event rehearsal:

1. In `/admin`, create two teams with different ages. Note their codes.
2. Use two separate browser profiles/incognito sessions for one team and a third for the other. Check the waiting screens, then press Start game in admin.
3. Answer Physics on one device. Check Physics advances, other subjects do not, and Research appears on the second device.
4. Switch subjects and return; check the next unanswered question is retained.
5. Submit correct answers in different subjects on two devices at once; check both rewards/progress remain.
6. Compare age-category questions. In Game, tap a school; check the other team's device shows your boat sailing there, and that Fuel drops by one per tile. Once it arrives, check a fish lands about every 10 seconds.
7. Stop and restart the server; reload both sessions and check balances, progress, the boat, its order and the score. A boat that was sailing has carried on while the server was down.
8. Switch English/Čeština while an answer is selected or typed. Check the draft remains, the question translates, a teammate’s language stays independent, and the preference survives reload.
9. Check the Booklet link opens a separate tab and ESS has none. Check reset returns everyone to waiting, and test invalid-code/offline feedback before admitting students.

To back up, stop the server and copy `data/competition.sqlite`. While the server is running, SQLite also uses `-wal`/`-shm` files; don't copy only the main database as a live backup. Keep `.env` private and out of version control.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the data model, API and game internals.

Existing SQLite databases migrate automatically to allow negative Research balances, preserving team IDs, sessions, progress and positions. Existing progress is not cleared by the update; use the explicit reset before a fresh event.

Reset also clears the frozen standings for the next round. The five-minute freeze interval is `STANDINGS_FREEZE_SECONDS` in `server/game/standings.ts`.

## The Commons

Teams are rival fishing crews on one shared sea. The game runs live: boats sail and fish on their own, so a team only needs to look in every minute or two to steer.

- **The map.** 16 × 10 tiles of sea with small islands, generated fresh for every match, with the harbour in the middle. Every bit of sea can be reached from the harbour.
- **Boats.** Each team has one boat, starting in the harbour. Tap a school of fish (or pick it from the list) and the boat sails there by the shortest route, one tile every 2 seconds, and follows the school as it swims. Tapping open sea sends it to that tile. Any teammate's device can give orders; every boat, its destination and its route are visible to everyone. The Game tab shows a yellow dot while a golden school is out or your boat has nothing to do.
- **Fuel.** Every tile sailed burns **1 Research**. A boat out of Research waits where it is until the team answers more questions. Every team starts the match with 10 Research, so all boats can leave the harbour at once.
- **Fishing.** A boat parked on a school catches a fish every 10 seconds. Schools start with 8 fish and regrow by up to 2 every 30 seconds (slowly when nearly empty, not at all at 12), and every 30 seconds each school swims one tile, so boats fishing it burn a little fuel following it. One boat alone barely dents a school; boats sharing one empty it fast. An emptied school vanishes and a new one appears elsewhere 20 seconds later. There is one school per team, plus two.
- **Golden schools.** Every 3 minutes golden schools appear, one per four teams, with 3 golden fish worth **4 points** each. They swim off after 2½ minutes if nobody empties them first.
- **Score** is fish caught plus golden points. Unused Research is worth nothing.

The Game screen shows your score and fuel, what your boat is doing (with a link back to the questions when it is out of fuel), the map with every boat, route and school, a list of schools nearest first with who is heading for each, and a compact leaderboard (frozen with the Standings).

**Configuration.** Every balancing value is in `server/game/config.ts`: tick length, map size and land share, fuel cost, catch speed, school count, stock, regrowth, drift and respawn, golden schools, and starting Research. Edit between events and restart the server (rebuild for production). Map, schools and starting Research apply when the next match starts.

**Simulation.** `npm run simulate` plays a hundred matches for each of 3, 6, 8, 12 and 20 bot teams using the same rules and configuration, prints the results for the balance risks, and ends with a PASS/CHECK scorecard. Bot teams earn Research every minute and look in at random moments, on average every so many minutes; in between, their boats carry on alone. Tied teams share a place in win shares and convergence figures. Run it after changing `config.ts`; `npm run simulate -- 100 fuelCost=2 width=20` tries numeric overrides without editing the file. Bots (`server/game/bots.ts`) see only what players see. A *planner* stands in for a thoughtful team: it values each school by the fish it expects to catch before it next looks in, counting the sail there and every boat already on or heading for it, and chases golden schools it can reach in time. The rules of thumb it must not lose to are *nearest* (closest school), *biggest* (most fish), *golden* (always chase golden schools) and *stay* (send the boat out once and never look again). The bots are simple, so treat the numbers as a sanity check, not a prediction.

**Calibrate from a rehearsal.** Without data, the simulation assumes 2, 5 and 9 Research per minute for weak, average and strong teams, and that teams look in every 1–4 minutes. After a rehearsal, download **Match history (JSON)** in admin and run `npm run simulate -- --history match-history.json`. It measures each team's Research income per minute (what it holds plus what it burnt) and how often it gave orders, sets the bots' incomes (quartiles) and how often they look in to match, adds the rehearsal's team count to the field sizes (if it had at least 2 teams; a single team still sets incomes and attention), and reruns every experiment. Arguments may come in any order, and numeric overrides apply to the calibration as well as the experiments.

**Findings** (100 matches per field size, assumed teams; every scorecard line passes):

- **Fuel matters, up to a point.** An average team (about one correct answer every two minutes) can always pay for the sailing it wants and scores 8–10% above the field. A weak team (one every five minutes) can pay for only 52–58% of it and scores 14–20% below. A strong team scores no more than an average one: beyond about 5 Research a minute there is nothing more to spend it on.
- **No constant attention needed.** Against a team that looks in every minute, one that looks every 2 minutes scores 83–86%, every 5 minutes 68–71%, every 10 minutes 42–46%. Most of the edge from looking in every minute is winning golden-fish races: without golden schools, looking every 2 minutes keeps 97–99% and every 5 minutes 75–84%.
- **Thinking beats rules of thumb.** In mixed fields thoughtful teams average 322–329 points; going for the biggest school 286–303, always chasing gold 284–292, the nearest school 205–235, and a team that never looks again about 20. Every rule of thumb loses to thoughtful play when it is the only one in the field.
- **Golden fish are worth it but do not decide matches:** 18–23% of all points. At 3 teams 27% of golden schools swim off unfished, at 6 teams 12%, from 12 teams 3–5%.
- **Crowding is punished.** Fields where every team goes for the biggest school score 235–272 a team, against 304–323 when every team plans.

**Known limits.**

- *Early leads persist.* Among identical teams the halfway leader still wins 34–63% of the time (chance: 5–33%), and in mixed fields 72–89%: catches accumulate steadily, so a lead built in the first half rarely melts. Doubling the golden schools in the last 10–20 minutes, as a comeback rush, made no measurable difference and only rewarded watching more closely.
- *Research above about 5 a minute is wasted.* Raising the fuel cost or the map size would make strong question-answerers keep pulling ahead, at the cost of starving weak teams further.

**History.** The match log keeps every order (when, which team, where to), every golden-school event, and a per-minute sample of each team's Research, fuel burnt, fish and golden points, along with the settings and the starting map. Admin can download it as JSON once a match has started (**Match history (JSON)**, or `GET /api/admin/history`).
