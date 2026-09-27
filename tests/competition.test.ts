import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { answerReward } from '../shared/scoring.js'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/db.js'
import { loadQuestions, isCorrect, parseNumber, type Question } from '../server/questions.js'
import { subjects, ages, type TeamState, type AdminTeam, type CompetitionState } from '../shared/domain.js'
const bank = loadQuestions('./questions')
const answerFor = (q: Question) => q.type === 'multiple-choice' ? String(q.correctIndex) : q.type === 'text' ? q.acceptedAnswers[0] : String(q.numericAnswer)
test('bank has 300 unique, valid questions and all answer types in every track', () => {
  const ids = new Set<string>()
  for (const s of subjects) for (const age of ages) {
    const track = bank[s][age]; assert.equal(track.length, 20)
    assert.equal(new Set(track.map(q => q.type)).size, 3)
    for (const q of track) { assert(!ids.has(q.id)); ids.add(q.id); assert(isCorrect(q, answerFor(q))) }
  }
  assert.equal(ids.size, 300)
})
test('exact grading normalises only permitted differences', () => {
  const text: Question = { id: 't', prompt: 'Name it', type: 'text', reward: 10, acceptedAnswers: ['cell membrane'], ignorePunctuation: false }
  assert(isCorrect(text, '  CELL   Membrane  ')); assert(!isCorrect(text, 'plasma membrane')); assert(!isCorrect(text, 'cell membrane.'))
  assert(isCorrect({ ...text, ignorePunctuation: true }, 'Cell membrane.'))
  const numeric: Question = { id: 'n', prompt: 'Number', type: 'numerical', reward: 10, numericAnswer: 9.81, tolerance: .02 }
  assert(isCorrect(numeric, '9.83')); assert(!isCorrect(numeric, '9.84'))
  assert(isCorrect({ ...numeric, numericAnswer: 5, tolerance: 0 }, '5.0'))
  for (const bad of ['', ' ', '0x10', 'Infinity', '5kg', '1,000']) assert.equal(parseNumber(bad), null)
})
test('startup rejects malformed files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fieldwork-bank-'))
  try { cpSync('./questions', dir, { recursive: true }); const path = join(dir, 'physics.json'); const data = JSON.parse(readFileSync(path, 'utf8')); data.tracks['11–13'][0].correctIndex = 99; writeFileSync(path, JSON.stringify(data)); assert.throws(() => loadQuestions(dir), /Invalid question file/) } finally { rmSync(dir, { recursive: true, force: true }) }
})
test('competition API: multi-device atomic scoring, game, admin and restart persistence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fieldwork-db-')), path = join(dir, 'test.sqlite')
  let db = openDatabase(path)
  let server = createApp(db, bank, 'test-password').listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  let base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`
  async function request<T = Record<string, unknown>>(url: string, cookie = '', body?: unknown, method = 'POST') {
    const response = await fetch(base + url, { method: body === undefined ? 'GET' : method, headers: { 'Content-Type': 'application/json', 'X-Competition-Client': '1', Cookie: cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json() as T, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' }
  }
  const close = () => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()))
  try {
    assert.equal((await request('/admin/teams')).status, 401)
    assert.equal((await request('/team/login', '', { code: 'NOPE' })).status, 401)
    const admin = (await request('/admin/login', '', { password: 'test-password' })).cookie
    assert(admin.includes('science_admin'))
    const create = await request<{ id: string }>('/admin/teams', admin, { name: 'Photon Pigeons', age: '11–13', code: 'K7MP' }); assert.equal(create.status, 201)
    assert.equal((await request('/admin/teams', admin, { name: 'Duplicate', age: '11–13', code: 'k7mp' })).status, 409)
    const other = await request<{ id: string }>('/admin/teams', admin, { name: 'Older Team', age: '17–18', code: 'OLD7' })
    const a = await request<TeamState>('/team/login', '', { code: ' k7mp ' }), b = await request<TeamState>('/team/login', '', { code: 'K7MP' }), c = await request<TeamState>('/team/login', '', { code: 'OLD7' })
    assert.equal(a.status, 200); assert.notEqual(a.cookie, b.cookie); assert.equal(a.body.team.id, b.body.team.id)
    assert.equal(a.body.competition.status, 'waiting')
    assert(subjects.every(subject => a.body.progress[subject].question === null))
    assert.equal((await request('/admin/start', a.cookie, {})).status, 401)
    assert.equal((await request('/team/answer', a.cookie, { subject: 'physics', questionId: bank.physics['11–13'][0].id, answer: answerFor(bank.physics['11–13'][0]) })).status, 409)
    assert.equal((await request('/team/skip', a.cookie, { subject: 'physics', questionId: bank.physics['11–13'][0].id })).status, 409)
    assert.equal((await request('/team/game/move', a.cookie, { x: 1, y: 0, fromX: 0, fromY: 0 })).status, 409)
    assert.equal((await request('/team/game/mine', a.cookie, { x: 0, y: 0 })).status, 409)
    assert.equal(a.body.game.cells.length, 144)
    assert(a.body.game.cells.every(cell => cell.stock === 3))
    const starts = await Promise.all([request<CompetitionState>('/admin/start', admin, {}), request<CompetitionState>('/admin/start', admin, {})])
    assert.deepEqual(starts.map(r => r.status).sort(), [200, 409])
    const clock = (await request<CompetitionState>('/competition')).body
    assert.equal(clock.endsAt! - clock.startedAt!, 2700000)
    assert.equal(clock.booklets.ess, '')
    assert(clock.booklets.physics.startsWith('https://'))
    assert.notEqual((await request<TeamState>('/team/state', a.cookie)).body.progress.physics.question!.id, (await request<TeamState>('/team/state', c.cookie)).body.progress.physics.question!.id)
    const publicJson = JSON.stringify(a.body); for (const privateKey of ['correctIndex', 'acceptedAnswers', 'numericAnswer', 'tolerance', 'K7MP']) assert(!publicJson.includes(privateKey))
    const answer = (subject: typeof subjects[number], q: Question, cookie = a.cookie, value = answerFor(q)) => request<{ correct: boolean; awarded: number; state: TeamState }>('/team/answer', cookie, { subject, questionId: q.id, answer: value })
    const q = bank.physics['11–13'][0]
    assert.equal((await answer('physics', q)).body.awarded, 10)
    const state = (await request<TeamState>('/team/state', b.cookie)).body
    assert.equal(state.progress.physics.completed, 1); assert.equal(state.progress.chemistry.completed, 0); assert.equal(state.team.research, 10)
    assert.equal((await answer('physics', q, b.cookie)).status, 409)
    const simultaneous = await Promise.all([answer('chemistry', bank.chemistry['11–13'][0]), answer('biology', bank.biology['11–13'][0], b.cookie)])
    assert(simultaneous.every(r => r.status === 200))
    let current = (await request<TeamState>('/team/state', a.cookie)).body
    assert.equal(current.team.research, 30); assert.equal(current.progress.chemistry.completed, 1); assert.equal(current.progress.biology.completed, 1)
    const same = await Promise.all([answer('physics', bank.physics['11–13'][1]), answer('physics', bank.physics['11–13'][1], b.cookie)])
    assert.deepEqual(same.map(r => r.status).sort(), [200, 409])
    const cs = bank['computer-science']['11–13'][0]; assert(cs.type === 'multiple-choice')
    await answer('computer-science', cs, a.cookie, String((cs.correctIndex + 1) % cs.choices.length))
    assert.equal((await answer('computer-science', cs, b.cookie)).body.awarded, 0)
    const cs2 = bank['computer-science']['11–13'][1]; assert(cs2.type === 'multiple-choice')
    for (let i = 0; i < 2; i++) await answer('computer-science', cs2, a.cookie, String((cs2.correctIndex + 1) % cs2.choices.length))
    assert.equal((await answer('computer-science', cs2, b.cookie, String((cs2.correctIndex + 1) % cs2.choices.length))).body.awarded, -5)
    assert.equal((await answer('computer-science', cs2)).body.awarded, -5)
    const olderQuestion = bank.physics['17–18'][0]; assert(olderQuestion.type === 'multiple-choice')
    for (let i = 0; i < 3; i++) await answer('physics', olderQuestion, c.cookie, String((olderQuestion.correctIndex + 1) % olderQuestion.choices.length))
    assert.equal((await request<TeamState>('/team/state', c.cookie)).body.team.research, -5)
    assert.equal((await answer('physics', olderQuestion, c.cookie)).body.awarded, -5)
    assert.equal((await request<TeamState>('/team/state', c.cookie)).body.team.research, -10)
    const numberQ = bank.physics['11–13'][2]
    assert.equal((await answer('physics', numberQ, a.cookie, 'oops')).status, 400)
    assert.equal((await request<TeamState>('/team/state', a.cookie)).body.progress.physics.attempts, 0)
    assert.equal((await answer('physics', numberQ, a.cookie, '999')).body.awarded, 0)
    assert.equal((await answer('physics', numberQ, b.cookie, '5.0')).body.awarded, 5)
    await answer('physics', bank.physics['11–13'][3], a.cookie, 'friction')
    await answer('physics', bank.physics['11–13'][3], b.cookie, 'magnetism')
    assert.equal((await answer('physics', bank.physics['11–13'][3], a.cookie, '  GRAVITY  ')).body.awarded, 0)
    for (let i = 0; i < 3; i++) assert.equal((await request('/team/skip', b.cookie, { subject: 'ess', questionId: bank.ess['11–13'][i].id })).status, 200)
    assert.equal((await request('/team/skip', a.cookie, { subject: 'ess', questionId: bank.ess['11–13'][3].id })).status, 400)
    current = (await request<TeamState>('/team/state', a.cookie)).body
    const beforeMove = current.team.research
    assert.equal((await request('/team/game/move', a.cookie, { x: 1, y: 1, fromX: 0, fromY: 0 })).status, 400)
    assert.equal((await request('/team/game/move', a.cookie, { x: 1, y: 0, fromX: 0, fromY: 0 })).status, 200)
    assert.equal((await request('/team/game/move', b.cookie, { x: 1, y: 0, fromX: 0, fromY: 0 })).status, 409)
    const observed = (await request<TeamState>('/team/state', c.cookie)).body.game.teams.find(t => t.id === create.body.id)!
    assert.equal(observed.x, 1); assert.equal(observed.y, 0)
    assert.equal((await request<TeamState>('/team/state', b.cookie)).body.team.research, beforeMove - 1)
    assert.equal((await request('/team/game/move', c.cookie, { x: 2, y: 0, fromX: 1, fromY: 0 })).status, 400)
    assert.equal((await request('/team/game/mine', a.cookie, { x: 0, y: 0 })).status, 409)
    assert.equal((await request('/team/game/mine', a.cookie, { x: 1, y: 0, amount: 100 })).status, 400)
    assert.equal((await request('/team/game/mine', a.cookie, { x: -1, y: 0 })).status, 400)
    assert.equal((await request('/team/game/mine', a.cookie, { x: 1, y: 0 })).status, 200)
    const mined = (await request<TeamState>('/team/state', b.cookie)).body
    assert.equal(mined.game.diamonds, 1)
    assert.equal(mined.game.cells.find(cell => cell.x === 1 && cell.y === 0)!.stock, 2)
    assert.equal(mined.team.research, beforeMove - 1)
    assert.equal((await request('/team/game/mine', b.cookie, { x: 1, y: 0 })).status, 200)
    const lastDiamond = await Promise.all([
      request('/team/game/mine', a.cookie, { x: 1, y: 0 }),
      request('/team/game/mine', c.cookie, { x: 1, y: 0 }),
    ])
    assert.deepEqual(lastDiamond.map(r => r.status).sort(), [200, 400])
    const contested = (await request<TeamState>('/team/state', c.cookie)).body
    assert.equal(contested.game.cells.find(cell => cell.x === 1 && cell.y === 0)!.stock, 0)
    assert.equal(contested.standings.teams.reduce((total, team) => total + team.diamonds, 0), 3)
    assert.equal((await request('/team/game/mine', b.cookie, { x: 1, y: 0 })).status, 400)
    // Free mining is allowed even with negative Research; only movement spends it.
    assert.equal(contested.team.research, -10)
    assert.equal((await request<AdminTeam[]>('/admin/teams', admin)).body.reduce((sum, team) => sum + team.diamonds, 0), 3)
    const saved = (await request<TeamState>('/team/state', a.cookie)).body
    await close(); db.close(); db = openDatabase(path); server = createApp(db, bank, 'test-password').listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`
    const restored = (await request<TeamState>('/team/state', a.cookie)).body
    assert.deepEqual({ ...restored, competition: { ...restored.competition, serverNow: 0 } }, { ...saved, competition: { ...saved.competition, serverNow: 0 } })
    assert.equal((await request<AdminTeam[]>('/admin/teams', admin)).body.length, 2)
    await request(`/admin/teams/${other.body.id}`, admin, { name: 'Renamed', age: '14–16', code: 'NEW7' }, 'PUT')
    assert.equal((await request<TeamState>('/team/state', c.cookie)).body.team.name, 'Renamed')
    assert.equal((await request('/team/login', '', { code: 'OLD7' })).status, 401)
    db.prepare("UPDATE config SET value = ? WHERE key = 'started_at'").run(String(Date.now() - 2700001))
    assert.equal((await request<CompetitionState>('/competition')).body.status, 'finished')
    const atEnd = (await request<TeamState>('/team/state', a.cookie)).body
    assert(subjects.every(subject => atEnd.progress[subject].question === null))
    assert.equal((await answer('physics', bank.physics['11–13'][4])).status, 409)
    assert.equal((await request('/team/skip', a.cookie, { subject: 'physics', questionId: bank.physics['11–13'][4].id })).status, 409)
    assert.equal((await request('/team/game/move', a.cookie, { x: 2, y: 0, fromX: 1, fromY: 0 })).status, 409)
    assert.equal((await request('/team/game/mine', a.cookie, { x: 1, y: 0 })).status, 409)
    assert.equal((await request('/admin/start', admin, {})).status, 409)
    assert.equal((await request<TeamState>('/team/state', a.cookie)).body.team.research, atEnd.team.research)
    assert.equal((await request('/admin/reset', admin, { confirmation: 'no' })).status, 400)
    assert.equal((await request('/admin/reset', admin, { confirmation: 'RESET' })).status, 200)
    const reset = (await request<TeamState>('/team/state', a.cookie)).body
    assert.equal(reset.competition.status, 'waiting'); assert.equal(reset.competition.startedAt, null)
    assert.equal(reset.team.research, 0); assert.equal(reset.team.earned, 0); assert.equal(reset.team.skipsUsed, 0)
    assert(subjects.every(s => reset.progress[s].completed === 0))
    assert(reset.game.cells.every(cell => cell.stock === 3))
    assert(reset.standings.teams.every(team => team.diamonds === 0))
    await request(`/admin/teams/${create.body.id}`, admin, {}, 'DELETE')
    assert.equal((await request('/team/state', a.cookie)).status, 401)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grid_scores WHERE team_id = ?').get(create.body.id)!.n, 0)
  } finally { await close(); db.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('all retry scoring tiers, including repeated penalties and custom open rewards', () => {
  for (const correct of [true, false]) {
    assert.equal(answerReward('multiple-choice', 99, 0, correct), correct ? 10 : 0)
    assert.equal(answerReward('multiple-choice', 99, 1, correct), 0)
    for (const attempts of [2, 3, 8]) assert.equal(answerReward('multiple-choice', 99, attempts, correct), -5)
    for (const type of ['text', 'numerical'] as const) {
      assert.equal(answerReward(type, 14, 0, correct), correct ? 14 : 0)
      assert.equal(answerReward(type, 14, 1, correct), correct ? 7 : 0)
      assert.equal(answerReward(type, 14, 2, correct), 0)
    }
  }
})

test('legacy database migration preserves teams, progress, sessions and positions while permitting debt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'competition-migration-')), path = join(dir, 'legacy.sqlite')
  const old = new DatabaseSync(path)
  old.exec(`
    CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, age TEXT NOT NULL, code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      research REAL NOT NULL DEFAULT 0 CHECK(research >= 0), earned REAL NOT NULL DEFAULT 0,
      skips_used INTEGER NOT NULL DEFAULT 0 CHECK(skips_used BETWEEN 0 AND 3), color TEXT NOT NULL);
    CREATE TABLE progress (team_id TEXT REFERENCES teams(id) ON DELETE CASCADE, subject TEXT, completed INTEGER, attempts INTEGER, PRIMARY KEY(team_id, subject));
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, team_id TEXT REFERENCES teams(id) ON DELETE CASCADE, role TEXT, expires INTEGER);
    CREATE TABLE grid_positions (team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE, x INTEGER, y INTEGER);
    INSERT INTO teams VALUES ('t', 'Existing team', '14–16', 'ABCD', 2, 30, 1, '#176b58');
    INSERT INTO progress VALUES ('t', 'physics', 3, 2);
    INSERT INTO sessions VALUES ('hash', 't', 'team', 9999999999999);
    INSERT INTO grid_positions VALUES ('t', 4, 5);
  `)
  old.close()
  const db = openDatabase(path)
  try {
    assert.equal(db.prepare('SELECT completed FROM progress').get()!.completed, 3)
    assert.equal(db.prepare('SELECT token_hash FROM sessions').get()!.token_hash, 'hash')
    assert.equal(db.prepare('SELECT x FROM grid_positions').get()!.x, 4)
    db.prepare('UPDATE teams SET research = research - 5').run()
    assert.equal(db.prepare('SELECT research FROM teams').get()!.research, -3)
    assert.equal(db.prepare('SELECT earned FROM teams').get()!.earned, 30)
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
    db.prepare('DELETE FROM teams').run()
    for (const table of ['sessions', 'progress', 'grid_positions']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n, 0)
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('revised numerical questions use the requested units and quantities', () => {
  const checks: [typeof subjects[number], typeof ages[number], number, number][] = [
    ['physics', '14–16', 12, 20 / (50 / 10000)],
    ['physics', '17–18', 6, .5 * 200 * (.2 ** 2 - .1 ** 2)],
    ['physics', '17–18', 19, .5 * 2 * 5 ** 2 + .5 * 3 * 1 ** 2 - .5 * 5 * 1.4 ** 2],
    ['biology', '17–18', 3, 1000 * 2 * .3],
    ['biology', '17–18', 5, (18 - 6) / (2 * 60)],
    ['biology', '17–18', 8, 2 / 3],
    ['biology', '17–18', 19, (960 - 60) / 3 - 1],
    ['chemistry', '17–18', 13, (436 + 243 - 2 * 431) / 2],
    ['chemistry', '17–18', 20, .04 * .1 / 2 * 98],
    ['ess', '14–16', 19, (1000 - 150) * 1.12],
    ['ess', '17–18', 19, (1000 - 600 - 350) / 1000 * 2 * 1000000],
    ['ess', '17–18', 20, 700 + .5 * 700 * (1 - 700 / 1000) - 100],
  ]
  for (const [subject, age, number, answer] of checks) assert(isCorrect(bank[subject][age][number - 1], String(answer)), `${subject} ${age} Q${number}`)
})

test('standings freeze before the first post-cutoff action, persist across restart, and keep admin live', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'standings-')), path = join(dir, 'test.sqlite')
  let db = openDatabase(path)
  let server = createApp(db, bank, 'test-password').listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  let base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`
  async function call(url: string, cookie = '', body?: unknown, method = 'POST') {
    const response = await fetch(base + url, { method: body === undefined ? 'GET' : method, headers: { 'Content-Type': 'application/json', 'X-Competition-Client': '1', Cookie: cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    assert(response.ok, `${url}: ${response.status}`)
    return { data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] || '' }
  }
  const close = () => new Promise<void>(resolve => server.close(() => resolve()))
  try {
    const admin = (await call('/admin/login', '', { password: 'test-password' })).cookie
    const aId = (await call('/admin/teams', admin, { name: 'Alpha', age: '11–13', code: 'AAAA' })).data.id as string
    const bId = (await call('/admin/teams', admin, { name: 'Beta', age: '11–13', code: 'BBBB' })).data.id as string
    const a = (await call('/team/login', '', { code: 'AAAA' })).cookie
    const b = (await call('/team/login', '', { code: 'BBBB' })).cookie
    await call('/admin/start', admin, {})
    await call('/team/game/mine', a, { x: 0, y: 0 })
    await call('/team/game/mine', b, { x: 1, y: 0 })
    await call('/team/game/mine', b, { x: 1, y: 0 })
    const before = (await call('/team/state', a)).data as TeamState
    assert.equal(before.standings.frozenAt, null)
    assert.deepEqual(before.standings.teams.map(t => [t.id, t.diamonds]), [[bId, 2], [aId, 1]])
    const start = Date.now() - 40 * 60 * 1000 - 1
    db.prepare("UPDATE config SET value = ? WHERE key = 'started_at'").run(String(start))
    // No standings read occurs at the cutoff: a score-changing action is first.
    const after = (await call('/team/game/mine', b, { x: 1, y: 0 })).data as TeamState
    assert.equal(after.game.diamonds, 3)
    assert.equal(after.standings.frozenAt, start + 40 * 60 * 1000)
    assert.deepEqual(after.standings.teams, before.standings.teams)
    assert(after.game.teams.every(team => !Object.hasOwn(team, 'diamonds')))
    await call('/team/game/mine', a, { x: 0, y: 0 })
    const later = (await call('/team/state', a)).data as TeamState
    assert.equal(later.game.diamonds, 2)
    assert.deepEqual(later.standings, after.standings)
    const adminTeams = (await call('/admin/teams', admin)).data as AdminTeam[]
    assert.equal(adminTeams.find(t => t.id === aId)!.diamonds, 2)
    assert.equal(adminTeams.find(t => t.id === bId)!.diamonds, 3)
    await close(); db.close(); db = openDatabase(path)
    server = createApp(db, bank, 'test-password').listen(0, '127.0.0.1')
    await new Promise<void>(resolve => server.once('listening', resolve))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`
    const freshLogin = (await call('/team/login', '', { code: 'AAAA' })).data as TeamState
    assert.deepEqual(freshLogin.standings, after.standings)
    await call(`/admin/teams/${bId}`, admin, { name: 'Renamed', age: '11–13', code: 'BBBB' }, 'PUT')
    await call(`/admin/teams/${bId}`, admin, {}, 'DELETE')
    assert.deepEqual(((await call('/team/state', a)).data as TeamState).standings, after.standings)
    await call('/admin/reset', admin, { confirmation: 'RESET' })
    const reset = (await call('/team/state', a)).data as TeamState
    assert.equal(reset.standings.frozenAt, null)
    assert.equal(reset.standings.teams.length, 1)
    assert.equal(reset.standings.teams[0].diamonds, 0)
    await call('/admin/start', admin, {})
    await call('/team/game/mine', a, { x: 0, y: 0 })
    assert.equal(((await call('/team/state', a)).data as TeamState).standings.teams[0].diamonds, 1)
  } finally { await close(); db.close(); rmSync(dir, { recursive: true, force: true }) }
})
