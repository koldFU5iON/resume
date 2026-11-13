/**
 * Document navigation for the job workspace (#369): which destinations a job
 * has, in the agreed order, and which one a pathname belongs to. Pure: no
 * React, no server imports, so the client nav and unit tests share it.
 *
 * Order (design #365): Job Description first, then the job's documents —
 * its named Writing Desk documents (oldest first, #370), then the legacy CV,
 * Cover Letter and Interview Prep editors. Deep Dive is opened from the
 * header, not a document tab.
 */

import {
  MAX_WRITING_DESK_DOCUMENTS_PER_JOB,
  WRITING_DESK_DOCUMENT_TYPE_LABEL,
  type WritingDeskDocumentType,
} from "@/modules/writing-desk/schema"

export type JobDocumentKind = "description" | "writing-desk" | "cv" | "cover-letter" | "interview-prep"

export type JobDocumentLink = {
  /** Unique within the job's links: the kind, or `writing-desk:<documentId>` for a named document. */
  key: string
  kind: JobDocumentKind
  label: string
  /** Extra context shown beside the label: a desk's document type, or a legacy asset's editor. */
  detail?: string
  href: string
  /** A legacy structured editor, marked "Deprecating soon" (#379). */
  deprecated?: true
}

/**
 * A legacy structured editor's creation flow (CV Builder, cover letter,
 * interview prep) for an asset the job doesn't have yet. These are not
 * Writing Desk documents; the "+" dialog creates those.
 */
export type JobDocumentCreateLink = {
  kind: Exclude<JobDocumentKind, "description" | "writing-desk">
  label: string
  href: string
}

/** The legacy editors' kinds: being replaced by Writing Desk documents (#379). */
export function isLegacyDocumentKind(kind: JobDocumentKind): kind is JobDocumentCreateLink["kind"] {
  return kind === "cv" || kind === "cover-letter" || kind === "interview-prep"
}

export type JobDocumentAssets = {
  jobId: string
  cvDocumentId: string | null
  coverLetterDocumentId: string | null
  interviewPrepSessionId: string | null
  /** The job's Writing Desk documents, primary (oldest) first. */
  writingDesks: JobWritingDeskTab[]
}

export type JobWritingDeskTab = { id: string; name: string; documentType: WritingDeskDocumentType | null }

/** A legacy document the current page shows; its tab points at it rather than the job's newest one. */
export type CurrentJobDocument = { kind: "cv" | "cover-letter" | "interview-prep"; id: string }

const ASSET_FIELD = {
  cv: "cvDocumentId",
  "cover-letter": "coverLetterDocumentId",
  "interview-prep": "interviewPrepSessionId",
} as const satisfies Record<CurrentJobDocument["kind"], keyof JobDocumentAssets>

export function withCurrentDocument(assets: JobDocumentAssets, current?: CurrentJobDocument): JobDocumentAssets {
  return current ? { ...assets, [ASSET_FIELD[current.kind]]: current.id } : assets
}

export function jobHubHref(jobId: string): string {
  return `/dashboard/job-applications/view/${jobId}`
}

export function jobDeepDiveHref(jobId: string): string {
  return `${jobHubHref(jobId)}/deep-dive`
}

/**
 * The job-scoped Writing Desk URL. Kept for old links: it opens the job's
 * primary (oldest) document, creating a blank one when there is none.
 */
export function jobWritingDeskHref(jobId: string): string {
  return `${jobHubHref(jobId)}/writing`
}

/** One Writing Desk document's stable URL. */
export function writingDeskDocumentHref(jobId: string, documentId: string): string {
  return `${jobWritingDeskHref(jobId)}/${documentId}`
}

/** One Writing Desk document's PDF export. */
export function writingDeskPdfHref(jobId: string, documentId: string): string {
  return `/api/writing-desk/${encodeURIComponent(jobId)}/documents/${encodeURIComponent(documentId)}/pdf`
}

function deskTab(jobId: string, desk: JobWritingDeskTab): JobDocumentLink {
  const type = desk.documentType ? WRITING_DESK_DOCUMENT_TYPE_LABEL[desk.documentType] : undefined
  return {
    key: `writing-desk:${desk.id}`,
    kind: "writing-desk",
    label: desk.name,
    detail: type && type !== desk.name ? type : undefined,
    href: writingDeskDocumentHref(jobId, desk.id),
  }
}

/**
 * The job's destinations, in navigation order. Each Writing Desk document is
 * its own tab, named for the document. A job with none has no Writing Desk
 * tab: "+" creates documents (#371). Legacy assets appear only when they exist.
 */
export function jobDocumentLinks(assets: JobDocumentAssets): JobDocumentLink[] {
  const hub = jobHubHref(assets.jobId)
  const links: JobDocumentLink[] = [{ key: "description", kind: "description", label: "Job Description", href: hub }]
  links.push(...assets.writingDesks.map(desk => deskTab(assets.jobId, desk)))
  if (assets.cvDocumentId) {
    links.push({ key: "cv", kind: "cv", label: "CV", detail: "CV Builder", href: `/dashboard/cv-builder/${assets.cvDocumentId}`, deprecated: true })
  }
  if (assets.coverLetterDocumentId) {
    links.push({ key: "cover-letter", kind: "cover-letter", label: "Cover Letter", detail: "Cover letter editor", href: `/dashboard/cover-letters/${assets.coverLetterDocumentId}`, deprecated: true })
  }
  if (assets.interviewPrepSessionId) {
    links.push({ key: "interview-prep", kind: "interview-prep", label: "Interview Prep", detail: "Prep session", href: `/dashboard/interview-prep/${assets.interviewPrepSessionId}`, deprecated: true })
  }
  return links
}

/**
 * The legacy editors' creation flows for assets the job doesn't have yet
 * (what the old hub sidebar offered as "Create CV" and friends). Empty when
 * every legacy asset exists.
 */
export function jobDocumentCreateLinks(assets: JobDocumentAssets): JobDocumentCreateLink[] {
  const jobId = encodeURIComponent(assets.jobId)
  const links: JobDocumentCreateLink[] = []
  if (!assets.cvDocumentId) links.push({ kind: "cv", label: "Generate a CV", href: `/dashboard/cv-builder/new?jobId=${jobId}` })
  if (!assets.coverLetterDocumentId) links.push({ kind: "cover-letter", label: "Create a cover letter", href: `/dashboard/cover-letters/new?jobId=${jobId}` })
  if (!assets.interviewPrepSessionId) links.push({ kind: "interview-prep", label: "Start interview prep", href: `/dashboard/interview-prep/new?jobId=${jobId}` })
  return links
}

/** Whether the job can take another Writing Desk document (the per-job cap). */
export function canAddWritingDeskDocument(assets: JobDocumentAssets): boolean {
  return assets.writingDesks.length < MAX_WRITING_DESK_DOCUMENTS_PER_JOB
}

/**
 * The Writing Desk document id a pathname opens when the nav doesn't list it
 * yet, else null. That happens when the page created the document after the
 * (shared, client-cached) layout rendered: the legacy /writing URL creating a
 * job's first document, or an agent adding one elsewhere. The nav refreshes
 * once so the tab appears with its name.
 */
export function unlistedWritingDeskDocument(pathname: string, assets: JobDocumentAssets): string | null {
  const prefix = `${jobWritingDeskHref(assets.jobId)}/`
  const path = pathname.replace(/\/+$/, "")
  if (!path.startsWith(prefix)) return null
  const id = decodeURIComponent(path.slice(prefix.length).split("/")[0] ?? "")
  if (!id || assets.writingDesks.some(desk => desk.id === id)) return null
  return id
}

function isAt(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * The key of the link a pathname shows, or null (e.g. the Deep Dive, which
 * the header marks instead). Job Description matches the hub path exactly so
 * its sub-routes don't light it up.
 */
export function activeJobDocument(pathname: string, links: readonly JobDocumentLink[]): string | null {
  const path = pathname.replace(/\/+$/, "")
  for (const link of links) {
    if (link.kind === "description" ? path === link.href : isAt(path, link.href)) return link.key
  }
  return null
}

export function isJobDeepDivePath(pathname: string, jobId: string): boolean {
  return isAt(pathname.replace(/\/+$/, ""), jobDeepDiveHref(jobId))
}

/**
 * Compact-header state for the mobile job workspace, with hysteresis: compact
 * only past `compactAt` (and only when the content can scroll well beyond it,
 * so the extra room never pulls scrollTop back under `expandAt`), restore only
 * near the top. An explicit expand (`pinned`) holds until the user is back
 * near the top.
 */
export const COMPACT_HEADER_AT = 80
export const EXPAND_HEADER_AT = 24
/** Roughly how much taller the content gets when the header compacts. */
export const COMPACT_HEADER_SLACK = 120

export function nextCompactState(
  current: boolean,
  { scrollTop, maxScroll, pinned }: { scrollTop: number; maxScroll: number; pinned: boolean },
): boolean {
  if (scrollTop < EXPAND_HEADER_AT) return false
  if (pinned) return false
  if (!current && scrollTop > COMPACT_HEADER_AT && maxScroll > COMPACT_HEADER_AT + COMPACT_HEADER_SLACK) return true
  return current
}
