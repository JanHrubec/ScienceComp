import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { answerReward } from '../shared/scoring.js'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/db.js'
import { loadQuestions, isCorrect, parseNumber, publicQuestion, type Question } from '../server/questions.js'
import { TEAM_SKIP_LIMIT, subjects, ages, type TeamState, type AdminTeam, type CompetitionState } from '../shared/domain.js'
const bank = loadQuestions('./questions')
const answerFor = (q: Question) => q.type === 'multiple-choice' ? String(q.correctIndex) : q.type === 'text' ? q.acceptedAnswers[0] : String(q.numericAnswer)
test('bank has 300 unique bilingual questions with all three answer types in every track', () => {
  const ids = new Set<string>()
  const answerTypes = new Set<string>()
  for (const s of subjects) for (const age of ages) {
    const track = bank[s][age]; assert.equal(track.length, 20)
    assert(track.some(q => q.type === 'numerical'))
    assert(track.some(q => q.type === 'multiple-choice'))
    assert(track.some(q => q.type === 'text'))
    for (const q of track) { assert(!ids.has(q.id)); ids.add(q.id); assert(isCorrect(q, answerFor(q)))
      answerTypes.add(q.type)
      assert(q.cs.prompt.length >= 10)
      if (q.type === 'text') for (const variant of q.cs.acceptedAnswers) assert(isCorrect(q, variant))
      if (q.type === 'multiple-choice') assert.equal(q.cs.choices.length, q.choices.length)
      const safe = JSON.stringify(publicQuestion(q))
      for (const key of ['acceptedAnswers', 'correctIndex', 'numericAnswer', 'tolerance']) assert(!safe.includes(key))
    }
  }
  assert.equal(ids.size, 300)
  assert.equal(answerTypes.size, 3)
})
test('exact grading normalises only permitted differences', () => {
  const text: Question = { id: 't', prompt: 'Name it', type: 'text', reward: 10, acceptedAnswers: ['cell membrane'], ignorePunctuation: false, cs: { prompt: 'Pojmenujte ji', acceptedAnswers: ['buněčná membrána', 'bunecna membrana'] } }
  assert(isCorrect(text, '  CELL   Membrane  ')); assert(!isCorrect(text, 'plasma membrane')); assert(!isCorrect(text, 'cell membrane.'))
  assert(isCorrect({ ...text, ignorePunctuation: true }, 'Cell membrane.'))
  const numeric: Question = { id: 'n', prompt: 'Number', type: 'numerical', reward: 10, numericAnswer: 9.81, tolerance: .02, cs: { prompt: 'Zadejte číslo' } }
  assert(isCorrect(numeric, '9.83')); assert(!isCorrect(numeric, '9.84'))
  assert(isCorrect({ ...numeric, numericAnswer: 5, tolerance: 0 }, '5.0'))
  assert(isCorrect(numeric, '9,81'))
  assert.equal(parseNumber(',5'), 0.5)
  assert.equal(parseNumber('1,5e2'), 150)
  assert(isCorrect(text, '  BUNĚČNÁ   MEMBRÁNA '))
  assert(isCorrect(text, 'bunecna membrana'))
  assert(isCorrect(text, 'buněčná membrána'.normalize('NFD')))
  assert(!isCorrect(text, 'membrána'))
  for (const bad of ['', ' ', '0x10', 'Infinity', '5kg', '1,2,3', '1.2,3']) assert.equal(parseNumber(bad), null)
})
test('startup rejects malformed files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fieldwork-bank-'))
  try { cpSync('./questions', dir, { recursive: true }); const path = join(dir, 'physics.json'); const data = JSON.parse(readFileSync(path, 'utf8')); data.tracks['11–13'][0].correctIndex = 99; writeFileSync(path, JSON.stringify(data)); assert.throws(() => loadQuestions(dir), /Invalid question file/) } finally { rmSync(dir, { recursive: true, force: true }) }
})
test('startup rejects missing Czech translations and mismatched choice counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bilingual-bank-'))
  try {
    cpSync('./questions', dir, { recursive: true })
    const path = join(dir, 'physics.json')
    const original = readFileSync(path, 'utf8')
    for (const mutate of [
      (q: Record<string, unknown>) => { delete q.cs },
      (q: Record<string, unknown>) => { q.cs = { prompt: 'Vyberte správnou možnost.', choices: ['Jedna', 'Dvě'] } },
    ]) {
      const data = JSON.parse(original)
      mutate(data.tracks['11–13'][0])
      writeFileSync(path, JSON.stringify(data))
      assert.throws(() => loadQuestions(dir), /Invalid question file/)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
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
    assert.equal((await request('/team/game/order', a.cookie, { boat: 1, ground: 0 })).status, 409)
    assert.equal((await request('/team/game/contract', a.cookie, { contract: 'survey', current: null })).status, 409)
    // Grounds are created when the match starts, from the roster at that moment.
    assert.equal(a.body.game.grounds.length, 0)
    assert.deepEqual(a.body.game.resolution, { done: 0, total: 20, nextAt: null })
    const starts = await Promise.all([request<CompetitionState>('/admin/start', admin, {}), request<CompetitionState>('/admin/start', admin, {})])
    assert.deepEqual(starts.map(r => r.status).sort(), [200, 409])
    const clock = (await request<CompetitionState>('/competition')).body
    assert.equal(clock.endsAt! - clock.startedAt!, 3600000)
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
    await answer('physics', bank.physics['11–13'][3], a.cookie, '999')
    await answer('physics', bank.physics['11–13'][3], b.cookie, '998')
    const thirdTry = await answer('physics', bank.physics['11–13'][3], a.cookie, '  DOLŮ  ')
    assert.equal(thirdTry.body.correct, true)
    assert.equal(thirdTry.body.awarded, 0)
    for (let i = 0; i < TEAM_SKIP_LIMIT - 1; i++) assert.equal((await request('/team/skip', b.cookie, { subject: 'ess', questionId: bank.ess['11–13'][i].id })).status, 200)
    // The last shared skip is contested by two devices in different subjects.
    const lastSkip = await Promise.all([
      request('/team/skip', a.cookie, { subject: 'ess', questionId: bank.ess['11–13'][4].id }),
      request('/team/skip', b.cookie, { subject: 'chemistry', questionId: bank.chemistry['11–13'][1].id }),
    ])
    assert.deepEqual(lastSkip.map(r => r.status).sort(), [200, 400])
    const afterSkips = (await request<TeamState>('/team/state', a.cookie)).body
    assert.equal(afterSkips.team.skipsUsed, 5)
    assert.equal((await request('/team/skip', b.cookie, { subject: 'ess', questionId: afterSkips.progress.ess.question!.id })).status, 400)
    current = (await request<TeamState>('/team/state', a.cookie)).body
    assert.equal(current.team.research, 35)
    // Two teams: four grounds at 8 of 12. Boats start in harbour, idle.
    assert.deepEqual(current.game.grounds.map(g => [g.name, g.biomass, g.maximum, g.growth]), [['A', 8, 12, 3], ['B', 8, 12, 3], ['C', 8, 12, 3], ['D', 8, 12, 3]])
    assert.deepEqual(current.game.teams.find(t => t.id === create.body.id)!.boats, [{ ground: null, order: null }, { ground: null, order: null }])
    for (const bad of [{ boat: 3, ground: 0 }, { boat: 1, ground: 4 }, { boat: 1, ground: -1 }, { boat: 1, ground: 0, research: 99 }]) assert.equal((await request('/team/game/order', a.cookie, bad)).status, 400)
    assert.equal((await request('/team/game/order', a.cookie, { boat: 1, ground: 0 })).status, 200)
    assert.equal((await request('/team/game/order', b.cookie, { boat: 2, ground: 0 })).status, 200)
    assert.equal((await request('/team/game/order', c.cookie, { boat: 1, ground: 0 })).status, 200)
    // Every order is public, including destinations of boats still in harbour.
    const observed = (await request<TeamState>('/team/state', c.cookie)).body.game
    assert.deepEqual(observed.teams.find(t => t.id === create.body.id)!.boats, [{ ground: null, order: 0 }, { ground: null, order: 0 }])
    assert.equal((await request('/team/game/contract', a.cookie, { contract: 'ground-a', current: null })).status, 200)
    // A device that has not seen its teammate's choice cannot silently replace it.
    assert.equal((await request('/team/game/contract', b.cookie, { contract: 'survey', current: null })).status, 409)
    assert.equal((await request('/team/game/contract', b.cookie, { contract: 'unknown', current: 'ground-a' })).status, 400)
    assert.equal((await request<TeamState>('/team/state', c.cookie)).body.game.teams.find(t => t.id === create.body.id)!.contract, 'ground-a')
    assert.equal((await request<TeamState>('/team/state', c.cookie)).body.game.own.contract, null)
    const startedAt = (await request<CompetitionState>('/competition')).body.startedAt!
    const rewind = (ms: number) => { const value = Number(db.prepare("SELECT value FROM config WHERE key = 'started_at'").get()!.value); db.prepare("UPDATE config SET value = ? WHERE key = 'started_at'").run(String(value - ms)) }
    // Resolution 1: everyone leaves harbour, nobody pays. Concurrent reads resolve it exactly once.
    rewind(180_000)
    const reads = await Promise.all([a, b, c, a, c].map(device => request<TeamState>('/team/state', device.cookie)))
    assert(reads.every(r => r.body.game.resolution.done === 1))
    assert.deepEqual(reads[0]!.body.game.last!.boats.map(r => r.action), ['travel', 'travel'])
    assert.deepEqual(reads[0]!.body.game.grounds.map(g => g.biomass), [11, 11, 11, 11])
    assert.equal(reads[0]!.body.team.research, 35)
    // Resolution 2: both boats fish at A and pay; the other team's boat cannot pay with negative Research.
    rewind(180_000)
    const fished = (await request<TeamState>('/team/state', b.cookie)).body
    assert.equal(fished.game.resolution.done, 2)
    assert.equal(fished.game.resolution.nextAt, startedAt - 360_000 + 3 * 180_000)
    assert.equal(fished.team.research, 25)
    assert.deepEqual(fished.game.last!.boats, [{ boat: 1, from: 0, order: 0, action: 'fish', paid: 5, caught: 2 }, { boat: 2, from: 0, order: 0, action: 'fish', paid: 5, caught: 2 }])
    assert.deepEqual(fished.game.last!.grounds[0], { id: 0, before: 11, caught: 4, growth: 3, after: 10, boats: 2 })
    assert.deepEqual(fished.game.own, { fish: 4, bonus: 0, contract: { id: 'ground-a', progress: 4 }, completed: [] })
    assert.deepEqual(fished.standings.teams.map(t => t.score), [4, 0])
    const rival = (await request<TeamState>('/team/state', c.cookie)).body
    assert.deepEqual(rival.game.last!.boats.map(r => r.action), ['unpaid', 'idle'])
    assert.equal(rival.team.research, -10)
    // Opponents' catches and Research stay out of the public game state.
    assert(!JSON.stringify(rival.game.teams).includes('research'))
    assert.equal(rival.game.last!.boats.length, 2)
    assert.equal((await request<AdminTeam[]>('/admin/teams', admin)).body.find(t => t.id === create.body.id)!.score, 4)
    // Abandoning loses progress; the contract can be taken again from zero.
    assert.equal((await request('/team/game/contract', b.cookie, { contract: null, current: 'ground-a' })).status, 200)
    assert.equal((await request('/team/game/contract', b.cookie, { contract: 'ground-a', current: null })).status, 200)
    assert.deepEqual((await request<TeamState>('/team/state', a.cookie)).body.game.own.contract, { id: 'ground-a', progress: 0 })
    const saved = (await request<TeamState>('/team/state', a.cookie)).body
    await close(); db.close(); db = openDatabase(path); server = createApp(db, bank, 'test-password').listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`
    const restored = (await request<TeamState>('/team/state', a.cookie)).body
    assert.deepEqual({ ...restored, competition: { ...restored.competition, serverNow: 0 } }, { ...saved, competition: { ...saved.competition, serverNow: 0 } })
    assert.equal((await request<AdminTeam[]>('/admin/teams', admin)).body.length, 2)
    await request(`/admin/teams/${other.body.id}`, admin, { name: 'Renamed', age: '14–16', code: 'NEW7' }, 'PUT')
    assert.equal((await request<TeamState>('/team/state', c.cookie)).body.team.name, 'Renamed')
    assert.equal((await request('/team/login', '', { code: 'OLD7' })).status, 401)
    db.prepare("UPDATE config SET value = ? WHERE key = 'started_at'").run(String(Date.now() - 3600001))
    assert.equal((await request<CompetitionState>('/competition')).body.status, 'finished')
    const atEnd = (await request<TeamState>('/team/state', a.cookie)).body
    assert(subjects.every(subject => atEnd.progress[subject].question === null))
    assert.equal((await answer('physics', bank.physics['11–13'][4])).status, 409)
    assert.equal((await request('/team/skip', a.cookie, { subject: 'physics', questionId: bank.physics['11–13'][4].id })).status, 409)
    assert.equal((await request('/team/game/order', a.cookie, { boat: 1, ground: 1 })).status, 409)
    assert.equal((await request('/team/game/contract', a.cookie, { contract: null, current: 'ground-a' })).status, 409)
    assert.equal((await request('/admin/start', admin, {})).status, 409)
    // The final resolution runs at the deadline; the history replays all of them.
    assert.equal(atEnd.game.resolution.done, 20)
    const history = (await request<{ resolutions: { number: number; before: { grounds: unknown[] }; report: { teams: { id: string; fish: number }[] } }[] }>('/admin/history', admin)).body
    assert.deepEqual(history.resolutions.map(r => r.number), Array.from({ length: 20 }, (_, i) => i + 1))
    assert.equal(history.resolutions[1]!.before.grounds.length, 4)
    assert.equal(history.resolutions.at(-1)!.report.teams.find(t => t.id === create.body.id)!.fish, atEnd.game.own.fish)
    assert.equal((await request('/admin/history', a.cookie)).status, 401)
    assert.equal((await request<TeamState>('/team/state', a.cookie)).body.team.research, atEnd.team.research)
    assert.equal((await request('/admin/reset', admin, { confirmation: 'no' })).status, 400)
    assert.equal((await request('/admin/reset', admin, { confirmation: 'RESET' })).status, 200)
    const reset = (await request<TeamState>('/team/state', a.cookie)).body
    assert.equal(reset.competition.status, 'waiting'); assert.equal(reset.competition.startedAt, null)
    assert.equal(reset.team.research, 0); assert.equal(reset.team.earned, 0); assert.equal(reset.team.skipsUsed, 0)
    assert(subjects.every(s => reset.progress[s].completed === 0))
    assert.equal(reset.game.grounds.length, 0)
    assert.equal(reset.game.resolution.done, 0)
    assert.equal(reset.game.last, null)
    assert.deepEqual(reset.game.own, { fish: 0, bonus: 0, contract: null, completed: [] })
    assert(reset.game.teams.every(team => team.contract === null && team.boats.every(boat => boat.ground === null && boat.order === null)))
    assert(reset.standings.teams.every(team => team.score === 0))
    assert.equal((await request<{ resolutions: unknown[] }>('/admin/history', admin)).body.resolutions.length, 0)
    await request(`/admin/teams/${create.body.id}`, admin, {}, 'DELETE')
    assert.equal((await request('/team/state', a.cookie)).status, 401)
    for (const table of ['commons_teams', 'commons_boats']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE team_id = ?`).get(create.body.id)!.n, 0)
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
  // These numbers are stable ID suffixes, not array positions. Calculate the
  // expected quantity independently to catch answer-key and unit mistakes.
  const checks: [typeof subjects[number], typeof ages[number], number, number][] = [
    ['computer-science', '14–16', 4, 50 - 20],
    ['ess', '11–13', 20, 80 * 2 - (60 * 2 + 10)],
    ['ess', '14–16', 10, 1200 - 1200 * .1 - 80],
    ['physics', '14–16', 3, 6 / (2000 / 1000)],
    ['computer-science', '14–16', 3, (7 + 3) - 7],
    ['computer-science', '17–18', 2, (24 + 8) * 8],
    ['computer-science', '17–18', 6, 3 * (1 + 2)],
    ['computer-science', '17–18', 15, (10 + 3 + 4) - 14],
    ['biology', '11–13', 2, 6 / (6 + 4) * 100],
    ['biology', '11–13', 15, (50 - 10 - 5) / 50 * 100],
    ['biology', '14–16', 5, (4.6 - 4) / 4 * 100],
    ['biology', '17–18', 13, (20 - 14) * 500 / 100],
    ['biology', '17–18', 14, (40 + 20 * 2) / ((40 + 40 + 20) * 2)],
    ['biology', '17–18', 16, (1500 - 600) * 5 * 2 / 1000],
    ['biology', '17–18', 20, (.5 * .5 + .5 * .5) * 160 * .75],
    ['chemistry', '11–13', 17, (54 - 52) / 4],
    ['chemistry', '14–16', 10, (40 / 20) * 2],
    ['chemistry', '14–16', 17, (200 * .05) / (200 - 50) * 100],
    ['chemistry', '17–18', 10, 2 + 1 + 1],
    ['ess', '11–13', 18, (1 - .2) * 100 - (1 - .8) * 100],
    ['ess', '14–16', 18, 200 * .7 * .5],
    ['ess', '17–18', 15, (10 + (4 - 1) * 5) / .5],
    ['physics', '11–13', 3, 60 / (10 + 2)],
    ['physics', '11–13', 13, (300 - 60) / 8],
    ['computer-science', '11–13', 3, 2 ** 2],
    ['computer-science', '14–16', 19, 2],
    ['biology', '14–16', 19, 24 / 2 + (24 / 2 + 1)],
    ['chemistry', '11–13', 11, 2 * 2 + 2],
    ['chemistry', '11–13', 13, 6 + 2],
    ['chemistry', '17–18', 3, 1200 * .5],
    ['physics', '11–13', 20, (2000 - 500) / 2000 * 100],
    ['physics', '14–16', 6, 8 / (12 / 3)],
    ['physics', '17–18', 7, (.004 * 3) + (.002 * 2)],
    ['computer-science', '11–13', 20, 3 + 4 * 2],
    ['computer-science', '17–18', 19, .8 * (1 - .1 ** 2) * 100],
    ['biology', '11–13', 4, 10 * 10 - 10 * 4],
    ['biology', '11–13', 20, (25 - 10 - 5) / 80 * 100],
    ['ess', '11–13', 17, (2 * (30 - 10) - 25 - 35) / 200 * 100],
    ['ess', '14–16', 13, (500 * .8 * 1.2 - 500) / 500 * 100],
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
    ['physics', '14–16', 15, (6 - 1) - (6 - 3)],
    ['physics', '17–18', 13, (1.2 / 3 * 2) * 250],
    ['physics', '17–18', 20, 5 / 2 - 2],
    ['computer-science', '17–18', 11, 4 + 7 + 7 + 4],
    ['chemistry', '17–18', 17, 2 ** 0 * .5 ** 2],
  ]
  for (const [subject, age, number, answer] of checks) {
    const id = `${subject}-${age.slice(0, 2)}-${String(number).padStart(2, '0')}`
    const question = bank[subject][age].find(q => q.id === id)
    assert(question, id)
    assert(isCorrect(question, String(answer)), id)
  }
})


test('reviewed questions reject common traps and incorrectly rounded hundredths', () => {
  const cases: [typeof subjects[number], typeof ages[number], number, string, string[]][] = [
    ['biology', '17–18', 13, '0.67', ['0.66', '0.68', '0.5']],
    ['chemistry', '14–16', 16, '6.67', ['6.66', '6.68', '5']],
    ['computer-science', '14–16', 5, '30', ['10', '20']],
    ['ess', '11–13', 19, '30', ['40', '10', '130']],
    ['physics', '17–18', 20, '0.5', ['3', '1', '5']],
    ['chemistry', '17–18', 16, '0.25', ['0.5', '1', '2']],
    ['computer-science', '17–18', 15, '22', ['15', '16', '28']],
  ]
  for (const [subject, age, position, correct, wrong] of cases) {
    const q = bank[subject][age][position - 1]
    assert.equal(q.type, 'numerical', q.id)
    assert(isCorrect(q, correct), q.id)
    assert(isCorrect(q, correct.replace('.', ',')), `${q.id}: decimal comma`)
    for (const answer of wrong) assert(!isCorrect(q, answer), `${q.id} must reject ${answer}`)
  }
})

test('short science answers accept explicit bilingual variants without accepting a different concept', () => {
  // Displayed positions, with real user input to exercise accents, formulas,
  // ordinary words and supplied labels as well as code output.
  const cases: [typeof subjects[number], typeof ages[number], number, string[], string[]][] = [
    ['physics', '11–13', 4, ['  DOWN  ', 'dolů', 'dolu'], ['up', 'nahoru', '7']],
    ['physics', '11–13', 10, ['melting', 'tání', 'tani'], ['boiling', 'var']],
    ['physics', '11–13', 19, ['A', 'a'], ['B', 'C']],
    ['biology', '11–13', 10, ['brown', 'hnědá', 'hneda'], ['green', 'zelená']],
    ['biology', '14–16', 18, ['B'], ['A', 'C']],
    ['biology', '17–18', 2, ['AUGCUU', 'augcuu'], ['TACGAA', 'AUGCTT']],
    ['chemistry', '11–13', 13, ['CO2', 'CO₂', 'oxid uhličitý', 'oxid uhlicity'], ['oxygen', 'kyslík']],
    ['chemistry', '17–18', 8, ['C2H4', 'C₂H₄', 'CH2=CH2'], ['C2H6']],
    ['chemistry', '17–18', 11, ['NH3', 'NH₃'], ['NH4+', 'HA']],
    ['ess', '14–16', 5, ['erosion', 'eroze', 'půdní eroze'], ['deposition', 'sedimentace']],
    ['ess', '17–18', 11, ['possible', 'možné', 'mozne'], ['certain', 'impossible', 'jisté']],
    ['computer-science', '17–18', 19, ['Karel', '  karel  '], ['Eva', 'Jan']],
  ]
  for (const [subject, age, position, accepted, rejected] of cases) {
    const q = bank[subject][age][position - 1]
    assert.equal(q.type, 'text', q.id)
    for (const answer of accepted) assert(isCorrect(q, answer), `${q.id}: ${answer}`)
    for (const answer of rejected) assert(!isCorrect(q, answer), `${q.id} must reject ${answer}`)
  }
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
    db.exec('UPDATE teams SET research = 100')
    // Alpha fishes alone at A; Beta puts both boats on B and fishes it down.
    await call('/team/game/order', a, { boat: 1, ground: 0 })
    for (const boat of [1, 2]) await call('/team/game/order', b, { boat, ground: 1 })
    const setStart = (value: number) => db.prepare("UPDATE config SET value = ? WHERE key = 'started_at'").run(String(value))
    setStart(Date.now() - 2 * 180_000 - 1000)
    const before = (await call('/team/state', a)).data as TeamState
    assert.equal(before.standings.frozenAt, null)
    assert.deepEqual(before.standings.teams.map(t => [t.id, t.score]), [[bId, 4], [aId, 2]])
    // Jump past the cutoff (55:00) and resolution 19 (57:00) with no request in between.
    // The first request is an order change: resolutions 3–18 count towards the
    // frozen standings, resolution 19 only towards the live scores.
    const start = Date.now() - 57 * 60 * 1000 - 1000
    setStart(start)
    const after = (await call('/team/game/order', a, { boat: 2, ground: 2 })).data as TeamState
    assert.equal(after.standings.frozenAt, start + 55 * 60 * 1000)
    assert.equal(after.game.resolution.done, 19)
    const history = (await call('/admin/history', admin)).data as { resolutions: { number: number; report: { teams: { id: string; fish: number; bonus: number }[] } }[] }
    const scoresAt = (n: number) => Object.fromEntries(history.resolutions[n - 1]!.report.teams.map(t => [t.id, t.fish + t.bonus]))
    assert.deepEqual(Object.fromEntries(after.standings.teams.map(t => [t.id, t.score])), scoresAt(18))
    // Alpha caught 2 at every resolution from the second; the order just given has not resolved.
    assert.equal(scoresAt(18)[aId], 34)
    assert.equal(after.game.own.fish, 36)
    assert(after.game.teams.every(team => !Object.hasOwn(team, 'score')))
    setStart(start - 3 * 60 * 1000)
    const later = (await call('/team/state', a)).data as TeamState
    assert.equal(later.game.resolution.done, 20)
    assert.equal(later.game.own.fish, 38)
    assert.deepEqual(later.standings, after.standings)
    const adminTeams = (await call('/admin/teams', admin)).data as AdminTeam[]
    assert.equal(adminTeams.find(t => t.id === aId)!.score, 38)
    const final = (await call('/admin/history', admin)).data as typeof history
    assert.equal(adminTeams.find(t => t.id === bId)!.score, final.resolutions[19]!.report.teams.find(t => t.id === bId)!.fish)
    await close(); db.close(); db = openDatabase(path)
    server = createApp(db, bank, 'test-password').listen(0, '127.0.0.1')
    await new Promise<void>(resolve => server.once('listening', resolve))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`
    const freshLogin = (await call('/team/login', '', { code: 'AAAA' })).data as TeamState
    assert.deepEqual(freshLogin.standings, after.standings)
    assert.equal(freshLogin.game.resolution.done, 20)
    await call(`/admin/teams/${bId}`, admin, { name: 'Renamed', age: '11–13', code: 'BBBB' }, 'PUT')
    await call(`/admin/teams/${bId}`, admin, {}, 'DELETE')
    assert.deepEqual(((await call('/team/state', a)).data as TeamState).standings, after.standings)
    await call('/admin/reset', admin, { confirmation: 'RESET' })
    const reset = (await call('/team/state', a)).data as TeamState
    assert.equal(reset.standings.frozenAt, null)
    assert.equal(reset.standings.teams.length, 1)
    assert.equal(reset.standings.teams[0].score, 0)
    await call('/admin/start', admin, {})
    // One team now: three grounds.
    assert.equal(((await call('/team/state', a)).data as TeamState).game.grounds.length, 3)
    await call('/team/game/order', a, { boat: 1, ground: 2 })
    // Without Research the boat arrives but cannot fish.
    setStart(Date.now() - 2 * 180_000 - 1000)
    assert.deepEqual(((await call('/team/state', a)).data as TeamState).game.last!.boats.map(r => r.action), ['unpaid', 'idle'])
    db.exec('UPDATE teams SET research = 5')
    setStart(Date.now() - 3 * 180_000 - 1000)
    assert.equal(((await call('/team/state', a)).data as TeamState).standings.teams[0].score, 2)
  } finally { await close(); db.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('a diamond-prototype database upgrades to The Commons without losing teams', () => {
  const dir = mkdtempSync(join(tmpdir(), 'commons-upgrade-')), path = join(dir, 'old.sqlite')
  let db = openDatabase(path)
  db.exec(`
    CREATE TABLE grid_positions (team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE, x INTEGER NOT NULL, y INTEGER NOT NULL);
    CREATE TABLE grid_cells (x INTEGER, y INTEGER, stock INTEGER, PRIMARY KEY(x, y));
    CREATE TABLE grid_scores (team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE, diamonds INTEGER);
    INSERT INTO teams (id, name, age, code, color) VALUES ('t', 'Existing team', '14–16', 'ABCD', '#176b58');
    INSERT INTO grid_positions VALUES ('t', 4, 5);
    INSERT INTO config VALUES ('standings_snapshot', '{"frozenAt":1,"teams":[{"id":"t","diamonds":3}]}');
  `)
  db.prepare("INSERT INTO config VALUES ('started_at', ?)").run(String(Date.now()))
  try {
    createApp(db, bank, 'test-password')
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => String(row.name))
    assert(!tables.some(name => name.startsWith('grid_')))
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM config WHERE key = 'standings_snapshot'").get()!.n, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commons_boats WHERE team_id = ?').get('t')!.n, 2)
    // A match already running when the update was installed gets its grounds.
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commons_grounds').get()!.n, 3)
    db.close(); db = openDatabase(path); createApp(db, bank, 'test-password')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commons_grounds').get()!.n, 3)
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})
