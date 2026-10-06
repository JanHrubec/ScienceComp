# Architecture

One Vue client and one Express process share TypeScript domain types. SQLite is the authority for every score, attempt, progress counter, session and game state. The frontend uses a small Vue reactive store rather than Pinia because only one team snapshot is shared. It does not perform grading or persist authoritative game data locally.

## Main files

| Location | Responsibility |
| --- | --- |
| `shared/domain.ts` | Public Team, QuestionProgress, GameState and TeamState types |
| `server/index.ts` | Environment configuration, question loading, server startup |
| `server/db.ts` | SQLite tables, transaction helper, API error |
| `server/competition.ts` | Shared start time, 45-minute duration and server-side play gate |
| `server/booklets.ts` | Subject booklet URLs; empty URL hides the link |
| `shared/scoring.ts` | Retry tiers used for UI previews and server-side awards |
| `src/competition.ts` | Shared server-synchronised countdown, independent of the device clock |
| `server/questions.ts` | Strict question schema, loading, private grading, public projection |
| `server/app.ts` | Authentication, team/admin API, atomic question actions, static hosting |
| `shared/commons.ts` | Pure fishing rules: regrowth, one resolution, contracts; no UI or database |
| `server/game/commons-config.ts` | Every game balancing value and the contract definitions |
| `server/game/commons.ts` | Game tables, timed resolution catch-up, orders, contracts, team projection, history |
| `scripts/simulate-commons.ts` | Balance simulation (`npm run simulate`) |
| `src/i18n.ts` | English/Czech UI strings and browser-local language preference |
| `src/components/LanguageSwitcher.vue` | Compact shared language selector |
| `src/state.ts` | Shared snapshot and stale-poll protection |
| `src/views/ParticipantView.vue` | Persistent header, Questions/Game/Standings tabs, polling |
| `src/views/QuestionsView.vue` | Subject switching, answers, feedback, skips |
| `src/components/CommonsGame.vue` | Game screen: boats, grounds, contracts, last resolution, compact leaderboard |
| `src/views/StandingsView.vue` | Third tab with all team scores and freeze indicator |
| `src/components/ScoreTable.vue` | Score table for Standings and the Game tab |
| `server/game/standings.ts` | Live rankings and the persisted five-minute snapshot |
| `src/views/AdminView.vue` | Team management, progress table, reset confirmation |
| `questions/*.json` | Editable content; see `questions/README.md` |

## Database

Tables are created on startup with foreign keys and WAL enabled.

- **teams**: UUID, display name, age category, unique case-insensitive code, Research balance (may be negative), net question score including penalties, global skips used, identifying colour.
- **progress**: one row per team/subject, completed count and current-question failed-attempt count. Completed includes skipped questions. The count indexes the team's age-specific track.
- **sessions**: SHA-256 hash of a cryptographically random token, team ID (null for admin), role, seven-day expiry. Expired rows are cleaned during login.
- **commons_grounds**: ground letter, display order, current stock, maximum and the team IDs that fished it in the previous resolution. Created at start (teams + 2).
- **commons_boats**: two rows per team: current location (null is port) and standing order (null is idle).
- **commons_teams**: one row per team with fish, contract bonus, active contract and its progress, and completed contract IDs.
- **commons_resolutions**: one JSON record per resolution number: each ground's stock before/caught/regrowth/after and who fished it, each boat's position, order, action and catch, Research paid and balance, contract progress and scores, plus team names. Enough to replay a match.
- **config**: persistent start timestamp (`started_at`), last reset timestamp and optional JSON `standings_snapshot`. The end time is start + `DURATION_SECONDS`. Operational secrets remain in the environment.

Deleting teams cascades to progress, sessions, boats and game scores; grounds and history are kept. Game initialization drops the old diamond-grid tables and inserts only missing team/boat rows, preserving an existing round. Competition reset deletes grounds and history and clears boats, contracts and scores; Start creates the grounds. Admin reset preserves the roster and sessions and removes the start timestamp, returning teams to waiting. A targeted migration removes the old non-negative Research constraint while preserving all related rows. The SQLite file, question files and environment configuration together define a deployment. No external database service or seed step is necessary.

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
| `POST /team/game/order` | `{boat, ground}` (ground letter or null for idle) → fresh snapshot |
| `POST /team/game/contract` | `{contract, current}` (contract ID or null to abandon; `current` must match the team's active contract) → fresh snapshot |
| `POST /admin/login` | `{password}` → admin cookie |
| `POST /admin/logout` | Revoke admin session |
| `GET /admin/teams` | Roster, codes, balances, net question scores, game scores, progress |
| `GET /admin/game/history` | Rules and every resolution record as a JSON download |
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

All question, skip and game actions are rejected before start and at/after the 45-minute deadline. Team snapshots withhold question content outside play. Game resolutions fall at fixed times (start + n × interval, the last exactly at the end). Every transaction, including snapshot reads, first resolves any that are due, in order, using the pure rules on the stored state, then stores the result and the resolution number. Because this precedes the request's own change, orders and Research are locked as of each resolution's time even when nobody was connected, and the numbered record makes each resolution happen once. Fishing debits Research inside the resolution, and a boat fishes only when the balance covers the cost. Clients send only boat orders and contract choices; no client-supplied catch, stock or score is trusted. Orders are last-write-wins; contract changes carry the expected current contract so a stale device gets 409 instead of abandoning a teammate's choice. Failed actions roll back. Snapshot reads run synchronously on the same connection.

Participant state and public competition state poll every 1.5 seconds; admin teams every 2 seconds. Standings are included in the team snapshot and therefore use the existing poll. The countdown advances locally using monotonic elapsed time since the last server timestamp, so device wall-clock differences do not affect it. Newer server timestamps replace older ones. Start/expiry/reset automatically switch participants between waiting, play and finished screens; hidden play views are unmounted. The finished screen only says “Competition over.”; game scores remain visible in admin for the organizer to announce winners. A client polls again only after the prior poll finishes. Successful actions replace the snapshot immediately. A generation counter prevents an older pending poll from overwriting a newer action response or logout. Errors leave the screen usable, show connection feedback, and retry automatically. Requests time out after eight seconds. A timed-out mutation may have committed; clients refresh before retrying, and question IDs/expected coordinates guard against ordinary duplicate submissions. Requests are not queued offline.

The participant router keeps play views mounted in KeepAlive. Subject selection and draft inputs survive Game switching; question advancement clears obsolete inputs. Sessions are cookies, not localStorage secrets. Polling is intentionally sufficient for a classroom event; it can later be replaced with SSE/WebSockets around the same state/action boundary.

## Standings freeze

With five minutes left, public standings are saved in `config.standings_snapshot`. Every competition mutation checks the cutoff within its transaction **before** changing scores or the roster. Reads also capture a due snapshot. When one request catches up resolutions on both sides of the cutoff, the snapshot is taken between them, so the frozen table holds exactly the scores after the last resolution before the cutoff; no background scheduler is needed. The snapshot includes names, colours and scores, and remains stable across reconnects, restarts and later admin roster edits. Reset deletes it.

Participant game data includes every team's boats, orders and active contract, but only the authenticated team's live score and contract progress. Opponents' totals are available exclusively through live/frozen standings, and rivals' catches in the last-resolution summary are withheld once frozen, so Game does not show an alternative live leaderboard after the freeze. Team ordering is alphabetical rather than score-based. Admin always reads actual scores, and the end screen still only says “Competition over.”

## The Commons

The game touches the rest of the app only through explicit hooks in `server/app.ts` (initialization, resolution catch-up in `competitionTransaction`, Start, team creation/age change/reset, the two game endpoints, admin scores and history), the `GameState`/`StandingsState` types, `server/game/standings.ts` for the score query, and the Game route in `src/main.ts`. Team sessions, age tracks, question grading and Research earning are unchanged; Research earned from questions is the only currency the game spends.

`shared/commons.ts` is pure: `resolve(match, rules)` takes plain data and returns the next state and a record, so tests, the simulation and history replay use the same code as the server. A contract is data built from two blocks (a catch counter with an optional ground, minimum-stock or quiet-water condition, or a variety counter), so new contracts need no code; their text is generated in both languages by `contractText` in `src/i18n.ts`. A contract naming a ground the match does not have is not offered. Teams added after Start get boats in port but do not change the ground count.

## Operational limits

Designed for one small event and one server process. There is no question editor UI, detailed answer history or student identity. The only leaderboard is the game score. Question order is file-based, so freeze the bank while an event runs. Reset/age-change actions should be performed between rounds while students are not submitting answers. Larger deployments may need migrations, durable action IDs, push synchronisation, stronger admin identity and more formal audit logging.
