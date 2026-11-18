// Job/CV/desk-document attribution for LlmUsageLog rows.
//
// Callers that run a model on behalf of a job application (job fit, CV
// generation, assessment, cover letters, …) pass an explicit `attribution`
// through complete()/completeStructured()/askJev(). It is validated here
// against the profile before it is written: a job, CV or writing desk document
// that doesn't belong to the profile, or a CV/document that belongs to a
// different job, is dropped rather than recorded. Attribution is never inferred from timestamps, and profile-only
// operations simply pass none.

import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'

export type LlmAttribution = {
  /** JobApplication the call was made for. */
  jobApplicationId?: string | null
  /** CVDocument the call generated, reviewed or refined. Implies its job when jobApplicationId is omitted. */
  cvDocumentId?: string | null
  /**
   * WritingDeskDocument the call wrote, reviewed or refined (CV generation).
   * Implies its job when no job is otherwise known.
   */
  writingDeskDocumentId?: string | null
  /** Groups every call of one multi-call operation; see newRunId(). */
  runId?: string | null
}

export type ResolvedAttribution = {
  jobApplicationId: string | null
  cvDocumentId: string | null
  writingDeskDocumentId: string | null
  runId: string | null
}

export const NO_ATTRIBUTION: ResolvedAttribution = Object.freeze({
  jobApplicationId: null,
  cvDocumentId: null,
  writingDeskDocumentId: null,
  runId: null,
})

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** A fresh id to group the calls of one multi-call run (e.g. one CV generation). */
export function newRunId(): string {
  return randomUUID()
}

/** The minimal client surface resolveAttribution needs (prisma or a transaction). */
export type AttributionDb = {
  jobApplication: { findFirst(args: { where: { id: string; profileId: string }; select: { id: true } }): Promise<{ id: string } | null> }
  cVDocument: {
    findFirst(args: { where: { id: string; profileId: string }; select: { jobApplicationId: true } }): Promise<{ jobApplicationId: string | null } | null>
  }
  /** Only queried when a writingDeskDocumentId is given. */
  writingDeskDocument: {
    findFirst(args: { where: { id: string; profileId: string }; select: { jobApplicationId: true } }): Promise<{ jobApplicationId: string } | null>
  }
}

/**
 * Validates `attribution` for `profileId` and returns the ids safe to store.
 * Invalid parts become null (with a warning) instead of throwing: usage
 * logging must never fail the caller, and an unattributed row is accurate
 * where a wrongly attributed one is not.
 */
export async function resolveAttribution(
  profileId: string,
  attribution: LlmAttribution | undefined,
  db: AttributionDb = prisma as unknown as AttributionDb,
): Promise<ResolvedAttribution> {
  if (!attribution) return NO_ATTRIBUTION
  const jobId = attribution.jobApplicationId?.trim() || null
  const cvId = attribution.cvDocumentId?.trim() || null
  const deskId = attribution.writingDeskDocumentId?.trim() || null
  const rawRunId = attribution.runId?.trim() || null

  let runId: string | null = null
  if (rawRunId) {
    if (RUN_ID_PATTERN.test(rawRunId)) runId = rawRunId
    else console.warn('[llm-usage] dropped malformed runId')
  }
  if (!jobId && !cvId && !deskId) return { ...NO_ATTRIBUTION, runId }

  const [job, cv, desk] = await Promise.all([
    jobId ? db.jobApplication.findFirst({ where: { id: jobId, profileId }, select: { id: true } }) : null,
    cvId ? db.cVDocument.findFirst({ where: { id: cvId, profileId }, select: { jobApplicationId: true } }) : null,
    deskId ? db.writingDeskDocument.findFirst({ where: { id: deskId, profileId }, select: { jobApplicationId: true } }) : null,
  ])

  let jobApplicationId: string | null = null
  if (jobId) {
    if (job) jobApplicationId = jobId
    else console.warn('[llm-usage] dropped job attribution: not found for this profile', { jobApplicationId: jobId })
  }

  let cvDocumentId: string | null = null
  if (cvId) {
    if (!cv) {
      console.warn('[llm-usage] dropped CV attribution: not found for this profile', { cvDocumentId: cvId })
    } else if (jobId && cv.jobApplicationId !== jobId) {
      console.warn('[llm-usage] dropped CV attribution: CV belongs to a different job', { cvDocumentId: cvId, jobApplicationId: jobId })
    } else {
      cvDocumentId = cvId
      // The CV's own job link is an explicit association, not an inference.
      if (!jobId) jobApplicationId = cv.jobApplicationId
    }
  }

  let writingDeskDocumentId: string | null = null
  if (deskId) {
    // The job it must belong to: the one given, else the one the CV implied.
    const expectedJob = jobId ?? jobApplicationId
    if (!desk) {
      console.warn('[llm-usage] dropped desk document attribution: not found for this profile', { writingDeskDocumentId: deskId })
    } else if (expectedJob && desk.jobApplicationId !== expectedJob) {
      console.warn('[llm-usage] dropped desk document attribution: document belongs to a different job', { writingDeskDocumentId: deskId, jobApplicationId: expectedJob })
    } else {
      writingDeskDocumentId = deskId
      // The document's own job link is an explicit association, not an inference.
      if (!jobApplicationId) jobApplicationId = desk.jobApplicationId
    }
  }

  return { jobApplicationId, cvDocumentId, writingDeskDocumentId, runId }
}
