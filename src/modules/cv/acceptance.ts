// Accepted CVs: the CV that was (or will be) sent for a job. Used to report
// cost per accepted CV (see src/modules/llm/job-cost.ts).
//
// Rules:
// - Only a job CV in `draft` can be accepted. Master / career-vertical CVs
//   (no job) can't: they aren't sent anywhere, and master CV lookups read
//   `status: 'draft'`.
// - Manual: the user marks it from the CV builder (`acceptedVia: 'manual'`).
// - Shortcut: when the job moves to applied (or straight to interviewing),
//   its most recent draft CV is accepted (`acceptedVia: 'applied'`), unless
//   the job already has an accepted CV.
// - Editing an accepted CV keeps it accepted. Regenerating one doesn't touch
//   it: the new content goes into a new draft CV (see `regenerateCVContent`).
// - The user can undo an acceptance, which puts the CV back to draft.
//
// Every query filters by profileId.

import { prisma } from '@/lib/db'

export const CV_STATUS = {
  Generating: 'generating',
  Draft: 'draft',
  Failed: 'failed',
  Accepted: 'accepted',
} as const

export type CVAcceptedVia = 'manual' | 'applied'

export type AcceptCVResult =
  | { ok: true; acceptedAt: Date }
  | { ok: false; reason: 'not_found' | 'no_job' | 'not_ready' | 'already_accepted' }

/** Marks one of the profile's job CVs as accepted. Only a draft can be accepted. */
export async function acceptCV(profileId: string, cvId: string, now = new Date()): Promise<AcceptCVResult> {
  const res = await prisma.cVDocument.updateMany({
    // The linked job must be the profile's own, not just the CV.
    where: { id: cvId, profileId, status: CV_STATUS.Draft, jobApplication: { profileId } },
    data: { status: CV_STATUS.Accepted, acceptedAt: now, acceptedVia: 'manual' satisfies CVAcceptedVia },
  })
  if (res.count === 1) return { ok: true, acceptedAt: now }

  const doc = await prisma.cVDocument.findFirst({
    where: { id: cvId, profileId },
    select: { status: true, jobApplication: { select: { profileId: true } } },
  })
  if (!doc) return { ok: false, reason: 'not_found' }
  if (doc.jobApplication?.profileId !== profileId) return { ok: false, reason: 'no_job' }
  if (doc.status === CV_STATUS.Accepted) return { ok: false, reason: 'already_accepted' }
  return { ok: false, reason: 'not_ready' }
}

/** Undoes an acceptance (either kind): the CV goes back to draft. */
export async function unacceptCV(profileId: string, cvId: string): Promise<boolean> {
  const res = await prisma.cVDocument.updateMany({
    where: { id: cvId, profileId, status: CV_STATUS.Accepted },
    data: { status: CV_STATUS.Draft, acceptedAt: null, acceptedVia: null },
  })
  return res.count === 1
}

/**
 * The applied shortcut: accepts the job's most recent draft CV when the job
 * has no accepted CV yet. Returns the accepted CV id, or null when nothing
 * changed. The "none accepted" check is part of the UPDATE itself, so two
 * concurrent calls can't both accept.
 */
export async function acceptLatestCVForAppliedJob(
  profileId: string,
  jobApplicationId: string,
  now = new Date(),
): Promise<string | null> {
  const latest = await prisma.cVDocument.findFirst({
    where: { profileId, jobApplicationId, status: CV_STATUS.Draft },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (!latest) return null

  const res = await prisma.cVDocument.updateMany({
    where: {
      id: latest.id,
      profileId,
      jobApplicationId,
      status: CV_STATUS.Draft,
      // Only the job owner's CVs count: another profile's CV linked to this
      // job can't block the owner's acceptance.
      jobApplication: { profileId, cvDocuments: { none: { profileId, status: CV_STATUS.Accepted } } },
    },
    data: { status: CV_STATUS.Accepted, acceptedAt: now, acceptedVia: 'applied' satisfies CVAcceptedVia },
  })
  return res.count === 1 ? latest.id : null
}
