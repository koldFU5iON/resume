/**
 * Document navigation for the job workspace (#369): which destinations a job
 * has, in the agreed order, and which one a pathname belongs to. Pure: no
 * React, no server imports, so the client nav and unit tests share it.
 *
 * Order (design #365): Job Description first, then the job's documents —
 * the Writing Desk, then the legacy CV, Cover Letter and Interview Prep
 * editors. Deep Dive is opened from the header, not a document tab.
 */

import type { WritingDeskDocumentType } from "@/modules/writing-desk/schema"

export type JobDocumentKind = "description" | "writing-desk" | "cv" | "cover-letter" | "interview-prep"

export type JobDocumentLink = {
  kind: JobDocumentKind
  label: string
  /** Extra context for the tab's title/accessible name, e.g. the desk's document type. */
  detail?: string
  href: string
}

/** A creation flow that already exists in the app for an asset the job doesn't have yet. */
export type JobDocumentCreateLink = {
  kind: Exclude<JobDocumentKind, "description" | "writing-desk">
  label: string
  href: string
}

export type JobDocumentAssets = {
  jobId: string
  cvDocumentId: string | null
  coverLetterDocumentId: string | null
  interviewPrepSessionId: string | null
  /** The job's Writing Desk document type, `null` when it has none or no type yet. */
  writingDeskType: WritingDeskDocumentType | null
}

const DESK_TYPE_LABEL: Record<WritingDeskDocumentType, string> = {
  cv: "CV",
  "cover-letter": "Cover letter",
  "interview-prep": "Interview prep",
  other: "Other",
}

export function jobHubHref(jobId: string): string {
  return `/dashboard/job-applications/view/${jobId}`
}

export function jobDeepDiveHref(jobId: string): string {
  return `${jobHubHref(jobId)}/deep-dive`
}

/** The job's destinations, in navigation order. Legacy assets appear only when they exist. */
export function jobDocumentLinks(assets: JobDocumentAssets): JobDocumentLink[] {
  const hub = jobHubHref(assets.jobId)
  const links: JobDocumentLink[] = [
    { kind: "description", label: "Job Description", href: hub },
    {
      kind: "writing-desk",
      label: "Writing Desk",
      detail: assets.writingDeskType ? DESK_TYPE_LABEL[assets.writingDeskType] : undefined,
      href: `${hub}/writing`,
    },
  ]
  if (assets.cvDocumentId) {
    links.push({ kind: "cv", label: "CV", href: `/dashboard/cv-builder/${assets.cvDocumentId}` })
  }
  if (assets.coverLetterDocumentId) {
    links.push({ kind: "cover-letter", label: "Cover Letter", href: `/dashboard/cover-letters/${assets.coverLetterDocumentId}` })
  }
  if (assets.interviewPrepSessionId) {
    links.push({ kind: "interview-prep", label: "Interview Prep", href: `/dashboard/interview-prep/${assets.interviewPrepSessionId}` })
  }
  return links
}

/**
 * The existing creation flows for assets the job doesn't have yet (what the
 * old hub sidebar offered as "Create CV" and friends). Empty when every
 * legacy asset exists: creating further documents is Phase 3 (#371).
 */
export function jobDocumentCreateLinks(assets: JobDocumentAssets): JobDocumentCreateLink[] {
  const jobId = encodeURIComponent(assets.jobId)
  const links: JobDocumentCreateLink[] = []
  if (!assets.cvDocumentId) links.push({ kind: "cv", label: "Generate a CV", href: `/dashboard/cv-builder/new?jobId=${jobId}` })
  if (!assets.coverLetterDocumentId) links.push({ kind: "cover-letter", label: "Create a cover letter", href: `/dashboard/cover-letters/new?jobId=${jobId}` })
  if (!assets.interviewPrepSessionId) links.push({ kind: "interview-prep", label: "Start interview prep", href: `/dashboard/interview-prep/new?jobId=${jobId}` })
  return links
}

function isAt(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * The document a pathname shows, or null (e.g. the Deep Dive, which the
 * header marks instead). Job Description matches the hub path exactly so its
 * sub-routes don't light it up.
 */
export function activeJobDocument(pathname: string, links: readonly JobDocumentLink[]): JobDocumentKind | null {
  const path = pathname.replace(/\/+$/, "")
  for (const link of links) {
    if (link.kind === "description" ? path === link.href : isAt(path, link.href)) return link.kind
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
