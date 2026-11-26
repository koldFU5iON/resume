/**
 * The light, remembered cover letter configuration (#471): the last tone and
 * length the owner chose, and their answers to questions that hold across
 * applications (REUSABLE_TOPICS, e.g. "why now"). Stored on
 * UserSettings.coverLetterPreferences, validated with Zod on read and write;
 * the picker pre-fills from it and the owner can change anything.
 *
 * Job-specific answers (why this company, a personal connection to this job)
 * are never remembered.
 */

import * as z from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { LENGTHS, QUESTION_TOPICS, REUSABLE_TOPICS, TONES, type CoverLetterChoice, type QuestionTopic } from './schema'

const MAX_ANSWER = 800

export const PreferencesSchema = z.object({
  tone: z.enum(TONES).optional(),
  length: z.enum(LENGTHS).optional(),
  /** Remembered answers by topic (reusable topics only). */
  answers: z.partialRecord(z.enum(QUESTION_TOPICS), z.string().max(MAX_ANSWER)).optional(),
})
export type CoverLetterPreferences = z.infer<typeof PreferencesSchema>

export const DEFAULT_PREFERENCES = { tone: 'warm', length: 'standard' } as const

/** A stored value as preferences; anything unreadable is dropped field by field, never thrown. */
export function normalizePreferences(value: unknown): CoverLetterPreferences {
  const parsed = PreferencesSchema.safeParse(value)
  if (parsed.success) return parsed.data
  if (!value || typeof value !== 'object') return {}
  const v = value as Record<string, unknown>
  const one = <K extends keyof CoverLetterPreferences>(key: K) => {
    const r = PreferencesSchema.shape[key].safeParse(v[key])
    return r.success && r.data !== undefined ? { [key]: r.data } : {}
  }
  return { ...one('tone'), ...one('length'), ...one('answers') }
}

export async function loadPreferences(profileId: string): Promise<CoverLetterPreferences> {
  const row = await prisma.userSettings.findUnique({ where: { profileId }, select: { coverLetterPreferences: true } })
  return normalizePreferences(row?.coverLetterPreferences)
}

/** What the picker starts from: the remembered tone and length, else the defaults. */
export function pickerDefaults(prefs: CoverLetterPreferences) {
  return {
    tone: prefs.tone ?? DEFAULT_PREFERENCES.tone,
    length: prefs.length ?? DEFAULT_PREFERENCES.length,
    answers: prefs.answers ?? {},
  }
}

/**
 * The preferences after a choice: its tone and length, and its answers to
 * reusable topics (a blank answer forgets that topic). Pure.
 */
export function mergeChoice(prev: CoverLetterPreferences, choice: Pick<CoverLetterChoice, 'tone' | 'length' | 'answers'>): CoverLetterPreferences {
  const answers: Partial<Record<QuestionTopic, string>> = { ...(prev.answers ?? {}) }
  for (const a of choice.answers) {
    if (!REUSABLE_TOPICS.includes(a.topic)) continue
    const t = a.answer.trim().slice(0, MAX_ANSWER)
    if (t) answers[a.topic] = t
    else delete answers[a.topic]
  }
  return { tone: choice.tone, length: choice.length, ...(Object.keys(answers).length > 0 ? { answers } : {}) }
}

/** Saves the choice as the new defaults. Best effort: a failure is logged, never thrown. */
export async function rememberChoice(profileId: string, choice: CoverLetterChoice): Promise<void> {
  try {
    const next = mergeChoice(await loadPreferences(profileId), choice)
    const value = next as Prisma.InputJsonValue
    await prisma.userSettings.upsert({
      where: { profileId },
      update: { coverLetterPreferences: value },
      create: { profileId, coverLetterPreferences: value },
    })
  } catch (err) {
    console.error('[cover-letter-generation] could not save preferences', { err })
  }
}
