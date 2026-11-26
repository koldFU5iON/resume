/**
 * Client-side helpers for cover letter generation (#471): the two POSTs and
 * the pure view logic the page and the angle picker share. No React here, so
 * it is unit-tested directly. Only `schema.ts` of the module is imported
 * (it has no server dependencies).
 */

import {
  LENGTH_WORDS,
  REUSABLE_TOPICS,
  type CoverLetterChoiceInput,
  type CoverLetterStatus,
  type LetterLength,
  type QuestionTopic,
  type StoredAngles,
  type Tone,
} from '@/modules/cover-letter-generation/schema'

type Fetch = (input: string, init?: RequestInit) => Promise<Pick<Response, 'status' | 'json'>>

export type StartOutcome =
  | { kind: 'started'; existing: boolean }
  | { kind: 'draft_exists'; documentId: string | null }
  | { kind: 'error'; message: string }

const base = (jobId: string) => `/api/jobs/${encodeURIComponent(jobId)}/cover-letter-generation`

async function messageOf(res: Pick<Response, 'json'>, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: unknown } | null
  return typeof body?.message === 'string' && body.message ? body.message : fallback
}

const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again."

/** POST .../cover-letter-generation: suggest angles. A 409 means a draft is waiting; nothing was spent. */
export async function requestCoverLetterAngles(jobId: string, options: { fresh?: boolean } = {}, doFetch: Fetch = fetch): Promise<StartOutcome> {
  try {
    const res = await doFetch(base(jobId), {
      method: 'POST',
      ...(options.fresh ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fresh: true }) } : {}),
    })
    if (res.status === 202 || res.status === 200) return { kind: 'started', existing: res.status === 200 }
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as { documentId?: unknown } | null
      return { kind: 'draft_exists', documentId: typeof body?.documentId === 'string' ? body.documentId : null }
    }
    return { kind: 'error', message: await messageOf(res, "Couldn't start the cover letter. Try again.") }
  } catch {
    return { kind: 'error', message: NETWORK_ERROR }
  }
}

export type ChoiceOutcome =
  | { kind: 'started' }
  | { kind: 'draft_exists'; documentId: string | null }
  | { kind: 'not_waiting'; message: string }
  | { kind: 'error'; message: string }

/** POST .../[runId]/choice: write the letter from the choice. */
export async function submitCoverLetterChoice(jobId: string, runId: string, choice: CoverLetterChoiceInput, doFetch: Fetch = fetch): Promise<ChoiceOutcome> {
  try {
    const res = await doFetch(`${base(jobId)}/${encodeURIComponent(runId)}/choice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(choice),
    })
    if (res.status === 202) return { kind: 'started' }
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as { code?: unknown; documentId?: unknown; message?: unknown } | null
      if (body?.code === 'draft_exists') return { kind: 'draft_exists', documentId: typeof body.documentId === 'string' ? body.documentId : null }
      return { kind: 'not_waiting', message: typeof body?.message === 'string' ? body.message : 'These angles are no longer waiting for a choice.' }
    }
    return { kind: 'error', message: await messageOf(res, "Couldn't start writing. Try again.") }
  } catch {
    return { kind: 'error', message: NETWORK_ERROR }
  }
}

// ── Page state ────────────────────────────────────────────────────────────

export const PHASE_ONE: readonly CoverLetterStatus[] = ['queued', 'gathering', 'suggesting']
export const PHASE_TWO: readonly CoverLetterStatus[] = ['writing', 'reviewing', 'landing']

export function isWorking(status: CoverLetterStatus | null | undefined): boolean {
  return !!status && (PHASE_ONE.includes(status) || PHASE_TWO.includes(status))
}

/** The poller's signature: non-empty only while the run is working, and changing as it moves. */
export function pollSignature(run: { id: string; status: CoverLetterStatus } | null): string {
  return run && isWorking(run.status) ? `${run.id}:${run.status}` : ''
}

export const STATUS_LABEL: Record<CoverLetterStatus, string> = {
  queued: 'Starting',
  gathering: 'Reading the job, the research and your profile',
  suggesting: 'Finding angles',
  awaiting_choice: 'Waiting for your choice',
  writing: 'Writing your letter',
  reviewing: 'Reviewing it as a recruiter would',
  landing: 'Saving it as a draft',
  complete: 'Done',
  failed: 'Stopped',
}

/** The steps shown while a phase works, with their state. */
export function stepRows(status: CoverLetterStatus): Array<{ status: CoverLetterStatus; label: string; state: 'done' | 'current' | 'todo' }> {
  const steps = PHASE_ONE.includes(status) ? (['gathering', 'suggesting'] as const) : (['writing', 'reviewing', 'landing'] as const)
  const at = (steps as readonly CoverLetterStatus[]).indexOf(status === 'queued' ? 'gathering' : status)
  return steps.map((s, i) => ({ status: s, label: STATUS_LABEL[s], state: i < at ? 'done' : i === at ? 'current' : 'todo' }))
}

// ── The picker form ───────────────────────────────────────────────────────

export function isReusable(topic: QuestionTopic): boolean {
  return REUSABLE_TOPICS.includes(topic)
}

/** Each question's starting answer: the remembered one for reusable topics, else empty. */
export function initialAnswers(questions: StoredAngles['questions'], remembered: Partial<Record<QuestionTopic, string>>): string[] {
  return questions.map((q) => (isReusable(q.topic) ? remembered[q.topic] ?? '' : ''))
}

export type PickerState = {
  /** An angle's index, or 'custom'. */
  angle: number | 'custom' | null
  customAngle: string
  answers: string[]
  tone: Tone
  length: LetterLength
  remember: boolean
}

export const CUSTOM_ANGLE_MIN = 10

/** The request body for a picker state, or the reason it can't be sent yet. Pure. */
export function choiceFromState(state: PickerState, questions: StoredAngles['questions']): { ok: true; choice: CoverLetterChoiceInput } | { ok: false; message: string } {
  if (state.angle === null) return { ok: false, message: 'Pick an angle, or write your own.' }
  if (state.angle === 'custom' && state.customAngle.trim().length < CUSTOM_ANGLE_MIN) return { ok: false, message: 'Describe your angle in a sentence or two.' }
  return {
    ok: true,
    choice: {
      angle: state.angle === 'custom' ? { custom: state.customAngle.trim() } : { index: state.angle },
      answers: questions.map((q, i) => ({ topic: q.topic, question: q.question, answer: (state.answers[i] ?? '').trim() })),
      tone: state.tone,
      length: state.length,
      remember: state.remember,
    },
  }
}

export function lengthLabel(length: LetterLength): string {
  return `${length === 'short' ? 'Short' : 'Standard'} · about ${LENGTH_WORDS[length].target} words`
}

// ── Coach hand-off ────────────────────────────────────────────────────────

const COACH_TAIL = "Please talk it through with me first. Don't change my profile; I'll make any change myself."

type Concern = { kind: string; why: string; suggestion: string }

export function concernCoachMessage(concerns: Concern[], job: { title: string; company: string | null }): string {
  const where = job.company ? `${job.title} at ${job.company}` : job.title
  const intro = `The review of the cover letter drafted for ${where} raised ${concerns.length === 1 ? 'a point' : `${concerns.length} points`} I'd like to talk through.`
  const blocks = concerns.map((c) => `- ${c.why}\n  Suggestion: ${c.suggestion}`)
  return [intro, '', ...blocks, '', COACH_TAIL].join('\n')
}
