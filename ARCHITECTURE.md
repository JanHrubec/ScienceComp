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
| `server/game/rules.ts` | The Commons: pure, deterministic map, movement and tick rules (no database or UI) |
| `server/game/config.ts` | Every balancing value |
| `server/game/commons.ts` | Game tables, lazy tick scheduling, orders, history and public projection |
| `server/game/bots.ts` | Bot teams (thoughtful planner and rules of thumb) for the simulation |
| `server/game/simulate.ts` | `npm run simulate`: bot experiments for the balance risks, a PASS/CHECK scorecard, and calibration from a rehearsal's match history |
| `src/i18n.ts` | English/Czech UI strings and browser-local language preference |
| `src/components/LanguageSwitcher.vue` | Compact shared language selector |
| `src/state.ts` | Shared snapshot and stale-poll protection |
| `src/views/ParticipantView.vue` | Persistent header, Questions/Game/Standings tabs (the Game tab flags a golden school or an idle boat), polling |
| `src/views/QuestionsView.vue` | Subject switching, answers, feedback, skips |
| `src/components/CommonsGame.vue` | The Commons screen: score and fuel, the SVG sea map, the school list, leaderboard |
| `src/views/StandingsView.vue` | Third tab with all team scores and freeze indicator |
| `src/components/TeamScores.vue` | Score table for Standings and the in-game leaderboard |
| `server/game/standings.ts` | Lazy catch-up (due ticks and the five-minute snapshot, in order), live rankings and the persisted snapshot |
| `src/views/AdminView.vue` | Team management, progress table, reset confirmation |
| `questions/*.json` | Editable content; see `questions/README.md` |

## Database

Tables are created on startup with foreign keys and WAL enabled.

- **teams**: UUID, display name, age category, unique case-insensitive code, Research balance (may be negative), net question score including penalties, global skips used, identifying colour.
- **progress**: one row per team/subject, completed count and current-question failed-attempt count. Completed includes skipped questions. The count indexes the team's age-specific track.
- **sessions**: SHA-256 hash of a cryptographically random token, team ID (null for admin), role, seven-day expiry. Expired rows are cleaned during login.
- **commons_match**: at most one row: the tick reached and the match as JSON (seed, map, schools, pending respawns, and each boat's position, order, haul progress and fuel burnt). Created when the match starts. Research is not copied into it: it stays in `teams`, and each tick reads and debits it there.
- **commons_teams**: one row per team: fish caught and golden points (`bonus`). Score is fish + bonus, separate from Research. A database from the three-ground Commons keeps its extra contract columns, unused.
- **commons_log**: the match history: every order (tick, team, destination), every golden-school event, and a per-minute sample of each team's Research, fuel burnt, fish and golden points.
- **config**: persistent start timestamp (`started_at`), last reset timestamp and optional JSON `standings_snapshot`. The end time is start + `DURATION_SECONDS`. Operational secrets remain in the environment.

Deleting teams cascades to progress, sessions and game scores; the deleted team's boat leaves the map at the next tick, and a team added mid-match gets a boat in the harbour (and the starting Research). Between rounds, initialization drops the tables of earlier minigames (the diamond prototype's `grid_*` tables and the three-ground Commons' `commons_grounds`, `commons_boats` and `commons_resolutions`) and any snapshot of their scores. A round of either that was started but never reset is not continued as the map game: initialization ends it (moving `started_at` back so the round is over), creates no map for it, keeps its tables, keeps its scores in `commons_teams` (counting a diamond round's final diamonds as fish, and turning its frozen standings, or without one its final diamonds, into the standings), and logs a reminder on every start until the organizer resets. Start creates a fresh map from the roster at that moment. Competition reset removes the match, its log and any kept old tables, and clears scores. Admin reset preserves the roster and sessions and removes the start timestamp, returning teams to waiting. A targeted migration removes the old non-negative Research constraint while preserving all related rows. The SQLite file, question files and environment configuration together define a deployment. No external database service or seed step is necessary.

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
| `POST /team/game/order` | `{school}` (a school's ID: the boat sails to it and follows it) or `{x, y}` (a sea tile) → set the team's boat order; fresh snapshot |
| `POST /admin/login` | `{password}` → admin cookie |
| `POST /admin/logout` | Revoke admin session |
| `GET /admin/teams` | Roster, codes, balances, net question scores, game score (fish + bonus), progress |
| `GET /admin/history` | Game configuration, the map, and the match log: orders, golden-school events and per-minute team samples (JSON download) |
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

All question, skip and game actions are rejected before start and at/after the 60-minute deadline. Team snapshots withhold question content outside play. Clients submit only boat orders, which are idempotent (last write wins). No client-supplied position, fuel, stock or score is trusted.

Game ticks are scheduled at start + n × 2 seconds (1,800 per match) and run lazily. Every request that reads or changes play state goes through `read()` or `change()` in `app.ts`, which bring the game up to date exactly once, as of one moment, and the response is built as of that moment, so it never mixes state from before and after a tick. A change plays each due tick, in order, inside its own `BEGIN IMMEDIATE` transaction before applying itself. A read first makes one small query without a lock and takes the write lock only when a tick or the standings snapshot is due, checking again once it holds it. With every device polling every 1.5 seconds, most polls do find a tick due: catching up one tick loads the match JSON, steps it and writes it back, which takes well under a millisecond. A tick therefore sees exactly the orders and Research committed before it ran, and an order or answer arriving between ticks applies from the next one. The stored tick count only moves forward, so repeated or concurrent catch-up is harmless; outcomes are identical whether or not anyone was connected at the scheduled moment, and a server that was down catches up the missed ticks on its first request. The tick itself is the pure `step()` in `rules.ts`, deterministic from the match seed. Snapshots are plain reads, run synchronously on the same connection.

Start needs no catch-up, since only a waiting competition can start. Reset deliberately skips it: it discards the match anyway, so it still works when a tick cannot run (corrupt stored data, a bug) and every other play request fails, and it does not replay a finished match only to delete it. Roster edits do catch up first and fail with it, rather than freeze wrong standings or leave overdue ticks to run against a roster they were not scheduled with. So does the admin roster read, but with a 500 rather than a 401, and the admin screen treats any answer but 401 as signed in, so its reset stays reachable after a reload or from another device.

Participant state and public competition state poll every 1.5 seconds; admin teams every 2 seconds. Standings are included in the team snapshot and therefore use the existing poll. The countdown advances locally using monotonic elapsed time since the last server timestamp, so device wall-clock differences do not affect it. Newer server timestamps replace older ones. Start/expiry/reset automatically switch participants between waiting, play and finished screens; hidden play views are unmounted. The finished screen only says “Competition over.”; scores remain visible in admin for the organizer to announce winners. A client polls again only after the prior poll finishes. Successful actions replace the snapshot immediately. A generation counter prevents an older pending poll from overwriting a newer action response or logout. Errors leave the screen usable, show connection feedback, and retry automatically. Requests time out after eight seconds. A timed-out mutation may have committed; clients refresh before retrying, and question IDs guard against ordinary duplicate submissions; game orders are idempotent. Game requests go one at a time: an order given while another is in flight waits on the device, only the latest waiting order is sent, and the status shows “Sending…” until the server confirms it. A failed order is not retried; the error is shown and the boat keeps the server's order. Boats and schools glide between tiles with a two-second CSS transition, so the map looks continuous between polls. Waiting orders belong to the session that gave them: when the device signs out, or a poll finds it signed in as another team (a login in another tab replaces the shared cookie), they are dropped and a game response still in flight is ignored, so nothing is sent or shown under the next session. Requests are not queued offline.

The participant router keeps play views mounted in KeepAlive. Subject selection and draft inputs survive Game switching; question advancement clears obsolete inputs. Sessions are cookies, not localStorage secrets. Polling is intentionally sufficient for a classroom event; it can later be replaced with SSE/WebSockets around the same state/action boundary.

## Standings freeze

With five minutes left, public standings are saved in `config.standings_snapshot`. Every competition mutation checks the cutoff within its transaction **before** changing scores or the roster. Reads also capture a due snapshot. Catch-up plays ticks scheduled up to the cutoff, takes the snapshot, then plays later ones, so the snapshot holds exactly the scores at the cutoff even if the first request comes minutes later; no background scheduler is needed. The snapshot includes names, colours and scores, and remains stable across reconnects, restarts and later admin roster edits. Reset deletes it.

Participant game data includes the map, every school's position and stock, and every team's boat, order and route, but only the authenticated team's live score, and each school's sailing distance from that team's boat. Research and scores of other teams are not sent; opponents' scores reach clients only through the live/frozen standings, which also feed the in-game leaderboard. The freeze hides the leaderboard, not the game: boats and schools are public by design, so a determined team that watched every catch could estimate other teams' scores during the final five minutes. Admin always reads actual scores, and the end screen still only says “Competition over.”

## The Commons

The game is split so the rules can be tested and simulated without a server. `rules.ts` holds pure functions over a plain `MatchState` (seed, tick, map, schools, pending respawns and one boat per team): `newMatch()` makes the map and schools from a seed, `step()` plays one tick (schools drift, boats sail and pay fuel, boats on schools haul and catch, emptied schools respawn, schools regrow, golden schools come and go) and reports what happened, and `distances()`/`route()` are the breadth-first sailing distances every boat follows, ties broken N, E, S, W so every client and the server agree. Randomness comes only from the seed and the tick number. `config.ts` holds every balancing value. `commons.ts` maps the state to SQLite, schedules ticks, validates orders, logs history and projects the public `GameState`. `bots.ts` and `simulate.ts` drive `step()` with bot teams that see only public information, with the same distance functions. To change the game, adjust `config.ts` first and check it with `npm run simulate`; change `rules.ts` (and its tests) only for new rules.

Keep team sessions, age tracks, question grading and Research earning intact. Game actions receive an authenticated team ID and are validated against authoritative state in one transaction.

## Operational limits

Designed for one small event and one server process. There is no question editor UI, detailed answer history or student identity. The only leaderboard is The Commons score. Question order is file-based, so freeze the bank while an event runs. Reset/age-change actions should be performed between rounds while students are not submitting answers. Larger deployments may need migrations, durable action IDs, push synchronisation, stronger admin identity and more formal audit logging.
