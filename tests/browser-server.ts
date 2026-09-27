import { openDatabase } from '../server/db.js'
import { loadQuestions } from '../server/questions.js'
import { createApp } from '../server/app.js'
createApp(openDatabase(':memory:'), loadQuestions('./questions'), 'browser-test-password').listen(3101, '127.0.0.1')
