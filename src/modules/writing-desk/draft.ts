// Per-document agent draft, stored beside the live Writing Desk content.
//
// Agent calls address a job and, optionally, one of its documents (#370).
// They never guess: an explicit documentId must belong to the profile and the
// job; without one, the job's only document is used (created on create_draft
// when it has none), and a job with several documents is refused with
// document_required, listing them. Owner calls address the document by id.
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
import { fillContactPlaceholder, hasContactPlaceholder } from "@/modules/profile-map/contact"
import type { Contact } from "@/modules/profile-map/types"
import { findOwnedJob, lockJobDocuments } from "./documents"
import { checkFacts, type FactWarning } from "./fact-check"
import {
  DEFAULT_WRITING_DESK_DOCUMENT_NAME,
  MAX_WRITING_DESK_CONTENT_LENGTH,
  WRITING_DESK_DOCUMENT_ORDER,
  WRITING_DESK_DOCUMENT_TYPE_LABEL,
} from "./schema"
import { applySectionOp, splitSections, type DraftSection, type SectionOp } from "./sections"
import { validateDraftMarkdown, type DraftIssue } from "./validate"

/** Which document an agent call means: a job, plus a document id when the job has several. */
export type DeskRef = { jobId: string; documentId?: string }

export type DraftState = {
  deskId: string
  documentName: string
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
  | "document_not_found"
  | "document_required"
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

/** How many of a job's documents a document_required failure lists. */
const MAX_LISTED_DOCUMENTS = 20

const DESK_SELECT = {
  id: true,
  name: true,
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
  document_not_found: "No Writing Desk document with that id belongs to this job. Pass a documentId from get_job_context, or omit it when the job has one document.",
  document_required: "This job has several Writing Desk documents. Pass documentId to choose one.",
  no_draft: "This document has no draft. Create one with create_draft.",
  draft_exists: "A draft already exists for this document. Edit it section by section instead.",
  wrong_document_type: "This Writing Desk document holds a different document type; agent drafts are CVs only.",
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

async function findDeskById(profileId: string, deskId: string) {
  return prisma.writingDeskDocument.findFirst({
    where: { id: deskId, profileId },
    select: DESK_SELECT,
  })
}

type AgentDesk = NonNullable<Awaited<ReturnType<typeof findDeskById>>>

function documentRequired(docs: AgentDesk[]): DraftFailure {
  const shown = docs.slice(0, MAX_LISTED_DOCUMENTS)
  const lines = shown.map(doc => {
    const type = doc.documentType ? WRITING_DESK_DOCUMENT_TYPE_LABEL[doc.documentType as keyof typeof WRITING_DESK_DOCUMENT_TYPE_LABEL] ?? doc.documentType : "no type yet"
    return `- ${doc.id}: "${doc.name}" (${type}${doc.draftContent !== null ? ", has a draft" : ""})`
  })
  const more = docs.length > shown.length ? "\n- ...and more; see get_job_context." : ""
  return fail("document_required", {
    message: `This job has several Writing Desk documents. Nothing was chosen or written. Pass documentId to choose one:\n${lines.join("\n")}${more}`,
  })
}

const DEFAULT_DRAFT_TARGET_NAMES = new Set<string>([WRITING_DESK_DOCUMENT_TYPE_LABEL.cv, DEFAULT_WRITING_DESK_DOCUMENT_NAME])

/** A document an agent may write to without naming it: a CV, or an untyped one still on a default name. */
export function isImplicitDraftTarget(doc: { name: string; documentType: string | null }): boolean {
  if (doc.documentType === DRAFT_DOCUMENT_TYPE) return true
  return doc.documentType === null && DEFAULT_DRAFT_TARGET_NAMES.has(doc.name)
}

/**
 * The document an agent call addresses (see the header). `create` makes the
 * job's first document, named "CV", when it has none; it runs under the
 * job's document lock so it can't race another first document into being.
 * A null desk means the job has no document (only without `create`).
 */
async function resolveAgentDesk(
  profileId: string,
  jobId: string,
  documentId: string | undefined,
  { create }: { create: boolean },
): Promise<{ ok: true; desk: AgentDesk | null } | DraftFailure> {
  if (documentId !== undefined) {
    const desk = await prisma.writingDeskDocument.findFirst({
      where: { id: documentId, profileId, jobApplicationId: jobId },
      select: DESK_SELECT,
    })
    return desk ? { ok: true, desk } : fail("document_not_found")
  }

  const pick = async (db: Pick<typeof prisma, "writingDeskDocument">) => {
    const docs = await db.writingDeskDocument.findMany({
      where: { profileId, jobApplicationId: jobId },
      orderBy: WRITING_DESK_DOCUMENT_ORDER,
      take: MAX_LISTED_DOCUMENTS + 1,
      select: DESK_SELECT,
    })
    if (docs.length > 1) return documentRequired(docs)
    const only = docs[0]
    // Never pick a document the user named for something else (e.g. "Interview
    // notes" with no type yet): an implicit write would retype it as a CV.
    if (only && !isImplicitDraftTarget(only)) {
      return fail("document_required", {
        message: `This job's only Writing Desk document, "${only.name}" (${only.id}), isn't a CV. Nothing was written. Pass its documentId only if the user wants a CV draft there.`,
      })
    }
    return { ok: true as const, desk: only ?? null }
  }

  if (!create) return pick(prisma)
  return prisma.$transaction(async tx => {
    await lockJobDocuments(tx, jobId)
    const picked = await pick(tx)
    if (!picked.ok || picked.desk) return picked
    const desk = await tx.writingDeskDocument.create({
      data: { profileId, jobApplicationId: jobId, name: WRITING_DESK_DOCUMENT_TYPE_LABEL.cv },
      select: DESK_SELECT,
    })
    return { ok: true as const, desk }
  })
}

async function buildState(
  profileId: string,
  desk: { id: string; name: string; jobApplicationId: string; revision: number },
  content: string,
  draftRevision: number,
): Promise<DraftState> {
  const profile = await buildProfileSnapshot(profileId)
  return {
    deskId: desk.id,
    documentName: desk.name,
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
  ref: DeskRef,
  content: string,
  actor?: Actor,
): Promise<DraftResult> {
  const job = await findOwnedJob(profileId, ref.jobId)
  if (!job) return fail("job_not_found")

  const validation = validateDraftMarkdown(content)
  if (!validation.ok) return fail("invalid", { issues: validation.issues })

  const resolved = await resolveAgentDesk(profileId, job.id, ref.documentId, { create: true })
  if (!resolved.ok) return resolved
  const desk = resolved.desk
  if (!desk) return fail("conflict")
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
    if (!fresh) return fail("document_not_found") // deleted since it was resolved
    if (fresh.documentType && fresh.documentType !== DRAFT_DOCUMENT_TYPE) return fail("wrong_document_type")
    if (fresh.draftContent != null) return fail("draft_exists")
    return fail("conflict")
  }

  return {
    ok: true,
    value: await buildState(profileId, desk, content, desk.draftRevision + 1),
  }
}

export async function getDraft(profileId: string, ref: DeskRef): Promise<DraftResult> {
  const job = await findOwnedJob(profileId, ref.jobId)
  if (!job) return fail("job_not_found")

  const resolved = await resolveAgentDesk(profileId, job.id, ref.documentId, { create: false })
  if (!resolved.ok) return resolved
  const desk = resolved.desk
  if (!desk || desk.draftContent === null) return fail("no_draft")

  return { ok: true, value: await buildState(profileId, desk, desk.draftContent, desk.draftRevision) }
}

function opDetail(op: SectionOp): Record<string, string> {
  if (op.type !== "insert") return { sectionId: op.sectionId }
  return op.afterSectionId !== undefined ? { afterSectionId: op.afterSectionId } : { position: op.position ?? "" }
}

export async function editDraftSection(
  profileId: string,
  ref: DeskRef,
  op: SectionOp,
  actor?: Actor,
): Promise<DraftResult> {
  const job = await findOwnedJob(profileId, ref.jobId)
  if (!job) return fail("job_not_found")

  // Resolved once: retries re-read this same document by id, never another one.
  const resolved = await resolveAgentDesk(profileId, job.id, ref.documentId, { create: false })
  if (!resolved.ok) return resolved
  let desk = resolved.desk

  for (let attempt = 0; attempt < MAX_EDIT_ATTEMPTS; attempt++) {
    if (attempt > 0 && desk) desk = await findDeskById(profileId, desk.id)
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

  // Agents never see contact details, so they write {{contact}} in the header.
  // It becomes the real contact line only here, in the owner's accept.
  const content = hasContactPlaceholder(desk.draftContent)
    ? fillContactPlaceholder(desk.draftContent, await loadContact(profileId))
    : desk.draftContent
  if (content.length > MAX_WRITING_DESK_CONTENT_LENGTH) {
    return fail("invalid", {
      message: `Filling in {{contact}} makes the document ${content.length} characters, over the ${MAX_WRITING_DESK_CONTENT_LENGTH} limit. Shorten the draft and accept again.`,
    })
  }

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
      content,
      revision: { increment: 1 },
      draftContent: null,
      draftUpdatedAt: null,
      draftRevision: { increment: 1 },
    },
  })
  if (updated.count > 0) return { ok: true, value: { revision: expectedLiveRevision + 1 } }

  return classify(await findDeskById(profileId, deskId)) ?? fail("conflict")
}

async function loadContact(profileId: string): Promise<Contact> {
  const row = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { email: true, phone: true, linkedIn: true, github: true, website: true },
  })
  return row ?? { email: null, phone: null, linkedIn: null, github: null, website: null }
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
