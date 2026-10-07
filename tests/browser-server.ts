import express from 'express'
import { openDatabase } from '../server/db.js'
import { loadQuestions } from '../server/questions.js'
import { createApp } from '../server/app.js'
const db = openDatabase(':memory:')
const app = createApp(db, loadQuestions('./questions'), 'browser-test-password')
// Test-only clock control: moving the start time back makes game resolutions fall due.
express()
  .post('/__test/rewind/:ms', (req, res) => { db.prepare("UPDATE config SET value = CAST(value AS INTEGER) - ? WHERE key = 'started_at'").run(Number(req.params.ms)); res.json({ ok: true }) })
  .use(app)
  .listen(3101, '127.0.0.1')
