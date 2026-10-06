# Science competition

Vue 3 + TypeScript + Vite, with an Express server and SQLite. Includes 300 questions in English and Czech, team access codes, admin controls, independent subject progress, Research, five team-wide skips and **The Commons**, a shared fishing game played with Research. No individual student accounts or external services.

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
- The Game tab is **The Commons** (rules below). Highest score (fish caught plus contract bonuses) wins when the timer expires. The third tab, **Standings**, lists every team by score. It freezes with **5 minutes remaining** (55 minutes into the 60-minute round), and stays frozen across refreshes, new logins and server restarts. The game continues; your own score in Game and the admin totals stay live. The end screen only says “Competition over.”; organizers announce winners using the scores in admin. Score is points, not spendable Research. Grounds, boats, contracts and scores survive server restarts.
- Other devices refresh shared state every 1.5 seconds. Switching tabs is immediate; form state is retained until the question advances. The browser never receives accepted answers.

Admin can rename/delete teams and change codes. Existing sessions remain valid after code changes. Changing a team's age category clears that team's progress, Research, skips, score, boats and contract after a UI confirmation (shared grounds are not restored for a single-team edit). Deleting a team removes its sessions and boats. **Reset competition** clears progress, attempts, Research, skips, scores, boats, contracts, grounds and game history, and returns the timer and all teams to waiting. It keeps the roster, codes and sessions. Start game cannot restart or extend a running/finished round; reset first. To remove the roster, delete teams explicitly.

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

API tests use temporary SQLite files and verify bilingual schema validation, private answer projection, English/Czech answer normalisation, decimal comma input, all retry tiers and penalties, negative balances, legacy database migration, global skips, concurrent same/different-subject answers, game orders, contracts, travel, Research payment, lazily caught-up and idempotent resolutions, game persistence/reset/history, the standings freeze interleaved with resolutions and live admin totals, the diamond-prototype upgrade, age tracks, waiting/start/expiry enforcement, admin actions, session/timer persistence and a real server/database restart. `tests/commons.test.ts` covers the pure game rules (regrowth, travel, payment order, splitting, contracts, determinism). Browser tests use an isolated in-memory server on port 3101 (with a test-only clock control to make resolutions fall due), exercise separate browser contexts, language switching without draft/attempt loss, Czech text and numerical submissions, independent device preferences, and save desktop/mobile screenshots in `test-results/`. Run `npm run build` before browser tests so the production UI exists.

For a manual event rehearsal:

1. In `/admin`, create two teams with different ages. Note their codes.
2. Use two separate browser profiles/incognito sessions for one team and a third for the other. Check the waiting screens, then press Start game in admin.
3. Answer Physics on one device. Check Physics advances, other subjects do not, and Research appears on the second device.
4. Switch subjects and return; check the next unanswered question is retained.
5. Submit correct answers in different subjects on two devices at once; check both rewards/progress remain.
6. Compare age-category questions. In Game, send both boats to grounds and take a contract; check the other team's device shows the orders. After two resolutions (6 minutes), check catch, Research payment, ground stock and the last-resolution summary.
7. Stop and restart the server; reload both sessions and check balances, progress, boats, orders, contracts, scores and ground stock.
8. Switch English/Čeština while an answer is selected or typed. Check the draft remains, the question translates, a teammate’s language stays independent, and the preference survives reload.
9. Check the Booklet link opens a separate tab and ESS has none. Check reset returns everyone to waiting, and test invalid-code/offline feedback before admitting students.

To back up, stop the server and copy `data/competition.sqlite`. While the server is running, SQLite also uses `-wal`/`-shm` files; don't copy only the main database as a live backup. Keep `.env` private and out of version control.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the data model, API and future game replacement points.

Existing SQLite databases migrate automatically to allow negative Research balances, preserving team IDs, sessions, progress and positions. Existing progress is not cleared by the update; use the explicit reset before a fresh event.

Reset also clears the frozen standings for the next round. The five-minute freeze interval is `STANDINGS_FREEZE_SECONDS` in `server/game/standings.ts`.

## The Commons

Teams are rival fishing organisations sharing a set of fishing grounds. The game needs occasional attention, is deterministic, and rewards decisions rather than clicking speed or question volume.

- **Grounds.** 1.1 × teams, rounded (at least 2): one per team up to 4 teams, one spare from 5 teams, two from 15. Named A, B, C… and created when the admin starts the match. Each starts with 6 of a maximum 10 fish and regrows to 9 during the first resolution, while every boat is still leaving harbour. No ownership or map.
- **Boats.** Each team has two boats, starting in harbour. A boat's standing order is a ground or Idle, kept until changed. Any teammate's device can change it; every team's orders, boat positions and active contract are visible to everyone.
- **Travel.** A boat ordered to a different ground from where it is (including leaving harbour) spends the next resolution travelling, then fishes from the following one. Travel and idling are free.
- **Resolution** every 3 minutes, 20 per match, the last at the final whistle. Orders are locked at that moment. Each fishing boat pays **5 Research** (boat 1 first; a boat its team cannot pay for does not fish) and takes up to **2 fish**; a ground that cannot supply every boat is split equally, rounded down, with the remainder left in the water. Then contract progress updates and every ground regrows by `min(max(fish, 1), 10 − fish, 3)`: 1 when nearly empty, 3 from 3 to 7 fish, 0 when full. Each grounds card shows this expected growth.
- **Contracts.** Six optional public contracts, each completable once per team for **+8** (surveying four grounds, which is reliable but costs travel, **+6**). A contract needing more grounds than the match has is not offered. A team has at most one active contract; abandoning it loses its progress. Contracts are either a catch counter (catch N fish, optionally only at a named ground, only where the ground started the resolution with at least X fish, and/or only where no other team fished in the previous resolution) or a variety counter (fish at N different grounds).
- **Score** is fish caught plus contract bonuses. Unused Research is worth nothing.

The Game screen shows the grounds with stock, expected growth and every boat present or heading there; your two boats (select one, then a ground or Idle); the countdown to the next resolution; contracts with who pursues them and your progress; a compact leaderboard (frozen with the Standings); and what happened to your boats and every ground at the last resolution.

**Configuration.** Every balancing value is in `server/game/config.ts`: resolution interval, fishing cost, catch amount, maximum and starting stock, growth cap, ground-count formula, starting Research, contract bonus and the contract list. Edit between events and restart the server (rebuild for production). Ground count, stock and starting Research apply when the next match starts.

**Simulation.** `npm run simulate` plays hundreds of matches with 3, 6, 8, 12 and 20 bot teams using the same rules and configuration, prints the results for the plan's balance risks, and ends with a PASS/CHECK scorecard. Run it after changing `config.ts`; `npm run simulate -- 100 fishingCost=6 contractBonus=6` tries numeric overrides without editing the file. Bots (`server/game/bots.ts`) see only what players see. A *planner* stands in for a thoughtful team (forecasts each ground a few resolutions ahead, counting travel and every visible order); the fixed strategies are *greedy* (most fish per boat right now), *spread* (fewest boats), *follow* (the leader's grounds) and *stay* (never travel). Contract attitudes are none, *opportunistic* (take contracts current orders already serve), *rational* (also steer by a contract's face value) and *zealot* (steer at three times face value, never abandon). The bots are simple, so treat the numbers as a sanity check, not a prediction.

**Calibrate from a rehearsal.** Without data, the simulation assumes 2, 5 and 9 Research per minute for weak, average and strong teams, and that teams look in before 50–90% of resolutions. After a rehearsal, download **Match history (JSON)** in admin and run `npm run simulate -- --history match-history.json`. It measures each team's Research income per minute and how often it changed orders, sets the bots' incomes (quartiles) and attention to match, adds the rehearsal's team count to the field sizes, and reruns every experiment. If an average team could not pay for most of its fishing, it suggests a fishing cost that would fix that.

The defaults were tuned for 6–12 teams, preferring a harsh small field when rounding forces a choice. With the assumed teams:

- **Research does not decide the game.** An average team (about one correct answer every two minutes) pays for all its fishing; a weak team (one every five minutes) for about two thirds.
- **The commons bites.** From 6 teams up, fields of greedy teams catch 42–55 per team and drive the grounds down to 2–6 fish by mid-match, while fields of thoughtful teams keep them near 6 and catch 60–65. At 3 teams, with 3 grounds, it is harsh (34 against 51).
- **No fixed strategy dominates.** In mixed fields thoughtful play and greedy fishing are within about a point of each other at every size from 6 teams; spreading out and never travelling trail by 5–12 points, following the leader by 26–35.
- **Contracts pay only when well timed.** Taking contracts that current plans already serve is worth 5–9 points (8–12% of a score); steering for them by face value about 3; chasing them regardless of timing loses 1–4 points against ignoring them. Each contract is completed in roughly 10–70% of attempts.
- **The leaderboard keeps moving.** At 6–20 teams the top three keep changing until resolution 17–19, and in mixed fields the halfway leader wins 11–46% of the time.

**Known limits.** These are properties of the design rather than tuning, and the alternatives tested made the game worse:

- *A single free rider gains.* One greedy team among restrained ones scores 6–10 points more, because the fish others leave to regrow are there for the taking. That is the tragedy of the commons the game is about; the gain disappears once several teams play that way. Lowering the growth cap to 2 or raising the catch to 3 removed it, but only by making restraint pointless for everyone.
- *Early positions persist.* Among identical teams the halfway leader still wins 31–41% of the time at 6–12 teams (chance: 8–17%): a team that settles early on a lightly used ground tends to keep it. Fewer grounds did not help; a growth cap of 2 eased it but removed the dilemma.
- *Small fields are coarse.* With 3 teams on 3 grounds, rankings settle by about resolution 9.

**History.** Every resolution stores the full state before it (grounds, boats, orders, Research, contracts) and its outcome (catch, payments, regrowth, contract progress, scores), enough to replay the match. Admin can download it as JSON once a match has started (**Match history (JSON)**, or `GET /api/admin/history`).

Updating from the diamond prototype removes its tables automatically; reset before the next event.
