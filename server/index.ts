import { createApp } from './app.js'
import { openDatabase } from './db.js'
import { loadQuestions } from './questions.js'
const password = process.env.ADMIN_PASSWORD
if (!password || password === 'change-this-before-the-event') throw new Error('Set a private ADMIN_PASSWORD in .env before starting the server.')
const bank = loadQuestions(process.env.QUESTION_DIR || './questions')
const db = openDatabase(process.env.DATABASE_PATH || './data/competition.sqlite')
const server = createApp(db, bank, password).listen(Number(process.env.PORT || 3001), '0.0.0.0', () => console.log(`Science competition: http://localhost:${process.env.PORT || 3001}`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0) }))
