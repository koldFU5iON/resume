// Per-job agent draft, stored beside the live Writing Desk content.
//
// Session-free: every function takes the caller's profileId first and filters
// every query by it. Agent writes (createDraft, editDraftSection) are validated
// and logged to WritingDeskDraftEvent; owner writes (saveDraftContent,
// acceptDraft, discardDraft) are not logged and are not blocked by validation
// issues. Provenance lives only in the event table, never in content.
//
// Concurrency: every draft write bumps draftRevision and is a single
// updateMany guarded on the revision the caller read (or expected), so an
// agent edit can never overwrite an owner edit it did not see, and accept
// copies exactly the draft the owner reviewed into the live document.

import { prisma } from "@/lib/db"
import { buildProfileSnapshot } from "@/modules/profile/snapshot"
import { checkFacts, type FactWarning } from "./fact-check"
import { MAX_WRITING_DESK_CONTENT_LENGTH } from "./schema"
import { applySectionOp, splitSections, type DraftSection, type SectionOp } from "./sections"
import { validateDraftMarkdown, type DraftIssue } from "./validate"

export type DraftState = {
  deskId: string
  jobId: string
  content: string
  draftRevision: number
  liveRevision: number
  sections: DraftSection[]
  warnings: FactWarning[]
  issues: DraftIssue[]
}

export type DraftFailureReason =
  | "job_not_found"
  | "no_draft"
  | "draft_exists"
  | "wrong_document_type"
  | "invalid"
  | "conflict"
  | "section_not_found"
  | "hash_mismatch"
  | "live_changed"

export type DraftFailure = {
  ok: false
  reason: DraftFailureReason
  message: string
  issues?: DraftIssue[]
  sections?: DraftSection[]
  current?: DraftSection
  draft?: { content: string; draftRevision: number }
}

export type DraftResult<T = DraftState> = { ok: true; value: T } | DraftFailure

type Actor = { tokenId: string }

/** Lost updateMany races tolerated by editDraftSection before it reports conflict. */
const MAX_EDIT_ATTEMPTS = 3

const DRAFT_DOCUMENT_TYPE = "cv"

const DESK_SELECT = {
  id: true,
  jobApplicationId: true,
  documentType: true,
  draftContent: true,
  draftRevision: true,
  revision: true,
} as const

const OP_TOOL: Record<SectionOp["type"], string> = {
  replace: "replace_section",
  insert: "insert_section",
  remove: "remove_section",
}

const MESSAGES = {
  job_not_found: "Job not found.",
  no_draft: "This job has no draft. Create one with create_draft.",
  draft_exists: "A draft already exists for this job. Edit it section by section instead.",
  wrong_document_type: "This job's Writing Desk holds a different document type; agent drafts are CVs only.",
  invalid: "The draft failed validation. Fix the listed errors and retry.",
  conflict: "The draft changed while this write was in progress. Re-read it and retry.",
  section_not_found: "No section has that id. Use one of the listed section ids.",
  hash_mismatch: "That section changed since you read it. Re-read the current text and retry.",
  live_changed: "The live document changed since this draft was reviewed. Review the new difference first.",
} satisfies Record<DraftFailureReason, string>

function fail(reason: DraftFailureReason, extra: Omit<DraftFailure, "ok" | "reason" | "message"> & { message?: string } = {}): DraftFailure {
  const { message, ...rest } = extra
  return { ok: false, reason, message: message ?? MESSAGES[reason], ...rest }
}

async function findOwnedJob(profileId: string, jobId: string) {
  return prisma.jobApplication.findFirst({
    where: { id: jobId, profileId },
    select: { id: true },
  })
}

async function findDeskById(profileId: string, deskId: string) {
  return prisma.writingDeskDocument.findFirst({
    where: { id: deskId, profileId },
    select: DESK_SELECT,
  })
}

async function findDeskByJob(profileId: string, jobId: string) {
  return prisma.writingDeskDocument.findFirst({
    where: { jobApplicationId: jobId, profileId },
    select: DESK_SELECT,
  })
}

async function buildState(
  profileId: string,
  desk: { id: string; jobApplicationId: string; revision: number },
  content: string,
  draftRevision: number,
): Promise<DraftState> {
  const profile = await buildProfileSnapshot(profileId)
  return {
    deskId: desk.id,
    jobId: desk.jobApplicationId,
    content,
    draftRevision,
    liveRevision: desk.revision,
    sections: splitSections(content),
    warnings: checkFacts(content, profile),
    issues: validateDraftMarkdown(content).issues,
  }
}

/**
 * Applies a guarded draft write and, only if it landed, records the agent
 * event in the same transaction. Returns false when the guard matched no row.
 */
async function writeAgentDraft(
  guarded: { where: Record<string, unknown>; data: Record<string, unknown> },
  event: { writingDeskId: string; apiTokenId: string | null; tool: string; detail?: Record<string, string> },
): Promise<boolean> {
  return prisma.$transaction(async tx => {
    const updated = await tx.writingDeskDocument.updateMany(guarded)
    if (updated.count === 0) return false
    await tx.writingDeskDraftEvent.create({ data: event })
    return true
  })
}

export async function createDraft(
  profileId: string,
  jobId: string,
  content: string,
  actor?: Actor,
): Promise<DraftResult> {
  const job = await findOwnedJob(profileId, jobId)
  if (!job) return fail("job_not_found")

  const validation = validateDraftMarkdown(content)
  if (!validation.ok) return fail("invalid", { issues: validation.issues })

  const desk = await prisma.writingDeskDocument.upsert({
    where: { jobApplicationId: job.id },
    update: {},
    create: { profileId, jobApplicationId: job.id },
    select: { id: true, documentType: true, draftContent: true, draftRevision: true, revision: true },
  })
  if (desk.documentType !== null && desk.documentType !== DRAFT_DOCUMENT_TYPE) return fail("wrong_document_type")
  if (desk.draftContent !== null) return fail("draft_exists")

  const written = await writeAgentDraft(
    {
      where: {
        id: desk.id,
        profileId,
        draftContent: null,
        draftRevision: desk.draftRevision,
        OR: [{ documentType: null }, { documentType: DRAFT_DOCUMENT_TYPE }],
      },
      data: {
        draftContent: content,
        draftRevision: { increment: 1 },
        draftUpdatedAt: new Date(),
        documentType: DRAFT_DOCUMENT_TYPE,
      },
    },
    { writingDeskId: desk.id, apiTokenId: actor?.tokenId ?? null, tool: "create_draft" },
  )

  if (!written) {
    const fresh = await findDeskById(profileId, desk.id)
    if (fresh?.documentType && fresh.documentType !== DRAFT_DOCUMENT_TYPE) return fail("wrong_document_type")
    if (fresh?.draftContent != null) return fail("draft_exists")
    return fail("conflict")
  }

  return {
    ok: true,
    value: await buildState(profileId, { ...desk, jobApplicationId: job.id }, content, desk.draftRevision + 1),
  }
}

export async function getDraft(profileId: string, jobId: string): Promise<DraftResult> {
  const job = await findOwnedJob(profileId, jobId)
  if (!job) return fail("job_not_found")

  const desk = await findDeskByJob(profileId, job.id)
  if (!desk || desk.draftContent === null) return fail("no_draft")

  return { ok: true, value: await buildState(profileId, desk, desk.draftContent, desk.draftRevision) }
}

function opDetail(op: SectionOp): Record<string, string> {
  if (op.type !== "insert") return { sectionId: op.sectionId }
  return op.afterSectionId !== undefined ? { afterSectionId: op.afterSectionId } : { position: op.position ?? "" }
}

export async function editDraftSection(
  profileId: string,
  jobId: string,
  op: SectionOp,
  actor?: Actor,
): Promise<DraftResult> {
  const job = await findOwnedJob(profileId, jobId)
  if (!job) return fail("job_not_found")

  for (let attempt = 0; attempt < MAX_EDIT_ATTEMPTS; attempt++) {
    const desk = await findDeskByJob(profileId, job.id)
    if (!desk || desk.draftContent === null) return fail("no_draft")

    const applied = applySectionOp(desk.draftContent, op)
    if (!applied.ok) {
      if (applied.reason === "invalid_op") {
        return fail("invalid", {
          sections: applied.sections,
          ...(applied.current ? { current: applied.current } : {}),
          ...(applied.message ? { message: applied.message } : {}),
        })
      }
      return fail(applied.reason, {
        sections: applied.sections,
        ...(applied.current ? { current: applied.current } : {}),
      })
    }

    const validation = validateDraftMarkdown(applied.markdown)
    if (!validation.ok) return fail("invalid", { issues: validation.issues })

    const written = await writeAgentDraft(
      {
        where: { id: desk.id, profileId, draftRevision: desk.draftRevision, draftContent: { not: null } },
        data: { draftContent: applied.markdown, draftRevision: { increment: 1 }, draftUpdatedAt: new Date() },
      },
      { writingDeskId: desk.id, apiTokenId: actor?.tokenId ?? null, tool: OP_TOOL[op.type], detail: opDetail(op) },
    )
    if (written) {
      return { ok: true, value: await buildState(profileId, desk, applied.markdown, desk.draftRevision + 1) }
    }
  }

  return fail("conflict")
}

export async function saveDraftContent(
  profileId: string,
  deskId: string,
  content: string,
  expectedDraftRevision: number,
): Promise<DraftResult<{ draftRevision: number }>> {
  if (content.length > MAX_WRITING_DESK_CONTENT_LENGTH) {
    return fail("invalid", {
      message: `Draft is ${content.length} characters, over the ${MAX_WRITING_DESK_CONTENT_LENGTH} limit.`,
    })
  }

  const updated = await prisma.writingDeskDocument.updateMany({
    where: { id: deskId, profileId, draftRevision: expectedDraftRevision, draftContent: { not: null } },
    data: { draftContent: content, draftRevision: { increment: 1 }, draftUpdatedAt: new Date() },
  })
  if (updated.count > 0) return { ok: true, value: { draftRevision: expectedDraftRevision + 1 } }

  const desk = await findDeskById(profileId, deskId)
  if (!desk || desk.draftContent === null) return fail("no_draft")
  return fail("conflict", { draft: { content: desk.draftContent, draftRevision: desk.draftRevision } })
}

export async function acceptDraft(
  profileId: string,
  deskId: string,
  expectedLiveRevision: number,
  expectedDraftRevision: number,
): Promise<DraftResult<{ revision: number }>> {
  const classify = (desk: Awaited<ReturnType<typeof findDeskById>>): DraftFailure | null => {
    if (!desk || desk.draftContent === null) return fail("no_draft")
    if (desk.revision !== expectedLiveRevision) return fail("live_changed")
    if (desk.draftRevision !== expectedDraftRevision) {
      return fail("conflict", { draft: { content: desk.draftContent, draftRevision: desk.draftRevision } })
    }
    return null
  }

  const desk = await findDeskById(profileId, deskId)
  const failure = classify(desk)
  if (failure || !desk || desk.draftContent === null) return failure ?? fail("no_draft")

  // The draftRevision guard makes the copied content exactly the draft read above.
  const updated = await prisma.writingDeskDocument.updateMany({
    where: {
      id: deskId,
      profileId,
      revision: expectedLiveRevision,
      draftRevision: expectedDraftRevision,
      draftContent: { not: null },
    },
    data: {
      content: desk.draftContent,
      revision: { increment: 1 },
      draftContent: null,
      draftUpdatedAt: null,
      draftRevision: { increment: 1 },
    },
  })
  if (updated.count > 0) return { ok: true, value: { revision: expectedLiveRevision + 1 } }

  return classify(await findDeskById(profileId, deskId)) ?? fail("conflict")
}

export async function discardDraft(profileId: string, deskId: string): Promise<DraftResult<Record<string, never>>> {
  const updated = await prisma.writingDeskDocument.updateMany({
    where: { id: deskId, profileId, draftContent: { not: null } },
    data: { draftContent: null, draftUpdatedAt: null, draftRevision: { increment: 1 } },
  })
  if (updated.count === 0) return fail("no_draft")
  return { ok: true, value: {} }
}

export async function listDraftEvents(
  profileId: string,
  deskId: string,
  limit = 20,
): Promise<Array<{ tool: string; createdAt: Date; apiTokenId: string | null }>> {
  return prisma.writingDeskDraftEvent.findMany({
    where: { writingDeskId: deskId, writingDesk: { profileId } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { tool: true, createdAt: true, apiTokenId: true },
  })
}
