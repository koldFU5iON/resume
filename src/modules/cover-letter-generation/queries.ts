/**
 * Reading cover letter runs (issue #471). Reads never write: a processing run
 * that stopped progressing reads as failed / timeout, and angles that waited
 * too long read as failed / expired. Every query filters by profileId.
 */

import { prisma } from '@/lib/db'
import { FAILURE_MESSAGES } from './run'
import { loadPreferences, pickerDefaults } from './preferences'
import {
  ANGLES_VALID_MS,
  FAILURE_KINDS,
  PROCESSING_STALE_MS,
  PROCESSING_STATUSES,
  StoredAnglesSchema,
  StoredReviewSchema,
  WrittenSchema,
  ChoiceSchema,
  parseLog,
  parseStatus,
  parseStored,
  type CoverLetterFailureKind,
  type CoverLetterStatus,
} from './schema'

/** The status a reader should see, with the stored or implied failure. Pure. */
export function effectiveStatus(
  row: { status: string; failureKind: string | null; failureMessage: string | null; updatedAt: Date },
  now = Date.now(),
): { status: CoverLetterStatus; failureKind: CoverLetterFailureKind | null; failureMessage: string | null } {
  const status = parseStatus(row.status)
  const stored = (FAILURE_KINDS as readonly string[]).includes(row.failureKind ?? '') ? (row.failureKind as CoverLetterFailureKind) : null
  if ((PROCESSING_STATUSES as readonly string[]).includes(status) && row.updatedAt.getTime() < now - PROCESSING_STALE_MS) {
    return { status: 'failed', failureKind: 'timeout', failureMessage: FAILURE_MESSAGES.timeout }
  }
  if (status === 'awaiting_choice' && row.updatedAt.getTime() < now - ANGLES_VALID_MS) {
    return { status: 'failed', failureKind: 'expired', failureMessage: FAILURE_MESSAGES.expired }
  }
  if (status === 'failed') return { status, failureKind: stored ?? 'error', failureMessage: row.failureMessage ?? FAILURE_MESSAGES[stored ?? 'error'] }
  return { status, failureKind: null, failureMessage: null }
}

const SELECT = {
  id: true, jobApplicationId: true, writingDeskDocumentId: true, deepDiveId: true, status: true, failureKind: true,
  failureMessage: true, angles: true, choice: true, letter: true, review: true, log: true,
  startedAt: true, completedAt: true, createdAt: true, updatedAt: true,
} as const

type Row = { [K in keyof typeof SELECT]: unknown } & { status: string; failureKind: string | null; failureMessage: string | null; updatedAt: Date }

function toView(row: Row) {
  return {
    id: row.id as string,
    jobApplicationId: row.jobApplicationId as string,
    writingDeskDocumentId: (row.writingDeskDocumentId as string | null) ?? null,
    ...effectiveStatus(row),
    angles: parseStored(StoredAnglesSchema, row.angles),
    choice: parseStored(ChoiceSchema, row.choice),
    letter: parseStored(WrittenSchema, row.letter),
    review: parseStored(StoredReviewSchema, row.review),
    log: parseLog(row.log),
    startedAt: row.startedAt as Date | null,
    completedAt: row.completedAt as Date | null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt,
  }
}

export type CoverLetterRunView = ReturnType<typeof toView>

export async function getCoverLetterRun(profileId: string, runId: string): Promise<CoverLetterRunView | null> {
  const row = await prisma.coverLetterGeneration.findFirst({ where: { id: runId, profileId }, select: SELECT })
  return row ? toView(row as Row) : null
}

/** The job's newest run, or null. */
export async function getLatestCoverLetterRun(profileId: string, jobId: string): Promise<CoverLetterRunView | null> {
  const row = await prisma.coverLetterGeneration.findFirst({
    where: { profileId, jobApplicationId: jobId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: SELECT,
  })
  return row ? toView(row as Row) : null
}

/** What the angle picker starts from: the remembered tone, length and reusable answers. */
export async function getPickerDefaults(profileId: string) {
  return pickerDefaults(await loadPreferences(profileId))
}
