# Science competition

Vue 3 + TypeScript + Vite, with an Express server and SQLite. Includes 300 questions in English and Czech, team access codes, admin controls, independent subject progress, Research, five team-wide skips and The Commons, a shared fishing game. No individual student accounts or external services.

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
- The admin starts one shared **45-minute** competition. Until then, questions are withheld and all play actions are blocked. At zero, both questions and game orders stop on the server. The timer appears on login, admin, Questions, Game and Standings screens and survives refreshes/restarts.
- Multiple choice: correct on the first attempt earns **+10 Research**; the second attempt earns **0**. **Every valid submission from the third onward costs 5 Research**, whether correct or incorrect. Incorrect answers on the first two attempts cost nothing. Only a correct answer advances.
- Text and numerical: correct on the first attempt earns the configured reward (default 10), the second earns half, and later attempts earn zero. Incorrect answers earn zero and never advance or reveal the answer. Malformed numerical input is rejected without counting an attempt.
- Attempts are shared by the whole team. Penalties can take Research below zero; teams must earn their way back before their boats can pay to fish. Multiple-choice scoring is fixed; per-question `reward` configures only open answers.
- Five skips per team across all subjects (`TEAM_SKIP_LIMIT` in `shared/domain.ts`). A skip advances without reward and cannot be reversed.
- The admin sees Research (spendable balance) and Score (game score: fish plus contract bonuses). Net question score, subject progress and skip usage expand within each row.
- **The Commons** (Game tab): teams are rival fishing organisations on shared grounds. There are teams + 2 grounds, fixed when the admin presses Start, each starting with 8 fish (maximum 12). Each team has 2 boats. A boat's standing order is a ground or idle, and persists until changed.
- Every **3 minutes** all orders resolve at once (15 resolutions in 45 minutes, the last at the final second). A boat ordered to the ground where it is pays **1 Research** and catches up to **2 fish**; boat 1 is paid first. A boat ordered elsewhere spends the next resolution travelling (free) and fishes from the one after. If a ground cannot supply every boat, its fish are split equally, rounded down. Then every ground regrows by min(max(stock, 1), 12 − stock, 3): slowly when nearly empty, fastest in the middle, not at all when full.
- Every team's boats, orders and active contract are visible to everyone. Six public contracts (catch a number of fish at a named ground, at grounds with a high stock, or at grounds no other team fished last time; or fish at several different grounds) are optional, once per team, one at a time, and pay **5 bonus points**. Abandoning one loses its progress.
- Score is fish caught plus contract bonuses; unused Research is worth nothing. The Game tab shows the last resolution's outcome, a countdown to the next one and a compact leaderboard.
- Highest score wins when the timer expires. The third tab, **Standings**, lists every team by score. It freezes with **5 minutes remaining** (40 minutes into the 45-minute round), and stays frozen across refreshes, new logins and server restarts; rivals' catches in the Game tab are hidden too. Your own score and the admin totals stay live. The end screen only says “Competition over.”; organizers announce winners using the scores in admin.
- Resolutions run on the server in the transaction of the first request after they fall due, so they happen exactly once, at their scheduled time's orders and Research, even if nobody was connected. Scores, boats and grounds survive server restarts. Admin can download the full per-resolution history as JSON (**Download game history**).
- Other devices refresh shared state every 1.5 seconds. Switching tabs is immediate; form state is retained until the question advances. The browser never receives accepted answers.

Admin can rename/delete teams and change codes. Existing sessions remain valid after code changes. Changing a team's age category clears that team's progress, Research, skips, score, boats and contracts after a UI confirmation (shared grounds are not refilled for a single-team edit). Deleting a team removes its sessions. **Reset competition** clears progress, attempts, Research, skips, scores, boats, contracts, grounds and game history, and returns the timer and all teams to waiting. It keeps the roster, codes and sessions. Start game cannot restart or extend a running/finished round; reset first. To remove the roster, delete teams explicitly.

## Subject booklets

Edit URLs in **`server/booklets.ts`**, then restart the server (rebuild for production). Physics, Biology, Chemistry and Computer Science use the supplied PDF links. ESS has an empty URL, so it has no Booklet button. Booklets open in a new tab. There are no booklet settings in admin.

The 45-minute duration is `DURATION_SECONDS` in `server/competition.ts`. Set it between events; it is deliberately not an admin setting.

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

API tests use temporary SQLite files and verify bilingual schema validation, private answer projection, English/Czech answer normalisation, decimal comma input, all retry tiers and penalties, negative balances, legacy database migration, global skips, concurrent same/different-subject answers, game orders, contracts, timed resolutions and their Research costs, game persistence/reset, the standings freeze across resolutions and live admin totals, age tracks, waiting/start/expiry enforcement, admin actions, session/timer persistence and a real server/database restart. Browser tests use an isolated in-memory server on port 3101, exercise separate browser contexts, language switching without draft/attempt loss, Czech text and numerical submissions, independent device preferences, and save desktop/mobile screenshots in `test-results/`. `tests/commons.test.ts` covers the pure fishing rules. Run `npm run build` before browser tests so the production UI exists.

For a manual event rehearsal:

1. In `/admin`, create two teams with different ages. Note their codes.
2. Use two separate browser profiles/incognito sessions for one team and a third for the other. Check the waiting screens, then press Start game in admin.
3. Answer Physics on one device. Check Physics advances, other subjects do not, and Research appears on the second device.
4. Switch subjects and return; check the next unanswered question is retained.
5. Submit correct answers in different subjects on two devices at once; check both rewards/progress remain.
6. Compare age-category questions. In Game, send a boat to a ground and take a contract; observe both from the other team's device. After the next resolution, check the travel, the catch, the Research paid and the score.
7. Stop and restart the server; reload both sessions and check balances, progress, boats, grounds and scores.
8. Switch English/Čeština while an answer is selected or typed. Check the draft remains, the question translates, a teammate’s language stays independent, and the preference survives reload.
9. Check the Booklet link opens a separate tab and ESS has none. Check reset returns everyone to waiting, and test invalid-code/offline feedback before admitting students.

To back up, stop the server and copy `data/competition.sqlite`. While the server is running, SQLite also uses `-wal`/`-shm` files; don't copy only the main database as a live backup. Keep `.env` private and out of version control.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the data model, API and future game replacement points.

Existing SQLite databases migrate automatically to allow negative Research balances, preserving team IDs, sessions, progress and positions. Existing progress is not cleared by the update; use the explicit reset before a fresh event.

Reset also clears the frozen standings for the next round. The five-minute freeze interval is `STANDINGS_FREEZE_SECONDS` in `server/game/standings.ts`.

Every game balancing value (resolution interval, fishing cost, catch, maximum and starting stock, growth cap, ground-count formula, starting Research, contracts and bonus) is in `server/game/commons-config.ts`; the rules themselves are the pure module `shared/commons.ts`. Change values between events, then reset. `npm run simulate` plays thousands of matches with fixed strategies at 3, 8 and 20 teams and reports Research affordability, strategy balance, contract value and how late the leaderboard still changes. Contracts and bonus were tuned with it: the plan's example contracts at 8 points let a contract-taking strategy earn about 30 bonus points a match, so the targets were raised and the bonus set to about 10% of the maximum catch. With 10 Research per correct answer and fishing at 1, Research only limits teams that answer fewer than about 8 questions in 45 minutes.
