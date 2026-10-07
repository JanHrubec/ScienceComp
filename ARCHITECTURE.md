# Architecture

One Vue client and one Express process share TypeScript domain types. SQLite is the authority for every score, attempt, progress counter, session and game order. The frontend uses a small Vue reactive store rather than Pinia because only one team snapshot is shared. It does not perform grading or persist authoritative game data locally.

## Main files

| Location | Responsibility |
| --- | --- |
| `shared/domain.ts` | Public Team, QuestionProgress, GameState and TeamState types |
| `server/index.ts` | Environment configuration, question loading, server startup |
| `server/db.ts` | SQLite tables, transaction helper, API error |
| `server/competition.ts` | Shared start time, 60-minute duration and server-side play gate |
| `server/booklets.ts` | Subject booklet URLs; empty URL hides the link |
| `shared/scoring.ts` | Retry tiers used for UI previews and server-side awards |
| `src/competition.ts` | Shared server-synchronised countdown, independent of the device clock |
| `server/questions.ts` | Strict question schema, loading, private grading, public projection |
| `server/app.ts` | Authentication, team/admin API, atomic question actions, static hosting |
| `server/game/rules.ts` | The Commons: pure, deterministic resolution rules (no database or UI) |
| `server/game/config.ts` | Every balancing value and the contract list |
| `server/game/commons.ts` | Game tables, lazy resolution scheduling, orders, contracts, history and public projection |
| `server/game/bots.ts` | Bot teams (thoughtful planner, fixed strategies, contract attitudes) for the simulation |
| `server/game/simulate.ts` | `npm run simulate`: bot experiments for the balance risks, a PASS/CHECK scorecard, and calibration from a rehearsal's match history |
| `src/i18n.ts` | English/Czech UI strings and browser-local language preference |
| `src/components/LanguageSwitcher.vue` | Compact shared language selector |
| `src/state.ts` | Shared snapshot and stale-poll protection |
| `src/views/ParticipantView.vue` | Persistent header, Questions/Game/Standings tabs, polling |
| `src/views/QuestionsView.vue` | Subject switching, answers, feedback, skips |
| `src/components/CommonsGame.vue` | The Commons screen: grounds, boats, contracts, leaderboard, last resolution |
| `src/views/StandingsView.vue` | Third tab with all team scores and freeze indicator |
| `src/components/TeamScores.vue` | Score table for Standings and the in-game leaderboard |
| `server/game/standings.ts` | Lazy catch-up (due resolutions and the five-minute snapshot, in order), live rankings and the persisted snapshot |
| `src/views/AdminView.vue` | Team management, progress table, reset confirmation |
| `questions/*.json` | Editable content; see `questions/README.md` |

## Database

Tables are created on startup with foreign keys and WAL enabled.

- **teams**: UUID, display name, age category, unique case-insensitive code, Research balance (may be negative), net question score including penalties, global skips used, identifying colour.
- **progress**: one row per team/subject, completed count and current-question failed-attempt count. Completed includes skipped questions. The count indexes the team's age-specific track.
- **sessions**: SHA-256 hash of a cryptographically random token, team ID (null for admin), role, seven-day expiry. Expired rows are cleaned during login.
- **commons_grounds**: one row per ground (index ID, current and maximum stock, JSON list of teams that fished it in the previous resolution). Created when the match starts.
- **commons_boats**: two rows per team: current ground (null = harbour) and standing order (null = idle).
- **commons_teams**: one row per team: fish caught, contract bonus, active contract with progress and visited grounds, JSON list of completed contracts, and how many contracts it has taken (`taken`), which numbers the active one's taking. Score is fish + bonus, separate from Research.
- **commons_resolutions**: one row per resolution with its scheduled time and a JSON record of the state before and the full outcome, for replay.
- **config**: persistent start timestamp (`started_at`), last reset timestamp and optional JSON `standings_snapshot`. The end time is start + `DURATION_SECONDS`. Operational secrets remain in the environment.

Deleting teams cascades to progress, sessions, boats and game scores. Grounds are not restored on deletion. Game initialization inserts only missing team/boat rows, preserving an existing match. Between rounds it drops the diamond prototype's `grid_*` tables and any snapshot of their scores. A diamond round that was started but never reset is not continued under the longer Commons duration: initialization ends it (moving `started_at` back so the round is over), creates no grounds for it, keeps its `grid_*` tables, turns its frozen standings (or, without one, its final diamonds) into the standings with diamonds as score, counts each team's final diamonds as its fish so admin shows them as scores, and logs a reminder with the final diamonds on every start until the organizer resets. Start creates the grounds from the roster at that moment. Competition reset removes grounds and history, clears boats, contracts and scores, and drops any kept `grid_*` tables. Admin reset preserves the roster and sessions and removes the start timestamp, returning teams to waiting. A targeted migration removes the old non-negative Research constraint while preserving all related rows; a Commons database from before takings were numbered gains the `taken` column, its active contracts counting as taking 0. The SQLite file, question files and environment configuration together define a deployment. No external database service or seed step is necessary.

## Sessions and boundaries

Team code login issues a random token in a persistent HttpOnly, SameSite=Strict cookie. Admin uses a separate cookie after checking the environment password. Session hashes are persisted so server restarts do not log devices out. Multiple logins for the same team create independent sessions. Logout revokes only the current browser session. Codes are visible only through the protected admin endpoint.

All mutations require a custom request header; CORS is not enabled, so cross-origin pages cannot submit these requests. Login has per-IP rate limiting. Request payloads use Zod validation; prepared statements handle SQL values. API responses use `Cache-Control: no-store`. Correct answers are projected out of all participant responses, and question files are not served as static assets. Do not mount the whole repository as a public static directory.

## API

All endpoints below are prefixed by `/api`. POST/PUT/DELETE requests send JSON and `X-Competition-Client: 1`. Errors have `{ "error": "message" }` with appropriate 400/401/403/404/409/429/500 status codes.

| Method and path | Description |
| --- | --- |
| `GET /health` | Startup/readiness check |
| `GET /competition` | Public status, server time, start/end timestamps, duration and booklet URLs |
| `POST /admin/start` | Atomically start a waiting competition; a second start returns 409 |
| `POST /team/login` | `{code}` → team snapshot + cookie |
| `POST /team/logout` | Revoke this device's session |
| `GET /team/state` | Team, all subject progress/current public questions, shared game and live/frozen standings |
| `POST /team/answer` | `{subject, questionId, answer}` → correctness, reward, fresh snapshot |
| `POST /team/skip` | `{subject, questionId}` → skip result and fresh snapshot |
| `POST /team/game/order` | `{boat, ground}` (boat 1 or 2; ground index or null) → set that boat's standing order (null = idle); fresh snapshot |
| `POST /team/game/contract` | `{contract, current, taken?}` (contract IDs or null; `taken` from the snapshot's active contract) → take or abandon a contract; `current` and, for an active contract, `taken` must match the team's active contract; fresh snapshot |
| `POST /admin/login` | `{password}` → admin cookie |
| `POST /admin/logout` | Revoke admin session |
| `GET /admin/teams` | Roster, codes, balances, net question scores, game score (fish + bonus), progress |
| `GET /admin/history` | Game configuration and every resolution record (JSON download) |
| `POST /admin/teams` | `{name, age, code?}` → generated team ID |
| `PUT /admin/teams/:id` | Update name/age/code; missing code generates a new one |
| `DELETE /admin/teams/:id` | Remove a team and related data |
| `POST /admin/reset` | `{confirmation:"RESET"}` → clear competition play state and return to waiting |

## Questions and language

Each subject JSON file contains all three ordered age tracks. English fields remain at the top of each question; a required `cs` object carries the Czech prompt and, for multiple choice, choices in the same order. Text questions define separate explicit `acceptedAnswers` arrays in each language. Numerical values/tolerances, IDs and rewards are shared. `server/questions.ts` validates the entire bank before startup and uses an explicit whitelist to expose only both languages' prompts and choices, plus ID/type/reward.

The browser chooses which public prompt/choices to display; it never grades answers. There is no language parameter on answer submissions: multiple choice sends a stable index, text is checked against both explicit accepted-answer lists, and numbers accept a decimal point or comma. Changing the language cannot create a new question or reset attempts. Case and whitespace are normalized; accents are preserved unless an explicit accentless variant is listed.

`src/i18n.ts` stores only a device's UI preference (`science-language`) in localStorage, updates the document language, and translates UI labels and routine errors. The language selector is shared by login, participant and admin headers. Answer drafts are keyed to question ID, so language switching retains selected choices and typed text. Teammates can independently select languages while sharing the same authoritative progress and scores. No translation service or extra package is required. See `questions/README.md` for the editable format.

## Concurrency and synchronisation

The server uses short synchronous `BEGIN IMMEDIATE` SQLite transactions, with no asynchronous work inside them. Every play transaction first checks that the competition is running. An answer action reads current progress, verifies the supplied question ID, grades privately, applies the retry-dependent reward/penalty and increments the subject only if correct. Incorrect third-and-later multiple-choice submissions also deduct 5. Research and net score may become negative; game spending still requires sufficient Research. Attempts and awards commit together. Two different-subject submissions preserve both increments. Two correct submissions for the same displayed question produce one success and one 409; the browser reloads its snapshot. Attempts and the five-skip allowance are shared across devices. `TEAM_SKIP_LIMIT` in `shared/domain.ts` is used by the server, fresh database schema and UI. There is no new migration for older three-skip databases.

All question, skip and game actions are rejected before start and at/after the 60-minute deadline. Team snapshots withhold question content outside play. Clients submit only boat orders and contract choices; orders are idempotent (last write wins), and a contract change must name the contract the device last saw and, for an active one, which taking of it, so a teammate's choice is never replaced unseen. Every taking gets the next number, so even a contract a teammate abandoned and took again between this device's polls is a different taking: the abandon confirmation belongs to the taking the player chose to abandon, closes once the device sees any other, and a confirmation sent before it does is refused with 409. No client-supplied price, stock or score is trusted.

Game resolutions are scheduled at start + n × interval and run lazily. Every request that reads or changes play state goes through `read()` or `change()` in `app.ts`, which bring the game up to date exactly once, as of one moment, and the response is built as of that moment, so it never mixes state from before and after a resolution. A change runs each due resolution, in order, inside its own `BEGIN IMMEDIATE` transaction before applying itself. A read first makes one small query without a lock and takes the write lock only when a resolution or the standings snapshot is due, checking again once it holds it, so the usual poll neither takes nor waits for the write lock. A resolution therefore sees exactly the orders and Research committed before it ran, and an order or answer arriving after a scheduled time applies to the next one. Each resolution number is inserted once, so repeated or concurrent catch-up is harmless; outcomes are identical whether or not anyone was connected at the scheduled moment. The resolution itself is the pure `resolve()` in `rules.ts`; Research is debited with the payments it reports. Snapshots are plain reads, run synchronously on the same connection.

Start needs no catch-up, since only a waiting competition can start. Reset deliberately skips it: it discards the match anyway, so it still works when a resolution cannot run (corrupt stored data, a configuration edited mid-match, a bug) and every other play request fails, and it does not replay a finished match only to delete it. Roster edits do catch up first and fail with it, rather than freeze wrong standings or leave overdue resolutions to run against a roster they were not scheduled with. So does the admin roster read, but with a 500 rather than a 401, and the admin screen treats any answer but 401 as signed in, so its reset stays reachable after a reload or from another device.

Participant state and public competition state poll every 1.5 seconds; admin teams every 2 seconds. Standings are included in the team snapshot and therefore use the existing poll. The countdown advances locally using monotonic elapsed time since the last server timestamp, so device wall-clock differences do not affect it. Newer server timestamps replace older ones. Start/expiry/reset automatically switch participants between waiting, play and finished screens; hidden play views are unmounted. The finished screen only says “Competition over.”; scores remain visible in admin for the organizer to announce winners. A client polls again only after the prior poll finishes. Successful actions replace the snapshot immediately. A generation counter prevents an older pending poll from overwriting a newer action response or logout. Errors leave the screen usable, show connection feedback, and retry automatically. Requests time out after eight seconds. A timed-out mutation may have committed; clients refresh before retrying, and question IDs guard against ordinary duplicate submissions; game orders are idempotent. Game requests go one at a time: an order given while another request is in flight waits on the device, the latest order for each boat wins, and the boat shows “Sending…” until the server confirms it. A failed order is not retried; the error is shown and the boat reverts to the server's order. Waiting orders belong to the session that gave them: when the device signs out, or a poll finds it signed in as another team (a login in another tab replaces the shared cookie), they are dropped and a game response still in flight is ignored, so nothing is sent or shown under the next session. Requests are not queued offline.

The participant router keeps play views mounted in KeepAlive. Subject selection and draft inputs survive Game switching; question advancement clears obsolete inputs. Sessions are cookies, not localStorage secrets. Polling is intentionally sufficient for a classroom event; it can later be replaced with SSE/WebSockets around the same state/action boundary.

## Standings freeze

With five minutes left, public standings are saved in `config.standings_snapshot`. Every competition mutation checks the cutoff within its transaction **before** changing scores or the roster. Reads also capture a due snapshot. Catch-up runs resolutions scheduled up to the cutoff, takes the snapshot, then runs later ones, so the snapshot holds exactly the scores at the cutoff even if the first request comes minutes later; no background scheduler is needed. The snapshot includes names, colours and scores, and remains stable across reconnects, restarts and later admin roster edits. Reset deletes it.

Participant game data includes every ground's stock and every team's boats, orders and active contract, but only the authenticated team's live score, contract progress, boat results and payments. The last-resolution summary shows each ground's stock before and after, its total catch and its regrowth, but not how many boats paid there (the stored history keeps that). Opponents' scores are sent only through the live/frozen standings, which also feed the in-game leaderboard. The freeze hides the leaderboard, not the game: stock is public by design, so each ground's catch is visible (and mostly follows from its stock anyway), and with public boat positions and equal splitting a determined team that records every resolution can estimate other teams' catches and scores during the final five minutes, and often tell when a boat could not pay. Keeping scores truly secret would mean hiding stock. Team ordering is alphabetical rather than score-based. Admin always reads actual scores, and the end screen still only says “Competition over.”

## The Commons

The game is split so the rules can be tested and simulated without a server. `rules.ts` holds pure functions over a plain `MatchState` (grounds, and per team its Research, two boats, score and contract): `resolve()` applies one resolution (move or pay, catch with equal splitting, contract progress, regrowth) and returns the new state and a report. `config.ts` holds every balancing value. `commons.ts` maps the state to SQLite, schedules resolutions, validates orders and contracts, records history and projects the public `GameState`. `bots.ts` and `simulate.ts` drive `resolve()` with bot teams that see only public information; the bots forecast with the same `qualifies`, `fishedByRivals` and `catchEach` helpers from `rules.ts` that `resolve()` uses, so a forecast cannot drift from the rules. Rules never change with team count; only `groundCount` does. To change the game, adjust `config.ts` first and check it with `npm run simulate`; change `rules.ts` (and its tests) only for new rules.

Keep team sessions, age tracks, question grading and Research earning intact. Game actions receive an authenticated team ID and are validated against authoritative state in one transaction.

## Operational limits

Designed for one small event and one server process. There is no question editor UI, detailed answer history or student identity. The only leaderboard is The Commons score. Question order is file-based, so freeze the bank while an event runs. Reset/age-change actions should be performed between rounds while students are not submitting answers. Larger deployments may need migrations, durable action IDs, push synchronisation, stronger admin identity and more formal audit logging.
