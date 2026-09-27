import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { ages, subjects, type Subject, type AgeCategory, type PublicQuestion } from '../shared/domain.js'
const base = { id: z.string().min(1), prompt: z.string().min(10), reward: z.number().positive().max(10000).default(10) }
export const questionSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('multiple-choice'), choices: z.array(z.string().min(1)).min(2).max(6), correctIndex: z.number().int().nonnegative() }).strict().refine(q => q.correctIndex < q.choices.length && new Set(q.choices).size === q.choices.length, 'Invalid answer index or duplicate choices'),
  z.object({ ...base, type: z.literal('text'), acceptedAnswers: z.array(z.string().trim().min(1)).min(1), ignorePunctuation: z.boolean().default(false) }).strict(),
  z.object({ ...base, type: z.literal('numerical'), numericAnswer: z.number(), tolerance: z.number().nonnegative().default(0) }).strict(),
])
export type Question = z.infer<typeof questionSchema>
export type QuestionBank = Record<Subject, Record<AgeCategory, Question[]>>
export function loadQuestions(directory: string): QuestionBank {
  const bank = {} as QuestionBank
  const ids = new Set<string>()
  for (const subject of subjects) {
    const path = resolve(directory, `${subject}.json`)
    const file = z.object({ subject: z.literal(subject), tracks: z.object({ '11–13': z.array(questionSchema).min(1), '14–16': z.array(questionSchema).min(1), '17–18': z.array(questionSchema).min(1) }).strict() }).strict().safeParse(JSON.parse(readFileSync(path, 'utf8')))
    if (!file.success) throw new Error(`Invalid question file ${path}: ${file.error.message}`)
    bank[subject] = file.data.tracks
    for (const age of ages) for (const question of bank[subject][age]) {
      if (ids.has(question.id)) throw new Error(`Duplicate question id: ${question.id}`)
      ids.add(question.id)
    }
  }
  return bank
}
export function publicQuestion(q: Question): PublicQuestion {
  return { id: q.id, type: q.type, prompt: q.prompt, reward: q.reward, ...(q.type === 'multiple-choice' ? { choices: q.choices } : {}) }
}
export function normalizeText(value: string, ignorePunctuation = false): string {
  return (ignorePunctuation ? value.replace(/\p{P}/gu, '') : value).toLowerCase().trim().replace(/\s+/g, ' ')
}
export function parseNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return null
  const number = Number(trimmed)
  return Number.isFinite(number) ? number : null
}
export function isCorrect(q: Question, answer: string): boolean {
  if (q.type === 'multiple-choice') return answer === String(q.correctIndex)
  if (q.type === 'text') return q.acceptedAnswers.some(a => normalizeText(a, q.ignorePunctuation) === normalizeText(answer, q.ignorePunctuation))
  const value = parseNumber(answer)
  return value !== null && Math.abs(value - q.numericAnswer) <= q.tolerance + Number.EPSILON * Math.max(1, Math.abs(q.numericAnswer)) * 4
}
