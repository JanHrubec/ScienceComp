import express, { type Request, type Response, type NextFunction } from 'express'
import { rateLimit } from 'express-rate-limit'
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { z } from 'zod'
import type { DatabaseSync } from 'node:sqlite'
import { TEAM_SKIP_LIMIT, ages, subjects, type Team, type TeamState, type Subject, type AgeCategory } from '../shared/domain.js'
import { ApiError, transaction } from './db.js'
import { isCorrect, parseNumber, publicQuestion, type QuestionBank } from './questions.js'
import { gameState, setOrder, orderSchema, setContract, contractSchema, initializeGame, createTeamGame, resetTeamGame, resetGame, startGame, teamScore, matchHistory } from './game/commons.js'
import { competitionState, requireRunning, startCompetition } from './competition.js'
import { advanceGame, catchUp, standingsState } from './game/standings.js'
import { answerReward } from '../shared/scoring.js'
interface TeamRow { id: string; name: string; age: AgeCategory; code: string; research: number; earned: number; skips_used: number; color: string }
interface ProgressRow { completed: number; attempts: number }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const teamInput = z.object({ name: z.string().trim().min(1).max(60), age: z.enum(ages), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,8}$/, 'Use 4–8 letters or numbers.').optional() }).strict()
const palette = ['#176b58', '#ad542f', '#3e62a4', '#875087', '#8a701c', '#267c8d', '#ab4263', '#5e7136']
export function createApp(db: DatabaseSync, bank: QuestionBank, adminPassword: string) {
  transaction(db, () => initializeGame(db))
  // Every request that reads or changes play state goes through one of these: they
  // bring the game up to date exactly once, as of one moment, and the response is
  // read as of that moment, so it never mixes state from before and after a
  // resolution. A change catches up inside its own transaction, so a due standings
  // snapshot is always taken before the change; a read takes the write lock only
  // when a resolution or the snapshot is due.
  function read<T>(view: (now: number) => T): T { const now = Date.now(); catchUp(db, now); return view(now) }
  function change<T>(action: (now: number) => T): T { const now = Date.now(); return transaction(db, () => { advanceGame(db, now); return action(now) }) }
  const app = express()
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1)
  app.disable('x-powered-by')
  app.use(express.json({ limit: '16kb' }))
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    // Custom header prevents cross-origin form submissions; there is no CORS opt-in.
    if (!['GET', 'HEAD'].includes(req.method) && req.get('X-Competition-Client') !== '1') return res.status(403).json({ error: 'Invalid request origin.' })
    next()
  })
  app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'same-origin'); next() })
  const loginLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many login attempts. Wait a minute and try again.' } })
  const cookieName = (role: string) => role === 'admin' ? 'science_admin' : 'science_team'
  function sessionHash(req: Request, role: string) {
    const value = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName(role)}=`))?.split('=')[1]
    return value ? hash(value) : ''
  }
  function auth(role: 'team' | 'admin') {
    return (req: Request, res: Response, next: NextFunction) => {
      const session = db.prepare('SELECT team_id FROM sessions WHERE token_hash = ? AND role = ? AND expires > ?').get(sessionHash(req, role), role, Date.now())
      if (!session) return res.status(401).json({ error: 'Please sign in again.' })
      res.locals.teamId = session.team_id
      next()
    }
  }
  function setSession(req: Request, res: Response, role: string, teamId: string | null) {
    const token = randomBytes(32).toString('hex')
    const maxAge = 7 * 24 * 60 * 60 * 1000
    db.prepare('DELETE FROM sessions WHERE expires < ? OR token_hash = ?').run(Date.now(), sessionHash(req, role))
    db.prepare('INSERT INTO sessions (token_hash, team_id, role, expires) VALUES (?, ?, ?, ?)').run(hash(token), teamId, role, Date.now() + maxAge)
    res.cookie(cookieName(role), token, { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', maxAge, path: '/' })
  }
  function teamRow(id: string) {
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as unknown as TeamRow | undefined
    if (!team) throw new ApiError(404, 'Team not found.')
    return team
  }
  function teamPublic(t: TeamRow): Team { return { id: t.id, name: t.name, age: t.age, research: t.research, earned: t.earned, skipsUsed: t.skips_used, color: t.color } }
  function progress(id: string, subject: Subject): ProgressRow { return db.prepare('SELECT completed, attempts FROM progress WHERE team_id = ? AND subject = ?').get(id, subject) as unknown as ProgressRow }
  // A plain read as of `now`, inside read() or change().
  function snapshot(id: string, now: number): TeamState {
    const team = teamRow(id), competition = competitionState(db, now)
    return { competition, team: teamPublic(team), progress: Object.fromEntries(subjects.map(subject => {
      const p = progress(id, subject), track = bank[subject][team.age], question = track[p.completed]
      return [subject, { ...p, total: track.length, question: question && competition.status === 'running' ? publicQuestion(question) : null }]
    })) as TeamState['progress'], game: gameState(db, id, competition.startedAt), standings: standingsState(db) }
  }
  function generateCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    for (let tries = 0; tries < 100; tries++) {
      const code = Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('')
      if (!db.prepare('SELECT id FROM teams WHERE code = ?').get(code)) return code
    }
    throw new ApiError(503, 'Could not generate a code. Try again.')
  }
  app.get('/api/competition', (_req, res) => res.json(competitionState(db)))
  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.post('/api/team/login', loginLimiter, (req, res) => {
    const { code } = z.object({ code: z.string().trim().toUpperCase().min(1).max(8) }).parse(req.body)
    const team = db.prepare('SELECT id FROM teams WHERE code = ?').get(code)
    if (!team) throw new ApiError(401, 'That code was not found. Check it and try again.')
    setSession(req, res, 'team', String(team.id)); res.json(read(now => snapshot(String(team.id), now)))
  })
  app.post('/api/admin/login', loginLimiter, (req, res) => {
    const { password } = z.object({ password: z.string().max(200) }).parse(req.body)
    if (!timingSafeEqual(Buffer.from(hash(password)), Buffer.from(hash(adminPassword)))) throw new ApiError(401, 'Incorrect password.')
    setSession(req, res, 'admin', null); res.json({ ok: true })
  })
  for (const role of ['team', 'admin']) app.post(`/api/${role}/logout`, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sessionHash(req, role))
    res.clearCookie(cookieName(role), { path: '/' }); res.json({ ok: true })
  })
  app.use('/api/team', auth('team'))
  app.get('/api/team/state', (_req, res) => res.json(read(now => snapshot(res.locals.teamId, now))))
  const actionSchema = z.object({ subject: z.enum(subjects), questionId: z.string().min(1).max(100), answer: z.string().trim().min(1).max(500).optional() }).strict()
  for (const action of ['answer', 'skip']) app.post(`/api/team/${action}`, (req, res) => {
    const input = actionSchema.parse(req.body), id = res.locals.teamId as string
    res.json(change(now => {
      requireRunning(db, now)
      const team = teamRow(id), p = progress(id, input.subject), q = bank[input.subject][team.age][p.completed]
      if (!q || q.id !== input.questionId) throw new ApiError(409, 'A teammate has already advanced this subject. The latest question is now shown.')
      if (action === 'skip') {
        if (team.skips_used >= TEAM_SKIP_LIMIT) throw new ApiError(400, 'Your team has used all available skips.')
        db.prepare('UPDATE teams SET skips_used = skips_used + 1 WHERE id = ?').run(id)
        db.prepare('UPDATE progress SET completed = completed + 1, attempts = 0 WHERE team_id = ? AND subject = ?').run(id, input.subject)
        return { skipped: true, awarded: 0, state: snapshot(id, now) }
      }
      if (input.answer === undefined) throw new ApiError(400, 'Enter an answer first.')
      if (q.type === 'multiple-choice' && !q.choices.some((_, index) => input.answer === String(index))) throw new ApiError(400, 'Choose one answer.')
      if (q.type === 'numerical' && parseNumber(input.answer) === null) throw new ApiError(400, 'Enter a number without units, using a decimal point or comma if needed.')
      const correct = isCorrect(q, input.answer)
      const awarded = answerReward(q.type, q.reward, p.attempts, correct)
      if (correct) {
        db.prepare('UPDATE progress SET completed = completed + 1, attempts = 0 WHERE team_id = ? AND subject = ?').run(id, input.subject)
      } else db.prepare('UPDATE progress SET attempts = attempts + 1 WHERE team_id = ? AND subject = ?').run(id, input.subject)
      db.prepare('UPDATE teams SET research = research + ?, earned = earned + ? WHERE id = ?').run(awarded, awarded, id)
      return { correct, awarded, state: snapshot(id, now) }
    }))
  })
  app.post('/api/team/game/order', (req, res) => {
    const input = orderSchema.parse(req.body)
    res.json(change(now => { requireRunning(db, now); setOrder(db, res.locals.teamId, input); return snapshot(res.locals.teamId, now) }))
  })
  app.post('/api/team/game/contract', (req, res) => {
    const input = contractSchema.parse(req.body)
    res.json(change(now => { requireRunning(db, now); setContract(db, res.locals.teamId, input); return snapshot(res.locals.teamId, now) }))
  })
  app.use('/api/admin', auth('admin'))
  // Only a waiting competition starts, so there is nothing to catch up first.
  app.post('/api/admin/start', (_req, res) => res.json(transaction(db, () => { const state = startCompetition(db); startGame(db); return state })))
  app.get('/api/admin/teams', (_req, res) => res.json(read(() => {
    const teams = db.prepare('SELECT * FROM teams ORDER BY name COLLATE NOCASE').all() as unknown as TeamRow[]
    return teams.map(t => ({ ...teamPublic(t), ...teamScore(db, t.id), code: t.code, progress: Object.fromEntries(subjects.map(s => [s, { completed: progress(t.id, s).completed, total: bank[s][t.age].length }])) }))
  })))
  app.get('/api/admin/history', (_req, res) => res.json(read(() => matchHistory(db))))
  // Roster edits catch up first, so a due snapshot precedes them. If catch-up fails
  // they fail too, rather than freeze wrong standings or leave overdue resolutions
  // to run against a roster they were not scheduled with; reset still works.
  app.post('/api/admin/teams', (req, res) => {
    const input = teamInput.parse(req.body)
    const id = randomUUID()
    change(() => {
      const usedColors = new Set(db.prepare('SELECT color FROM teams').all().map(row => row.color))
      const color = palette.find(value => !usedColors.has(value)) || `hsl(${parseInt(hash(id).slice(0, 8), 16) % 360} 45% 35%)`
      db.prepare('INSERT INTO teams (id, name, age, code, color) VALUES (?, ?, ?, ?, ?)').run(id, input.name, input.age, input.code || generateCode(), color)
      for (const subject of subjects) db.prepare('INSERT INTO progress (team_id, subject) VALUES (?, ?)').run(id, subject)
      createTeamGame(db, id)
    })
    res.status(201).json({ id })
  })
  app.put('/api/admin/teams/:id', (req, res) => {
    const input = teamInput.parse(req.body), id = String(req.params.id)
    change(() => {
      const old = teamRow(id)
      db.prepare('UPDATE teams SET name = ?, age = ?, code = ? WHERE id = ?').run(input.name, input.age, input.code || generateCode(), id)
      if (old.age !== input.age) {
        db.prepare('UPDATE progress SET completed = 0, attempts = 0 WHERE team_id = ?').run(id)
        db.prepare('UPDATE teams SET research = 0, earned = 0, skips_used = 0 WHERE id = ?').run(id)
        resetTeamGame(db, id)
      }
    }); res.json({ ok: true })
  })
  app.delete('/api/admin/teams/:id', (req, res) => { change(() => { teamRow(String(req.params.id)); db.prepare('DELETE FROM teams WHERE id = ?').run(String(req.params.id)) }); res.json({ ok: true }) })
  // Reset discards the match, so it does not catch up first: it stays the way out
  // when catch-up fails, and a finished match is not replayed just to be deleted.
  app.post('/api/admin/reset', (req, res) => {
    z.object({ confirmation: z.literal('RESET') }).parse(req.body)
    transaction(db, () => {
      db.prepare("DELETE FROM config WHERE key IN ('started_at', 'standings_snapshot')").run()
      db.exec('UPDATE teams SET research = 0, earned = 0, skips_used = 0; UPDATE progress SET completed = 0, attempts = 0;')
      resetGame(db)
      db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('last_reset', ?)").run(new Date().toISOString())
    }); res.json({ ok: true })
  })
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }))
  const client = resolve('dist/client')
  if (existsSync(client)) { app.use(express.static(client)); app.get('/{*path}', (_req, res) => res.sendFile(resolve(client, 'index.html'))) }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(i => i.message).join(' ') })
    if (error instanceof ApiError) return res.status(error.status).json({ error: error.message })
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed: teams.code')) return res.status(409).json({ error: 'That code is already used by another team.' })
    // Only a malformed request body; stored JSON that fails to parse is a server fault and is logged.
    if (error instanceof SyntaxError && (error as SyntaxError & { type?: string }).type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON request.' })
    console.error(error); res.status(500).json({ error: 'The server could not complete this request. Please try again.' })
  })
  return app
}
