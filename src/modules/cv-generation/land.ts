/**
 * Stage 6, Land (docs/cv-generation.md, Phase 4a). No model. Puts the CV into
 * the writing desk as a DRAFT the owner accepts or discards in the existing
 * DraftReview: nothing here writes live document content.
 *
 * Target document: the job's previously generated CV document when one still
 * exists (the newest run of this job with a `writingDeskDocumentId` whose
 * document is still a `cv` of the same profile and job), else a new `cv`
 * document made with `createWritingDeskDocument` (which takes the per-job
 * advisory lock and enforces the 10-document limit). Then `createDraft`.
 *
 * Two checks protect a pending draft: `checkLandingTarget` runs BEFORE any
 * model spend (the start request answers 409 draft_exists and creates no
 * run), and `landCv` handles the race (a draft created meanwhile) by
 * reporting `draft_exists`, so the runner can fail the run with the generated
 * markdown kept on it.
 *
 * Every query filters by profileId.
 */

import { prisma } from '@/lib/db'
import { createWritingDeskDocument } from '@/modules/writing-desk/documents'
import { createDraft } from '@/modules/writing-desk/draft'
import { MAX_WRITING_DESK_DOCUMENT_NAME_LENGTH, MAX_WRITING_DESK_DOCUMENTS_PER_JOB } from '@/modules/writing-desk/schema'

/** The job's previous generated CV document, or null when there is none (or it was deleted or retyped). */
export async function findLandingTarget(profileId: string, jobId: string): Promise<{ documentId: string } | null> {
  const row = await prisma.cvGeneration.findFirst({
    where: {
      profileId,
      jobApplicationId: jobId,
      writingDeskDocumentId: { not: null },
      writingDeskDocument: { is: { profileId, jobApplicationId: jobId, documentType: 'cv' } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { writingDeskDocumentId: true },
  })
  return row?.writingDeskDocumentId ? { documentId: row.writingDeskDocumentId } : null
}

export type LandingCheck =
  /** `documentId` is the existing document the draft will go to, null when a new one will be created. */
  | { kind: 'ok'; documentId: string | null }
  | { kind: 'draft_exists'; documentId: string }
  | { kind: 'limit' }

/** Whether a run could land right now. Cheap, no model: used before any spend. */
export async function checkLandingTarget(profileId: string, jobId: string): Promise<LandingCheck> {
  const target = await findLandingTarget(profileId, jobId)
  if (target) {
    const pending = await prisma.writingDeskDocument.count({ where: { id: target.documentId, profileId, draftContent: { not: null } } })
    return pending > 0 ? { kind: 'draft_exists', documentId: target.documentId } : { kind: 'ok', documentId: target.documentId }
  }
  const documents = await prisma.writingDeskDocument.count({ where: { profileId, jobApplicationId: jobId } })
  return documents >= MAX_WRITING_DESK_DOCUMENTS_PER_JOB ? { kind: 'limit' } : { kind: 'ok', documentId: null }
}

/** "CV - Acme", cut to the name limit; without a company "CV - <job title>". Control characters are removed (the name schema refuses them). */
export function landingDocumentName(job: { company: string | null; title: string }): string {
  const clean = (s: string) => s.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()
  const who = clean(job.company ?? '') || clean(job.title)
  return `CV - ${who}`.slice(0, MAX_WRITING_DESK_DOCUMENT_NAME_LENGTH).trim() || 'CV'
}

export type LandResult =
  | { kind: 'landed'; documentId: string; created: boolean }
  /** A draft is already waiting there (it appeared since the start check): nothing was written. */
  | { kind: 'draft_exists'; documentId: string }
  | { kind: 'limit' }
  | { kind: 'error'; message: string; documentId: string | null }

/**
 * Creates the draft. `onTarget` is called as soon as the document is known
 * (before the draft is written), so the run row records it even if the draft
 * then fails and a later run reuses the same document.
 */
export async function landCv(
  profileId: string,
  job: { id: string; company: string | null; title: string },
  markdown: string,
  opts: { onTarget?: (documentId: string) => Promise<void> } = {},
): Promise<LandResult> {
  let documentId: string
  let created = false
  const target = await findLandingTarget(profileId, job.id)
  if (target) {
    documentId = target.documentId
  } else {
    const made = await createWritingDeskDocument(profileId, { jobId: job.id, name: landingDocumentName(job), documentType: 'cv' })
    if (!made.ok) return made.reason === 'limit' ? { kind: 'limit' } : { kind: 'error', message: made.message, documentId: null }
    documentId = made.id
    created = true
  }
  await opts.onTarget?.(documentId)

  const draft = await createDraft(profileId, { jobId: job.id, documentId }, markdown)
  if (draft.ok) return { kind: 'landed', documentId, created }
  if (draft.reason === 'draft_exists') return { kind: 'draft_exists', documentId }
  return { kind: 'error', message: draft.message, documentId }
}
