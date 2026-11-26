import { describe, expect, it, vi } from 'vitest'
import {
  choiceFromState,
  concernCoachMessage,
  initialAnswers,
  pollSignature,
  requestCoverLetterAngles,
  stepRows,
  submitCoverLetterChoice,
  type PickerState,
} from './cover-letter-view'

const res = (status: number, body: unknown = {}) => ({ status, json: async () => body })

describe('requestCoverLetterAngles', () => {
  it('posts with no body by default and { fresh: true } when asked', async () => {
    const f = vi.fn<(url: string, init?: RequestInit) => Promise<ReturnType<typeof res>>>(async () => res(202))
    await expect(requestCoverLetterAngles('job 1', {}, f)).resolves.toEqual({ kind: 'started', existing: false })
    expect(f).toHaveBeenCalledWith('/api/jobs/job%201/cover-letter-generation', { method: 'POST' })
    await requestCoverLetterAngles('job1', { fresh: true }, f)
    expect(f.mock.calls[1][1]).toMatchObject({ body: JSON.stringify({ fresh: true }) })
  })

  it('reads 200 as an existing run, 409 as a waiting draft, and errors as their message', async () => {
    await expect(requestCoverLetterAngles('j', {}, async () => res(200))).resolves.toEqual({ kind: 'started', existing: true })
    await expect(requestCoverLetterAngles('j', {}, async () => res(409, { documentId: 'doc-1' }))).resolves.toEqual({ kind: 'draft_exists', documentId: 'doc-1' })
    await expect(requestCoverLetterAngles('j', {}, async () => res(429, { message: 'Too many' }))).resolves.toEqual({ kind: 'error', message: 'Too many' })
    await expect(requestCoverLetterAngles('j', {}, async () => { throw new Error('offline') })).resolves.toMatchObject({ kind: 'error' })
  })
})

describe('submitCoverLetterChoice', () => {
  const choice = { angle: { index: 0 }, tone: 'warm' as const, length: 'short' as const }
  it('tells a waiting draft from angles that are no longer waiting', async () => {
    await expect(submitCoverLetterChoice('j', 'r', choice, async () => res(202))).resolves.toEqual({ kind: 'started' })
    await expect(submitCoverLetterChoice('j', 'r', choice, async () => res(409, { code: 'draft_exists', documentId: 'd' }))).resolves.toEqual({ kind: 'draft_exists', documentId: 'd' })
    await expect(submitCoverLetterChoice('j', 'r', choice, async () => res(409, { code: 'not_waiting', message: 'gone' }))).resolves.toEqual({ kind: 'not_waiting', message: 'gone' })
  })
})

const questions = [
  { topic: 'why_company' as const, question: 'Why them?', why: '' },
  { topic: 'why_now' as const, question: 'Why now?', why: '' },
]

describe('initialAnswers', () => {
  it('pre-fills only reusable topics from what was remembered', () => {
    expect(initialAnswers(questions, { why_company: 'never', why_now: 'Ready to lead' })).toEqual(['', 'Ready to lead'])
  })
})

describe('choiceFromState', () => {
  const state: PickerState = { angle: null, customAngle: '', answers: ['  Their mission ', ''], tone: 'direct', length: 'standard', remember: true }

  it('needs an angle, and a sentence for your own', () => {
    expect(choiceFromState(state, questions)).toEqual({ ok: false, message: 'Pick an angle, or write your own.' })
    expect(choiceFromState({ ...state, angle: 'custom', customAngle: 'short' }, questions)).toMatchObject({ ok: false })
  })

  it('builds the request body with trimmed answers for every question', () => {
    expect(choiceFromState({ ...state, angle: 1 }, questions)).toEqual({
      ok: true,
      choice: {
        angle: { index: 1 },
        answers: [{ topic: 'why_company', question: 'Why them?', answer: 'Their mission' }, { topic: 'why_now', question: 'Why now?', answer: '' }],
        tone: 'direct', length: 'standard', remember: true,
      },
    })
    expect(choiceFromState({ ...state, angle: 'custom', customAngle: '  The operator who scaled this before  ' }, questions)).toMatchObject({ ok: true, choice: { angle: { custom: 'The operator who scaled this before' } } })
  })
})

describe('progress', () => {
  it('polls only while a phase works', () => {
    expect(pollSignature(null)).toBe('')
    expect(pollSignature({ id: 'r', status: 'awaiting_choice' })).toBe('')
    expect(pollSignature({ id: 'r', status: 'reviewing' })).toBe('r:reviewing')
  })

  it('shows the steps of the phase that is running', () => {
    expect(stepRows('suggesting').map((s) => s.state)).toEqual(['done', 'current'])
    expect(stepRows('queued').map((s) => s.state)).toEqual(['current', 'todo'])
    expect(stepRows('reviewing').map((s) => `${s.status}:${s.state}`)).toEqual(['writing:done', 'reviewing:current', 'landing:todo'])
  })
})

describe('concernCoachMessage', () => {
  it('names the job, lists each concern with its suggestion, and asks not to change the profile', () => {
    const text = concernCoachMessage([{ kind: 'personal', why: 'No personal line.', suggestion: 'What drew you to them?' }], { title: 'Engineer', company: 'Acme' })
    expect(text).toContain('cover letter drafted for Engineer at Acme raised a point')
    expect(text).toContain('- No personal line.\n  Suggestion: What drew you to them?')
    expect(text).toContain("Don't change my profile")
  })
})
