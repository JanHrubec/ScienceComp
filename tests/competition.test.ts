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
import { distance, type GameMap, type MatchState } from '../server/game/rules.js'
const bank = loadQuestions('./questions')
const answerFor = (q: Question) => q.type === 'multiple-choice' ? String(q.correctIndex) : q.type === 'text' ? q.acceptedAnswers[0] : String(q.numericAnswer)
async function serve(db: DatabaseSync) {
  const server = createApp(db, bank, 'test-password').listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`
  async function call<T = Record<string, unknown>>(url: string, cookie = '', body?: unknown, method = 'POST') {
    const response = await fetch(base + url, { method: body === undefined ? 'GET' : method, headers: { 'Content-Type': 'application/json', 'X-Competition-Client': '1', Cookie: cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json() as T, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' }
  }
  return { call, close: () => new Promise<void>(resolve => server.close(() => resolve())) }
}
// Pins the match clock halfway through tick `ticks` (2 s each), so a test step never crosses a tick.
const atTick = (db: DatabaseSync, ticks: number) => { const startedAt = Date.now() - ticks * 2000 - 1000; db.prepare("UPDATE config SET value = ? WHERE key = 'started_at'").run(String(startedAt)); return startedAt }
// Rewrites the stored match, for scenarios the random map would not set up.
function edit(db: DatabaseSync, change: (state: MatchState) => void) {
  const state = JSON.parse(String(db.prepare('SELECT state FROM commons_match').get()!.state)) as MatchState
  change(state); db.prepare('UPDATE commons_match SET state = ?').run(JSON.stringify(state))
}
interface History { samples: { tick: number; teams: { id: string; fish: number; bonus: number }[] }[]; orders: { tick: number; team: string; bait?: boolean }[] }
const scoreAt = (history: History, tick: number) => Object.fromEntries(history.samples.find(s => s.tick === tick)!.teams.map(t => [t.id, t.fish + t.bonus]))
// Records every transaction started on this connection.
function transactions(db: DatabaseSync) {
  const begins: string[] = [], exec = db.exec.bind(db)
  db.exec = (sql: string) => { if (sql.startsWith('BEGIN')) begins.push(sql); exec(sql) }
  return begins
}
test('bank has 360 unique bilingual questions with all three answer types in every track', () => {
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
  assert.equal(ids.size, 360)
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
    assert.equal((await request('/team/game/order', a.cookie, { school: 1 })).status, 409)
    // The map is made when the match starts, from the roster at that moment.
    assert.equal(a.body.game.map, null)
    assert.deepEqual(a.body.game.clock, { tick: 0, total: 1800 })
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
    assert.equal(state.progress.physics.completed, 1); assert.equal(state.progress.chemistry.completed, 0); assert.equal(state.team.research, 20)
    assert.equal((await answer('physics', q, b.cookie)).status, 409)
    const simultaneous = await Promise.all([answer('chemistry', bank.chemistry['11–13'][0]), answer('biology', bank.biology['11–13'][0], b.cookie)])
    assert(simultaneous.every(r => r.status === 200))
    let current = (await request<TeamState>('/team/state', a.cookie)).body
    assert.equal(current.team.research, 40); assert.equal(current.progress.chemistry.completed, 1); assert.equal(current.progress.biology.completed, 1)
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
    assert.equal((await request<TeamState>('/team/state', c.cookie)).body.team.research, 5)
    assert.equal((await answer('physics', olderQuestion, c.cookie)).body.awarded, -5)
    assert.equal((await request<TeamState>('/team/state', c.cookie)).body.team.research, 0)
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
    assert.equal(current.team.research, 45)
    // A fresh map: a fishing ground per team plus two, one golden ground, and both boats in the harbour.
    const game = current.game, map = game.map!, harbour = map.harbour
    assert(map.land.length === map.height && map.land.every(row => row.length === map.width))
    assert.deepEqual([game.schools.length, game.schools.filter(s => s.golden).length], [5, 1])
    assert(game.schools.every(s => s.home === distance(map as GameMap, s, harbour)))
    assert.deepEqual(game.boats.map(b => [b.name, b.x, b.y, b.target, b.route]), [['Older Team', harbour.x, harbour.y, null, []], ['Photon Pigeons', harbour.x, harbour.y, null, []]])
    const land = map.land.flatMap((row, y) => [...row].flatMap((cell, x) => cell === '#' ? [{ x, y }] : []))[0]!
    for (const bad of [{ x: -1, y: 0 }, { x: map.width, y: 0 }, land, { x: 0, y: 0, school: 1 }, {}, { boat: 1, ground: 0 }]) assert.equal((await request('/team/game/order', a.cookie, bad)).status, 400, JSON.stringify(bad))
    assert.deepEqual(await request('/team/game/order', a.cookie, { school: 999 }).then(r => [r.status, r.body.error]), [409, 'Choose a fishing ground on the map.'])
    assert.equal((await request('/team/game/order', a.cookie, { bait: 'yes' })).status, 400)
    // The bait switch is private and stays until changed.
    assert.deepEqual((await request<TeamState>('/team/game/order', a.cookie, { bait: true })).body.game.own, { fish: 0, bonus: 0, hauling: 0, hold: 0, bait: true })
    assert.equal((await request<TeamState>('/team/game/order', a.cookie, { bait: false })).body.game.own.bait, false)
    // Photon Pigeons head for the farthest ground; Older Team, without Research, for the nearest ordinary one.
    const far = [...game.schools].sort((x, y) => y.sail - x.sail)[0]!, near = game.schools.filter(s => !s.golden).sort((x, y) => x.sail - y.sail)[0]!
    atTick(db, 0)
    const sent = (await request<TeamState>('/team/game/order', a.cookie, { school: far.id })).body.game.boats.find(boat => boat.team === create.body.id)!
    assert.deepEqual([sent.target, sent.route.length], [{ school: far.id }, far.sail])
    // The next three tiles, for drawing the boat moving between polls.
    assert.deepEqual(sent.ahead, sent.route.slice(0, 3))
    assert.equal((await request('/team/game/order', c.cookie, { school: near.id })).status, 200)
    // Every boat, order and route is public; Research, scores, catch meter, hold and bait are not.
    const observed = (await request<TeamState>('/team/state', c.cookie)).body.game
    assert.deepEqual(observed.boats.find(boat => boat.team === create.body.id)!.route, sent.route)
    assert(!/research|spent|fish|bonus|hauling|hold|bait/.test(JSON.stringify(observed.boats)))
    // Without Research the Older Team's boat will not move, and its lookahead says so.
    assert.deepEqual(observed.boats.find(boat => boat.team === other.body.id)!.ahead, [harbour, harbour, harbour])
    // Three ticks on, concurrent reads play them exactly once: three tiles sailed, three Research burnt.
    atTick(db, 3)
    const reads = await Promise.all([a, b, c, a, c].map(device => request<TeamState>('/team/state', device.cookie)))
    assert(reads.every(r => r.body.game.clock.tick === 3))
    const sailing = reads[0]!.body.game.boats.find(boat => boat.team === create.body.id)!
    assert.deepEqual([sailing.x, sailing.y, sailing.route.length], [sent.route[2]!.x, sent.route[2]!.y, far.sail - 3])
    assert.equal(reads[0]!.body.team.research, 42)
    const waiting = reads[2]!.body.game.boats.find(boat => boat.team === other.body.id)!
    assert.deepEqual([waiting.x, waiting.y, reads[2]!.body.team.research], [harbour.x, harbour.y, 0])
    // Parked on a full ground of 20 fish, the boat lands a fish after four ticks there; the fifth puts 19 on its meter.
    edit(db, state => { Object.assign(state.boats.find(boat => boat.team === create.body.id)!, { x: near.x, y: near.y, target: { school: near.id } }) })
    atTick(db, 8)
    const fished = (await request<TeamState>('/team/state', b.cookie)).body
    assert.deepEqual(fished.game.own, { fish: 1, bonus: 0, hauling: 19, hold: 1, bait: false })
    assert.deepEqual(fished.standings.teams.map(t => t.score), [1, 0])
    assert.equal((await request<AdminTeam[]>('/admin/teams', admin)).body.find(t => t.id === create.body.id)!.score, 1)
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
    assert.equal((await request('/team/game/order', a.cookie, { school: near.id })).status, 409)
    assert.equal((await request('/admin/start', admin, {})).status, 409)
    // The last tick runs at the deadline; the history samples every minute and keeps every order.
    assert.equal(atEnd.game.clock.tick, 1800)
    const history = (await request<History>('/admin/history', admin)).body
    assert.deepEqual(history.samples.map(s => s.tick), Array.from({ length: 60 }, (_, i) => (i + 1) * 30))
    assert.equal(scoreAt(history, 1800)[create.body.id], atEnd.game.own.fish + atEnd.game.own.bonus)
    // Bait switches count as orders too, for calibrating how often teams look in.
    assert.deepEqual(history.orders.map(o => [o.team, 'bait' in o]), [[create.body.id, true], [create.body.id, true], [create.body.id, false], [other.body.id, false]])
    assert.equal((await request('/admin/history', a.cookie)).status, 401)
    assert.equal((await request<TeamState>('/team/state', a.cookie)).body.team.research, atEnd.team.research)
    // No typed confirmation: the admin screen asks before it sends the reset.
    assert.equal((await request('/admin/reset', admin, {})).status, 200)
    const reset = (await request<TeamState>('/team/state', a.cookie)).body
    assert.equal(reset.competition.status, 'waiting'); assert.equal(reset.competition.startedAt, null)
    assert.equal(reset.team.research, 0); assert.equal(reset.team.earned, 0); assert.equal(reset.team.skipsUsed, 0)
    assert(subjects.every(s => reset.progress[s].completed === 0))
    assert.deepEqual([reset.game.map, reset.game.clock.tick, reset.game.schools, reset.game.boats], [null, 0, [], []])
    assert.deepEqual(reset.game.own, { fish: 0, bonus: 0, hauling: 0, hold: 0, bait: false })
    assert(reset.standings.teams.every(team => team.score === 0))
    assert.equal((await request<History>('/admin/history', admin)).body.samples.length, 0)
    await request(`/admin/teams/${create.body.id}`, admin, {}, 'DELETE')
    assert.equal((await request('/team/state', a.cookie)).status, 401)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commons_teams WHERE team_id = ?').get(create.body.id)!.n, 0)
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

test('a team created before a subject was added starts it from its first question', () => {
  const dir = mkdtempSync(join(tmpdir(), 'competition-subjects-')), path = join(dir, 'old.sqlite')
  let db = openDatabase(path)
  db.exec(`INSERT INTO teams (id, name, age, code, color) VALUES ('t', 'Existing team', '14–16', 'ABCD', '#176b58');
    INSERT INTO progress VALUES ('t', 'physics', 3, 2);`)
  db.close(); db = openDatabase(path)
  try {
    assert.deepEqual({ ...db.prepare("SELECT completed, attempts FROM progress WHERE subject = 'physics'").get() }, { completed: 3, attempts: 2 })
    assert.deepEqual({ ...db.prepare("SELECT completed, attempts FROM progress WHERE subject = 'math'").get() }, { completed: 0, attempts: 0 })
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
    db.exec('UPDATE teams SET research = 100000')
    // Each team's boat sits on its own ground, deep enough to fish all match (between trips home to unload).
    edit(db, state => state.schools.slice(0, 2).forEach((school, i) => { school.fish = 10_000; Object.assign(state.boats.find(boat => boat.team === [aId, bId][i])!, { x: school.x, y: school.y, target: { school: school.id } }) }))
    atTick(db, 30)
    const before = (await call('/team/state', a)).data as TeamState
    assert.equal(before.standings.frozenAt, null)
    assert(before.standings.teams.every(t => t.score > 0))
    // Jump past the cutoff (55:00, tick 1650) to tick 1710 with no request in between.
    // The first request is an order: ticks up to 1650 count towards the frozen
    // standings, the rest only towards the live scores. All of that, and the order
    // itself, happen in one transaction.
    const begins = transactions(db), start = atTick(db, 1710)
    const after = (await call('/team/game/order', a, { school: before.game.schools[2]!.id })).data as TeamState
    assert.equal(begins.length, 1)
    assert.equal(after.standings.frozenAt, start + 55 * 60 * 1000)
    assert.equal(after.game.clock.tick, 1710)
    const history = (await call('/admin/history', admin)).data as History
    assert.deepEqual(Object.fromEntries(after.standings.teams.map(t => [t.id, t.score])), scoreAt(history, 1650))
    // Alpha kept fishing after the cutoff; the order just given has not moved it yet.
    assert(scoreAt(history, 1650)[aId]! < after.game.own.fish + after.game.own.bonus)
    assert.equal(after.game.own.fish + after.game.own.bonus, scoreAt(history, 1710)[aId])
    atTick(db, 1800)
    const later = (await call('/team/state', a)).data as TeamState
    assert.deepEqual([later.game.clock.tick, later.standings], [1800, after.standings])
    const adminTeams = (await call('/admin/teams', admin)).data as AdminTeam[]
    const final = scoreAt((await call('/admin/history', admin)).data as History, 1800)
    assert.deepEqual(adminTeams.map(t => t.score), [final[aId], final[bId]])
    await close(); db.close(); db = openDatabase(path)
    server = createApp(db, bank, 'test-password').listen(0, '127.0.0.1')
    await new Promise<void>(resolve => server.once('listening', resolve))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`
    const freshLogin = (await call('/team/login', '', { code: 'AAAA' })).data as TeamState
    assert.deepEqual([freshLogin.standings, freshLogin.game.clock.tick], [after.standings, 1800])
    await call(`/admin/teams/${bId}`, admin, { name: 'Renamed', age: '11–13', code: 'BBBB' }, 'PUT')
    await call(`/admin/teams/${bId}`, admin, {}, 'DELETE')
    assert.deepEqual(((await call('/team/state', a)).data as TeamState).standings, after.standings)
    await call('/admin/reset', admin, {})
    const reset = (await call('/team/state', a)).data as TeamState
    assert.equal(reset.standings.frozenAt, null)
    assert.deepEqual(reset.standings.teams.map(t => t.score), [0])
    await call('/admin/start', admin, {})
    // One team now: three ordinary grounds and a golden one, and the starting Research.
    const started = (await call('/team/state', a)).data as TeamState
    assert.deepEqual([started.game.schools.length, started.team.research], [4, 10])
    // Without Research the boat stays in the harbour.
    db.exec('UPDATE teams SET research = 0')
    atTick(db, 0)
    const target = started.game.schools[0]!
    await call('/team/game/order', a, { school: target.id })
    atTick(db, 2)
    const stuck = ((await call('/team/state', a)).data as TeamState).game.boats[0]!
    assert.deepEqual([stuck.x, stuck.y], [started.game.map!.harbour.x, started.game.map!.harbour.y])
    db.exec('UPDATE teams SET research = 1')
    atTick(db, 4)
    const moved = ((await call('/team/state', a)).data as TeamState)
    assert.deepEqual([moved.game.boats[0]!.route.length, moved.team.research], [target.sail - 1, 0])
  } finally { await close(); db.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('reset needs no catch-up, so it also recovers a match that cannot be played', async () => {
  const db = openDatabase(':memory:'), { call, close } = await serve(db)
  try {
    const admin = (await call('/admin/login', '', { password: 'test-password' })).cookie
    await call('/admin/teams', admin, { name: 'Alpha', age: '11–13', code: 'AAAA' })
    const team = (await call('/team/login', '', { code: 'AAAA' })).cookie
    await call('/admin/start', admin, {})
    // The stored match is corrupt, and the match is over with every tick due.
    db.exec("UPDATE commons_match SET state = '{'")
    db.prepare("UPDATE config SET value = ? WHERE key = 'started_at'").run(String(Date.now() - 3_600_001))
    const log = console.error
    console.error = () => {}
    try {
      // A 500 rather than a 401 for the roster, so the admin screen still shows its reset.
      for (const [url, cookie] of [['/team/state', team], ['/admin/teams', admin], ['/admin/history', admin]]) assert.equal((await call(url, cookie)).status, 500)
      // A roster edit cannot take a correct snapshot first, so it fails too.
      assert.equal((await call('/admin/teams', admin, { name: 'Beta', age: '11–13' })).status, 500)
    } finally { console.error = log }
    assert.equal((await call('/admin/reset', admin, {})).status, 200)
    const reset = (await call<TeamState>('/team/state', team)).body
    assert.deepEqual([reset.competition.status, reset.game.clock.tick, reset.game.map], ['waiting', 0, null])
    assert.equal((await call<History>('/admin/history', admin)).body.samples.length, 0)
    await call('/admin/start', admin, {})
    assert.deepEqual((await call<TeamState>('/team/state', team)).body.game.schools.map(s => s.fish), [5, 20, 20, 20])
  } finally { await close(); db.close() }
})

test('a poll takes no write lock unless the game is due, and each request catches up at most once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'catch-up-')), path = join(dir, 'test.sqlite')
  const db = openDatabase(path), other = new DatabaseSync(path), { call, close } = await serve(db)
  // Fail fast rather than wait five seconds if a read ever asks for the write lock.
  db.exec('PRAGMA busy_timeout = 100')
  const begins = transactions(db)
  try {
    const admin = (await call('/admin/login', '', { password: 'test-password' })).cookie
    await call('/admin/teams', admin, { name: 'Alpha', age: '11–13', code: 'AAAA' })
    const team = (await call('/team/login', '', { code: 'AAAA' })).cookie
    await call('/admin/start', admin, {})
    db.exec('UPDATE teams SET research = 100000')
    // The boat fishes a ground deep enough for the whole match (between trips home to unload).
    let own = 0
    edit(db, state => { const school = state.schools[0]!; own = school.id; school.fish = 10_000; Object.assign(state.boats[0]!, { x: school.x, y: school.y, target: { school: school.id } }) })
    const reads = [['/team/state', team], ['/admin/teams', admin], ['/admin/history', admin]]
    // While another connection holds the write lock, polls with nothing due still answer.
    atTick(db, 0)
    let taken = begins.length
    other.exec('BEGIN IMMEDIATE')
    try { for (const [url, cookie] of reads) assert.equal((await call(url, cookie)).status, 200) } finally { other.exec('ROLLBACK') }
    assert.equal(begins.length, taken)
    // Once a tick is due, the first read runs it in one transaction; later reads need none.
    atTick(db, 1)
    assert.equal((await call<TeamState>('/team/state', team)).body.game.clock.tick, 1)
    for (const [url, cookie] of reads) await call(url, cookie)
    assert.equal(begins.length, taken + 1)
    // A change catches up and applies in that same single transaction.
    atTick(db, 2)
    taken = begins.length
    assert.equal((await call<TeamState>('/team/game/order', team, { school: own })).body.game.clock.tick, 2)
    assert.equal(begins.length, taken + 1)
    // Past the cutoff (55:00, tick 1650) to tick 1710, one read plays up to 1650,
    // freezes the standings, then plays on.
    atTick(db, 1710)
    taken = begins.length
    const late = (await call<TeamState>('/team/state', team)).body
    assert.equal(begins.length, taken + 1)
    const history = (await call<History>('/admin/history', admin)).body, id = late.team.id
    assert.equal(late.game.clock.tick, 1710)
    assert.notEqual(scoreAt(history, 1650)[id], scoreAt(history, 1710)[id])
    assert.deepEqual(late.standings.teams.map(t => t.score), [scoreAt(history, 1650)[id]])
    assert.equal(late.game.own.fish + late.game.own.bonus, scoreAt(history, 1710)[id])
  } finally { await close(); other.close(); db.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('the login limit counts only failed attempts, so a class behind one IP can all sign in', async () => {
  const db = openDatabase(':memory:'), { call, close } = await serve(db)
  try {
    for (let i = 0; i < 61; i++) assert.equal((await call('/admin/login', '', { password: 'test-password' })).status, 200)
    for (let i = 0; i < 60; i++) assert.equal((await call('/team/login', '', { code: 'NOPE' })).status, 401)
    assert.equal((await call('/admin/login', '', { password: 'test-password' })).status, 429)
  } finally { await close(); db.close() }
})
