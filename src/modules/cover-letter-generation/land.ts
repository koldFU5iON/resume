/**
 * Land (no model): the letter goes into the job's cover letter document as a
 * DRAFT the owner accepts or discards (acceptance fills {{contact}}). Nothing
 * live is written and a waiting draft is never replaced.
 *
 * Target: the document an earlier run of this job landed in, while it is
 * still a cover letter of the same job; else a new "Cover letter - <company>"
 * document (createWritingDeskDocument: per-job lock and document cap).
 * `checkLandingTarget` runs before any spend so a waiting draft is reported
 * up front (409) instead of after writing.
 */

import { prisma } from '@/lib/db'
import { createWritingDeskDocument } from '@/modules/writing-desk/documents'
import { landGeneratedDraft } from '@/modules/writing-desk/draft'
import { MAX_WRITING_DESK_DOCUMENT_NAME_LENGTH, MAX_WRITING_DESK_DOCUMENTS_PER_JOB } from '@/modules/writing-desk/schema'

export async function findLandingTarget(profileId: string, jobId: string): Promise<string | null> {
  const row = await prisma.coverLetterGeneration.findFirst({
    where: {
      profileId,
      jobApplicationId: jobId,
      writingDeskDocumentId: { not: null },
      writingDeskDocument: { is: { profileId, jobApplicationId: jobId, documentType: 'cover-letter' } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { writingDeskDocumentId: true },
  })
  return row?.writingDeskDocumentId ?? null
}

export type LandingCheck = { kind: 'ok'; documentId: string | null } | { kind: 'draft_exists'; documentId: string } | { kind: 'limit' }

/** Whether a letter could land now. Cheap, no model: used before any spend. */
export async function checkLandingTarget(profileId: string, jobId: string): Promise<LandingCheck> {
  const target = await findLandingTarget(profileId, jobId)
  if (target) {
    const pending = await prisma.writingDeskDocument.count({ where: { id: target, profileId, draftContent: { not: null } } })
    return pending > 0 ? { kind: 'draft_exists', documentId: target } : { kind: 'ok', documentId: target }
  }
  const documents = await prisma.writingDeskDocument.count({ where: { profileId, jobApplicationId: jobId } })
  return documents >= MAX_WRITING_DESK_DOCUMENTS_PER_JOB ? { kind: 'limit' } : { kind: 'ok', documentId: null }
}

/** "Cover letter - Acme" (or the job title without a company), cut to the name limit. */
export function landingDocumentName(job: { company: string | null; title: string }): string {
  const clean = (s: string) => s.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()
  const who = clean(job.company ?? '') || clean(job.title)
  return `Cover letter - ${who}`.slice(0, MAX_WRITING_DESK_DOCUMENT_NAME_LENGTH).trim() || 'Cover letter'
}

export type LandResult =
  | { kind: 'landed'; documentId: string; created: boolean }
  | { kind: 'draft_exists'; documentId: string }
  | { kind: 'limit' }
  | { kind: 'aborted'; documentId: string | null }
  | { kind: 'error'; message: string; documentId: string | null }

/**
 * Creates the draft. `onTarget` runs once the document is known and before
 * the draft is written; when it returns false (the run can no longer be
 * written) nothing is drafted, so a dead run leaves no orphan draft.
 */
export async function landLetter(
  profileId: string,
  job: { id: string; company: string | null; title: string },
  markdown: string,
  opts: { isOpen?: () => Promise<boolean>; onTarget?: (documentId: string) => Promise<boolean> } = {},
): Promise<LandResult> {
  let documentId = await findLandingTarget(profileId, job.id)
  let created = false
  if (!documentId) {
    if (opts.isOpen && !(await opts.isOpen())) return { kind: 'aborted', documentId: null }
    const made = await createWritingDeskDocument(profileId, { jobId: job.id, name: landingDocumentName(job), documentType: 'cover-letter' })
    if (!made.ok) return made.reason === 'limit' ? { kind: 'limit' } : { kind: 'error', message: made.message, documentId: null }
    documentId = made.id
    created = true
  }
  if (opts.onTarget && !(await opts.onTarget(documentId))) return { kind: 'aborted', documentId }
  const draft = await landGeneratedDraft(profileId, documentId, markdown, 'cover-letter')
  if (draft.ok) return { kind: 'landed', documentId, created }
  if (draft.reason === 'draft_exists') return { kind: 'draft_exists', documentId }
  return { kind: 'error', message: draft.message, documentId }
}
