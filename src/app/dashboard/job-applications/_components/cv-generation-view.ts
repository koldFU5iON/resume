/**
 * Display helpers for the CV generation log page.
 * Pure: no React, no server imports beyond types and constants, so client
 * components can use it and it is easy to test.
 */

import { FLAT_SECTIONS } from "@/modules/cv-generation/caps"
import { employerPeriod } from "@/modules/cv-generation/employers"
import {
  ACTIVE_STATUSES,
  CHECK_NOTE_PREFIX,
  MAX_CHECK_NOTES,
  CV_GENERATION_CONCURRENCY_PER_PROFILE,
  CV_GENERATION_STAGES,
  DROP_REASON_LABEL,
  employersWithBullets,
  stageForStatus,
  type BulletProvenance,
  type BulletSource,
  CONCERN_KIND_LABEL,
  type CvBrief,
  type CvReview,
  type CvGenerationStage,
  type CvGenerationStatus,
  type CvAssembled,
  type CvSelection,
  type SectionLogEntry,
  type StageLogEntry,
} from "@/modules/cv-generation/schema"

import { formatRunCost } from "./deep-dive-view"

export { formatRunCost }

/** The stages as the page shows them, in order (docs/cv-generation.md). */
export const CV_GENERATION_STAGE_INFO: Record<CvGenerationStage, { label: string; detail: string }> = {
  gather: { label: "Gather", detail: "Your profile, the job, and the deep dive or job analysis for strategy" },
  brief: { label: "Brief", detail: "What problem the role is hired to solve, and what to lead with, emphasise and play down" },
  select: { label: "Select", detail: "The evidence worth showing per section, within hard limits" },
  write: { label: "Write", detail: "Each section, from only its selected evidence" },
  assemble: { label: "Assemble", detail: "Ordering, contact details, block validation and fact checks" },
  review: { label: "Review", detail: "One check of the written CV against your evidence and the brief: unsupported claims removed, concerns listed for the coach" },
  land: { label: "Land", detail: "Saved to the writing desk as a draft for you to accept or discard" },
}

export const CV_GENERATION_STATUS_LABEL: Record<CvGenerationStatus, string> = {
  queued: "Starting…",
  gathering: "Gathering…",
  briefing: "Briefing…",
  selecting: "Selecting evidence…",
  writing: "Writing the sections…",
  assembling: "Assembling…",
  reviewing: "Reviewing the claims…",
  landing: "Saving the draft…",
  complete: "Complete",
  failed: "Failed",
}

export function isCvGenerationActive(status: CvGenerationStatus | null | undefined): boolean {
  return !!status && (ACTIVE_STATUSES as readonly CvGenerationStatus[]).includes(status)
}

export function cvGenerationHref(jobId: string): string {
  return `/dashboard/job-applications/view/${jobId}/cv-generation`
}

/** Poller signature: '' when nothing is running (AssessmentPoller stops). */
export function cvGenerationSignature(run: { id: string; status: CvGenerationStatus } | null | undefined): string {
  return run && isCvGenerationActive(run.status) ? `${run.id}:${run.status}` : ""
}

/** Index of the current stage in CV_GENERATION_STAGES: -1 while queued, the stage count once finished. */
export function stageIndex(status: CvGenerationStatus): number {
  if (status === "queued") return -1
  const stage = stageForStatus(status)
  return stage ? CV_GENERATION_STAGES.indexOf(stage) : CV_GENERATION_STAGES.length
}

export type StageState = "done" | "active" | "waiting" | "failed" | "skipped"

export type StageRow = {
  stage: CvGenerationStage
  label: string
  detail: string
  state: StageState
  /** What the stage logged; null when it hasn't (or its entry was unreadable). */
  entry: StageLogEntry | null
  /** The log's duration, else the run's stage timing; null when neither exists. */
  durationMs: number | null
}

/**
 * One row per stage with its state. A failed run fails at the stage whose log
 * entry says failed, else at the first stage with no entry (it died there);
 * later stages are "waiting" (never ran). A stage's own log entry saying
 * `skipped` or `failed` wins over the run-level state.
 */
export function buildStageRows(run: {
  status: CvGenerationStatus
  /** A preview run that stopped early: stages with no log entry never ran (shown "not run yet", not "done"). */
  partial?: boolean
  log: readonly StageLogEntry[]
  stageTimings: Partial<Record<CvGenerationStage, number>>
}): StageRow[] {
  const entries = new Map(run.log.map((e) => [e.stage, e]))
  const current = stageIndex(run.status)
  const failedAt = run.status === "failed"
    ? (() => {
        const loggedFailure = CV_GENERATION_STAGES.findIndex((s) => entries.get(s)?.status === "failed")
        return loggedFailure >= 0 ? loggedFailure : CV_GENERATION_STAGES.findIndex((s) => !entries.has(s))
      })()
    : -1

  return CV_GENERATION_STAGES.map((stage, i): StageRow => {
    const entry = entries.get(stage) ?? null
    let state: StageState
    if (entry?.status === "failed") state = "failed"
    else if (entry?.status === "skipped") state = "skipped"
    else if (run.status === "complete") state = run.partial && !entry ? "waiting" : "done"
    else if (run.status === "failed") state = failedAt >= 0 && i === failedAt ? "failed" : i < failedAt || failedAt < 0 ? "done" : "waiting"
    else state = i < current ? "done" : i === current ? "active" : "waiting"
    return {
      stage,
      ...CV_GENERATION_STAGE_INFO[stage],
      state,
      entry,
      durationMs: entry?.durationMs ?? run.stageTimings[stage] ?? null,
    }
  })
}

/** "850 ms", "4.2 s", "1 m 05 s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)} m ${String(s % 60).padStart(2, "0")} s`
}

/** "820", "12.4k". */
export function formatTokens(n: number): string {
  return n < 1000 ? String(Math.round(n)) : `${(n / 1000).toFixed(1)}k`
}

/** "$0.05" or "under $0.01". */
export function formatCost(usd: number): string {
  return usd > 0 && usd < 0.01 ? "under $0.01" : `$${usd.toFixed(2)}`
}

/** The facts a stage row shows on its meta line, in order; empty ones left out. */
export function stageMeta(row: Pick<StageRow, "entry" | "durationMs">): string[] {
  const out: string[] = []
  const e = row.entry
  if (e?.model) out.push(e.model)
  if (row.durationMs !== null) out.push(formatDuration(row.durationMs))
  if (e && (e.tokens.input > 0 || e.tokens.output > 0)) out.push(`${formatTokens(e.tokens.input)} in · ${formatTokens(e.tokens.output)} out`)
  if (e?.costUsd != null) out.push(formatCost(e.costUsd))
  if (e && e.retries > 0) out.push(`${e.retries} ${e.retries === 1 ? "retry" : "retries"}`)
  return out
}

// ── Finished runs ───────────────────────────────────────────────────────────

/** The heading of a run that landed a draft. */
export const COMPLETE_HEADING = "CV drafted: review it in the writing desk"

/** The draft's page in the writing desk. */
export function draftHref(jobId: string, documentId: string): string {
  return `/dashboard/job-applications/view/${jobId}/writing/${documentId}`
}

// ── Preview runs (stored before Phase 4a; new runs never are) ───────────────

/** Shown on an old complete run that stopped after Assemble (log.partial). */
export const PREVIEW_NOTICE = "Preview run (made before drafts existed): no review, no draft. The assembled CV is below."
export const PREVIEW_DETAIL =
  "This run gathered your evidence, wrote the brief, chose what to show, wrote each section and assembled the CV. It stopped there: nothing was reviewed and no draft was created. Generate the CV again to get a draft."

/** Shown on a preview run stored before the writing stages existed: it has a selection but no CV. */
export const PREVIEW_NOTICE_SELECTION_ONLY = "Preview run: selection only"
export const PREVIEW_DETAIL_SELECTION_ONLY =
  "This run gathered your evidence, wrote the brief and chose what to show. It was made before the writing stages existed, so there is no assembled CV. Generate the CV again to get one."

/** The notice and detail for a preview run: the assembled-CV wording only when there is a CV. */
export function previewCopy(hasAssembled: boolean): { notice: string; detail: string } {
  return hasAssembled
    ? { notice: PREVIEW_NOTICE, detail: PREVIEW_DETAIL }
    : { notice: PREVIEW_NOTICE_SELECTION_ONLY, detail: PREVIEW_DETAIL_SELECTION_ONLY }
}

/** What the generate button tells the user for each response of POST /api/jobs/[id]/cv-generation. */
export function startResponseMessage(status: number): { ok: boolean; message: string | null } {
  if (status === 200 || status === 202) return { ok: true, message: null }
  if (status === 401) return { ok: false, message: "Sign in again to generate a CV." }
  if (status === 404) return { ok: false, message: "Job not found." }
  if (status === 409) return { ok: false, message: "This job's CV document already has a draft waiting. Open it, or discard it, then generate again." }
  if (status === 429) return { ok: false, message: `${CV_GENERATION_CONCURRENCY_PER_PROFILE} CV generations are already running. Try again when one finishes.` }
  return { ok: false, message: "Couldn't start the CV generation. Check your connection and try again." }
}

/** A list item: `text`, bold only when `strong` (the Emphasise items), and `note` (why) in muted text under it. */
export type BriefItem = { text: string; strong?: boolean; note?: string }

export type BriefRow = { label: string; text?: string; items?: BriefItem[] }

/** The Brief as labelled rows for reading (not raw JSON); empty lists are left out. */
export function briefRows(brief: CvBrief): BriefRow[] {
  const b = brief.budgets
  const rows: BriefRow[] = [
    { label: "The hidden question", text: brief.hiddenQuestion },
    { label: "Lead with", items: brief.leadWith.map((text) => ({ text })) },
    { label: "Emphasise", items: brief.emphasise.map((e) => ({ text: e.item, strong: true, ...(e.why.trim() ? { note: e.why } : {}) })) },
    { label: "Play down (framing only; titles and employers stay)", items: brief.playDown.map((text) => ({ text })) },
    { label: "Positioning", text: brief.positioning },
    { label: "Tone", text: brief.tone },
    {
      label: "Budget",
      text: `Employers with bullets ${employersWithBullets(brief)} · skills ${b.skills} · tools ${b.tools} · competencies ${b.competencies} · certifications ${b.certifications} · education ${b.education} · projects ${b.projects}`,
    },
  ]
  return rows.filter((r) => (r.text !== undefined ? r.text.trim() !== "" : (r.items?.length ?? 0) > 0))
}

export type SelectionGroup = {
  key: string
  title: string
  kept: Array<{ label: string; reason: string }>
  /** Left out, with why: cut by a limit, not in the profile, or simply not chosen. */
  dropped: Array<{ label: string; why: string }>
}

/** One employer of the selection, ready to show. */
export type EmployerBlock = {
  key: string
  company: string
  /** The latest title, as in the profile. */
  title: string
  /** "Jan 2019 – present". */
  period: string | null
  /** The code-built progression sub-line; null with a single role. */
  progression: string | null
  /** Employers with bullets only; undefined for a header-only entry. */
  relevance: number | undefined
  reason: string
  headerOnly: boolean
  kept: Array<{ label: string; reason: string }>
  dropped: Array<{ label: string; why: string }>
}

const FLAT_TITLE: Record<(typeof FLAT_SECTIONS)[number], string> = {
  skills: "Skills", tools: "Tools", competencies: "Competencies",
  certifications: "Certifications", education: "Education", projects: "Projects",
}

const dropText = (d: { label: string; id: string; why: keyof typeof DROP_REASON_LABEL }) => ({ label: d.label || d.id, why: DROP_REASON_LABEL[d.why] })

/**
 * The work history of a selection stored with employers: the employers that
 * show bullets (each with its kept bullets and what was left out), the
 * header-only employers, and the employers dropped by a limit. Empty for rows
 * stored before employers existed (they read through `selectionGroups`).
 */
export function employerBlocks(sel: CvSelection): { withBullets: EmployerBlock[]; headerOnly: EmployerBlock[]; dropped: Array<{ label: string; why: string }> } {
  const block = (e: CvSelection["employers"][number]): EmployerBlock => ({
    key: e.key,
    company: e.company,
    title: e.latestTitle,
    period: employerPeriod(e),
    progression: e.progression,
    relevance: e.relevance,
    reason: e.reason,
    headerOnly: e.headerOnly,
    kept: e.bullets.map((a) => ({ label: a.label, reason: a.reason })),
    dropped: sel.dropped.filter((d) => d.section === "activities" && d.parentId === e.key).map(dropText),
  })
  return {
    withBullets: sel.employers.filter((e) => !e.headerOnly).map(block),
    headerOnly: sel.employers.filter((e) => e.headerOnly).map(block),
    dropped: sel.dropped.filter((d) => d.section === "employers").map(dropText),
  }
}

/**
 * The selection grouped for reading. A row stored with employers gets the flat
 * sections plus any picked evidence that could not be used (the work history
 * itself is `employerBlocks`). A row from before employers existed gets its
 * roles and each role's evidence as well. Groups with nothing kept and nothing
 * dropped are left out.
 */
export function selectionGroups(sel: CvSelection): SelectionGroup[] {
  const dropOf = (section: string, parentId?: string) =>
    sel.dropped
      .filter((d) => d.section === section && (parentId === undefined || d.parentId === parentId))
      .map(dropText)
  const groups: SelectionGroup[] = []
  const hasEmployers = sel.employers.length > 0
  if (!hasEmployers) {
    groups.push({ key: "experiences", title: "Roles with bullets", kept: sel.experiences.map((e) => ({ label: e.label, reason: e.reason })), dropped: dropOf("experiences") })
    for (const e of sel.experiences) {
      groups.push({
        key: `activities:${e.id}`,
        title: `Evidence: ${e.label}`,
        kept: (sel.activities[e.id] ?? []).map((a) => ({ label: a.label, reason: a.reason })),
        dropped: dropOf("activities", e.id),
      })
    }
    // Roles that stay visible as a title line only: no evidence is shown for them.
    groups.push({
      key: "headerOnly",
      title: "Listed without bullets",
      kept: sel.headerOnlyRoles.map((e) => ({ label: e.label, reason: e.reason })),
      dropped: [],
    })
  }
  for (const s of FLAT_SECTIONS) {
    groups.push({ key: s, title: FLAT_TITLE[s], kept: sel[s].map((i) => ({ label: i.label, reason: i.reason })), dropped: dropOf(s) })
  }
  // Activities picked for an employer (or role) that has no entry above to hold them.
  const shown = new Set(hasEmployers ? sel.employers.map((e) => e.key) : sel.experiences.map((e) => e.id))
  const orphans = sel.dropped.filter((d) => d.section === "activities" && !shown.has(d.parentId ?? ""))
  if (orphans.length > 0) {
    groups.push({ key: "activities:orphans", title: "Picked evidence that was not used (its employer has no bullets)", kept: [], dropped: orphans.map(dropText) })
  }
  return groups.filter((g) => g.kept.length > 0 || g.dropped.length > 0)
}

/** "12 kept, 30 left out" for the selection heading. */
export function selectionSummary(sel: CvSelection): string {
  const kept = sel.employers.length
    + sel.employers.reduce((n, e) => n + e.bullets.length, 0)
    + sel.experiences.length
    + sel.headerOnlyRoles.length
    + Object.values(sel.activities).reduce((n, l) => n + l.length, 0)
    + FLAT_SECTIONS.reduce((n, s) => n + sel[s].length, 0)
  return `${kept} kept, ${sel.droppedTotal} left out${sel.mode === "fallback" ? " (chosen by rules: the model's answer wasn't usable)" : ""}`
}


// ── Write and Assemble (stages 3-4) ─────────────────────────────────────────

/**
 * Why a stage or section retried, as one line ("Retried because: figure 14k not
 * in evidence; first person"), or null when it did not retry or the stored row
 * has no reasons (rows from before they were recorded).
 */
export function retryReasonLine(e: { retries: number; retryReasons?: readonly string[] }): string | null {
  const reasons = (e.retryReasons ?? []).map((r) => r.trim()).filter(Boolean)
  if (e.retries <= 0 || reasons.length === 0) return null
  return `Retried because: ${reasons.join("; ")}`
}

/** The facts of one section row under Write, in order; empty ones left out. */
export function sectionMeta(s: Pick<SectionLogEntry, "model" | "durationMs" | "tokens" | "costUsd" | "retries">): string[] {
  const out: string[] = []
  if (s.model) out.push(s.model)
  if (s.durationMs !== null && s.durationMs > 0) out.push(formatDuration(s.durationMs))
  if (s.tokens.input > 0 || s.tokens.output > 0) out.push(`${formatTokens(s.tokens.input)} in · ${formatTokens(s.tokens.output)} out`)
  if (s.costUsd != null && s.costUsd > 0) out.push(formatCost(s.costUsd))
  if (s.retries > 0) out.push(`${s.retries} ${s.retries === 1 ? "retry" : "retries"}`)
  if (!s.model) out.push("by code")
  return out
}

/**
 * The notes of a stage row as shown. On Assemble, "worth a quick check" lines
 * are cut to MAX_CHECK_NOTES whatever the stored log holds: these flags stay
 * rare by design.
 */
export function stageNotes(entry: Pick<StageLogEntry, "stage" | "notes">): string[] {
  if (entry.stage !== "assemble") return entry.notes
  let checks = 0
  return entry.notes.filter((n) => !n.startsWith(CHECK_NOTE_PREFIX) || ++checks <= MAX_CHECK_NOTES)
}

/** The summary of the per-bullet provenance disclosure under an experience row. */
export const PROVENANCE_SUMMARY = "Where each bullet came from"

/** One source of a bullet as a line: "from: <snippet> (activity)". */
export function sourceLine(s: Pick<BulletSource, "snippet" | "kind">): string {
  return `from: ${s.snippet.trim() || "(no text)"} (${s.kind})`
}

/** The lines under one bullet: its sources, or a plain statement that the writer cited none; a bullet the review reworded says so first. */
export function bulletSourceLines(b: Pick<BulletProvenance, "sources" | "editedByReview">): string[] {
  const lines = b.sources.map(sourceLine)
  if (!b.editedByReview) return lines.length > 0 ? lines : ["from: no source cited"]
  return [EDITED_BY_REVIEW, ...lines]
}

/** Shown under a bullet the Review stage reworded after it was written. */
export const EDITED_BY_REVIEW = "edited by review (reworded after the CV was written)"

/** The provenance of every employer section of an assembled CV, by section id. Sections without bullets (and runs stored before provenance) are left out. */
export function provenanceBySection(assembled: { sections?: ReadonlyArray<{ id: string; bullets?: readonly BulletProvenance[] }> } | null | undefined): Map<string, readonly BulletProvenance[]> {
  const out = new Map<string, readonly BulletProvenance[]>()
  for (const s of assembled?.sections ?? []) if (s.bullets && s.bullets.length > 0) out.set(s.id, s.bullets)
  return out
}

/** "9 sections · about 410 words" for the assembled CV panel. */
export function assembledSummary(a: Pick<CvAssembled, "markdown" | "sections">): string {
  const words = a.markdown.trim().split(/\s+/).filter(Boolean).length
  return `${a.sections.length} ${a.sections.length === 1 ? "section" : "sections"} · about ${words} words`
}

/** The Brief's emphasise items that no kept evidence supports, or null when all are covered (or the row has no such field). */
export function uncoveredLine(sel: Pick<CvSelection, "uncovered">): string | null {
  return sel.uncovered.length > 0
    ? `No kept evidence supports ${sel.uncovered.length === 1 ? "this emphasise item" : "these emphasise items"}: ${sel.uncovered.join("; ")}`
    : null
}

// ── Review (stage 5) ────────────────────────────────────────────────────────

/** One concern as the log page shows it: a kind badge, the title, why, and the question for the owner. */
export type ConcernRow = { kind: string; badge: string; title: string; why: string; question: string; refs: string[] }

/** The stored concerns for display; empty for a run with no review, a skipped one, or an old run. */
export function concernRows(review: Pick<CvReview, "concerns"> | null | undefined): ConcernRow[] {
  return (review?.concerns ?? []).map((c) => ({
    kind: c.kind, badge: CONCERN_KIND_LABEL[c.kind] ?? CONCERN_KIND_LABEL.other, title: c.title, why: c.why, question: c.question,
    refs: c.refs.map((r) => r.snippet.trim()).filter(Boolean),
  }))
}

/** "Applied 2 edits, discarded 1, 3 concerns for the coach", or why the review was skipped; null when there is no review record. */
export function reviewSummary(review: CvReview | null | undefined): string | null {
  if (!review) return null
  if (review.skipped) return `Review skipped: ${review.skipReason ?? "no reason recorded"}`
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`
  return `Applied ${n(review.applied.length, "edit")}, discarded ${review.discarded.length}, ${n(review.concerns.length, "concern")} for the coach`
}

const editLine = (e: { sectionId: string; bulletId: string | null; action: string }) => `${e.action} ${e.sectionId}${e.bulletId ? ` ${e.bulletId}` : ""}`

/** The Review section of the copied log: applied and discarded edits with their reasons, then the concerns. Empty when there is no review. */
export function reviewMarkdown(review: CvReview | null | undefined): string[] {
  const summary = reviewSummary(review)
  if (!review || !summary) return []
  const one = (t: string) => t.replace(/\s*\n\s*/g, " ")
  const out = ["## Review", "", summary, ""]
  if (review.applied.length > 0) {
    out.push("### Edits applied")
    for (const a of review.applied) out.push(`- ${editLine(a)}: “${one(a.before)}”${a.after ? ` → “${one(a.after)}”` : ""} (${one(a.reason) || "no reason given"})`)
    out.push("")
  }
  if (review.discarded.length > 0) {
    out.push("### Edits discarded")
    for (const d of review.discarded) out.push(`- ${editLine(d)}: ${one(d.why)}${d.proposed ? ` — proposed “${one(d.proposed)}”` : ""}`)
    out.push("")
  }
  if (review.concerns.length > 0) {
    out.push("### Concerns for the coach")
    for (const c of review.concerns) {
      out.push(`- **${one(c.title)}** (${CONCERN_KIND_LABEL[c.kind] ?? c.kind}): ${one(c.why)}`)
      out.push(`  - Question: ${one(c.question)}`)
      for (const r of c.refs) out.push(`  - Evidence: ${one(r.snippet)}`)
    }
    out.push("")
  }
  return out
}

// ── Copy log: the whole run as readable Markdown ────────────────────────────

/** What the copy-log text needs. Every run field is optional so a row stored by an earlier phase (no brief, no assembled CV, no retry reasons) still produces a log. */
export type RunLogInput = {
  jobTitle: string
  company: string | null
  run: {
    id: string
    status: CvGenerationStatus
    createdAt: Date | string
    startedAt?: Date | string | null
    completedAt?: Date | string | null
    failureMessage?: string | null
    partial?: boolean
    log?: readonly StageLogEntry[] | null
    stageTimings?: Partial<Record<CvGenerationStage, number>> | null
    brief?: CvBrief | null
    selection?: CvSelection | null
    assembled?: (Pick<CvAssembled, "markdown" | "warnings" | "checkNotes"> & { sections?: CvAssembled["sections"] }) | null
    /** The Review stage's record (edits, concerns, skipped flag); absent on older runs. */
    review?: CvReview | null
    /** The earlier run whose brief and selection this run reused; absent or null for a fresh one. */
    selectionReusedFromRunId?: string | null
    /** The writing desk document the draft landed in, when it did. */
    writingDeskDocumentId?: string | null
    /** The run's usage total (calls, tokens, estimated cost). */
    usage?: { total: { requests: number; failedRequests?: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number; estimateComplete: boolean } } | null
  }
}

const iso = (d: Date | string | null | undefined): string | null => {
  if (!d) return null
  const t = d instanceof Date ? d : new Date(d)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

/** A run's total duration: start to completion when both are known, else the sum of the stage timings, else null. */
function runDurationMs(run: RunLogInput["run"]): number | null {
  const from = iso(run.startedAt ?? run.createdAt)
  const to = iso(run.completedAt)
  if (from && to) return Math.max(0, Date.parse(to) - Date.parse(from))
  const sum = Object.values(run.stageTimings ?? {}).reduce<number>((n, v) => n + (typeof v === "number" ? v : 0), 0)
  return sum > 0 ? sum : null
}

/** A fence longer than any run of backticks in `text`, so the CV can sit in a code block whatever it holds. */
const fenceFor = (text: string) => "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)))

const bulletList = (items: readonly string[]) => items.map((i) => `- ${i.replace(/\s*\n\s*/g, " ")}`)

/**
 * The whole run as Markdown, for the "Copy log" button: header (job, run id,
 * date, status, total cost, tokens, calls, duration), the Brief, the Selection,
 * every stage with its model, time, tokens, cost, retries and why, its notes
 * and check notes, and the assembled CV at the end. The CV carries the literal
 * {{contact}} placeholder, never contact details, and nothing here reads any.
 * Pure: no React, no DB. Sections with nothing to say are left out.
 */
export function runLogMarkdown({ jobTitle, company, run }: RunLogInput): string {
  const out: string[] = []
  const title = `${jobTitle.trim() || "Untitled job"}${company?.trim() ? ` at ${company.trim()}` : ""}`
  out.push(`# CV generation log: ${title}`, "")

  const total = run.usage?.total
  const duration = runDurationMs(run)
  const head: string[] = [
    `Run: ${run.id}`,
    `Date: ${iso(run.createdAt) ?? "unknown"}`,
    `Status: ${CV_GENERATION_STATUS_LABEL[run.status] ?? run.status}${run.partial ? " (preview run made before drafts existed: no review, no draft)" : ""}`,
    ...(run.selectionReusedFromRunId ? [`Brief and selection: reused from run ${run.selectionReusedFromRunId} (nothing changed since)`] : []),
    ...(run.writingDeskDocumentId ? [`Draft: writing desk document ${run.writingDeskDocumentId}`] : []),
    ...(run.failureMessage ? [`Failure: ${run.failureMessage}`] : []),
    ...(total && total.requests > 0
      ? [
          `Cost (estimate): ${formatRunCost(total.estimatedCostUsd, total.estimateComplete)}`,
          `Calls: ${total.requests}${total.failedRequests ? ` (${total.failedRequests} failed)` : ""}`,
          `Tokens: ${formatTokens(total.inputTokens)} in · ${formatTokens(total.outputTokens)} out`,
        ]
      : ["Cost (estimate): none recorded"]),
    ...(duration !== null ? [`Duration: ${formatDuration(duration)}`] : []),
  ]
  out.push(...bulletList(head), "")

  if (run.brief) {
    out.push("## Brief", "")
    for (const row of briefRows(run.brief)) {
      if (row.text !== undefined) out.push(`**${row.label}:** ${row.text.replace(/\s*\n\s*/g, " ")}`, "")
      else {
        out.push(`**${row.label}:**`)
        out.push(...(row.items ?? []).map((it) => `- ${it.text}${it.note ? ` — ${it.note}` : ""}`), "")
      }
    }
  }

  if (run.selection) {
    const sel = run.selection
    out.push("## Selection", "", selectionSummary(sel), "")
    const unc = uncoveredLine(sel)
    if (unc) out.push(`**Uncovered:** ${unc}`, "")
    const work = employerBlocks(sel)
    for (const e of work.withBullets) {
      out.push(`### ${e.company}: ${e.title}${e.period ? ` (${e.period})` : ""}`)
      out.push(`${e.relevance !== undefined ? `Relevance ${e.relevance}/5, ` : ""}${countLabel(e.kept.length, "bullet")} kept${e.dropped.length > 0 ? `, ${e.dropped.length} left out` : ""}${e.reason ? ` · ${e.reason}` : ""}`)
      out.push(...e.kept.map((k) => `- ${k.label}${k.reason ? ` (${k.reason})` : ""}`), "")
    }
    if (work.headerOnly.length > 0) {
      out.push("### Listed without bullets", ...work.headerOnly.map((e) => `- ${e.company}: ${e.title}${e.period ? ` (${e.period})` : ""}`), "")
    }
    if (work.dropped.length > 0) out.push(`### Employers left out (${work.dropped.length})`, ...work.dropped.map((d) => `- ${d.label} (${d.why})`), "")
    for (const g of selectionGroups(sel)) {
      out.push(`### ${g.title}: ${g.kept.length} kept${g.dropped.length > 0 ? `, ${g.dropped.length} left out` : ""}`)
      out.push(...g.kept.map((k) => `- ${k.label}${k.reason ? ` (${k.reason})` : ""}`), "")
    }
  }

  const log = run.log ?? []
  const provenance = provenanceBySection(run.assembled)
  if (log.length > 0) {
    out.push("## Stages", "")
    const rows = buildStageRows({ status: run.status, partial: run.partial, log, stageTimings: run.stageTimings ?? {} })
    for (const row of rows) {
      const e = row.entry
      if (!e) continue
      const meta = stageMeta(row)
      out.push(`### ${row.label}: ${e.status}${meta.length > 0 ? ` · ${meta.join(" · ")}` : ""}`)
      const retry = retryReasonLine(e)
      if (retry) out.push(retry)
      const notes = stageNotes(e)
      if (notes.length > 0) out.push("", ...bulletList(notes))
      if (e.kept.length > 0 || e.dropped.length > 0) out.push("", `Kept ${e.kept.length}, dropped ${e.dropped.length}.`)
      if (e.sections.length > 0) {
        out.push("")
        for (const s of e.sections) {
          const sm = sectionMeta(s)
          out.push(`- **${s.label}**${s.status === "failed" ? " (failed)" : ""}: ${sm.join(" · ")}`)
          const r = retryReasonLine(s)
          if (r) out.push(`  - ${r}`)
          out.push(...s.notes.map((n) => `  - ${n.replace(/\s*\n\s*/g, " ")}`))
          const from = provenance.get(s.id)
          if (from) {
            out.push(`  - ${PROVENANCE_SUMMARY}:`)
            for (const b of from) {
              out.push(`    - ${b.text.replace(/\s*\n\s*/g, " ")}`)
              out.push(...bulletSourceLines(b).map((l) => `      - ${l.replace(/\s*\n\s*/g, " ")}`))
            }
          }
        }
      }
      if (e.flaggedClaims.length > 0) {
        out.push("", ...e.flaggedClaims.map((c) => `- ${c.verdict === "unsupported" ? "Removed" : "Verify"}: ${c.claim}${c.reason ? ` (${c.reason})` : ""}`))
      }
      if (e.stage === "assemble" && run.assembled) {
        const checks = run.assembled.checkNotes.slice(0, MAX_CHECK_NOTES)
        if (checks.length > 0) out.push("", "Worth a quick check:", ...bulletList(checks))
        if (run.assembled.warnings.length > 0) out.push("", `Warnings (${run.assembled.warnings.length}):`, ...bulletList(run.assembled.warnings))
      }
      out.push("")
    }
  }

  out.push(...reviewMarkdown(run.review))

  if (run.assembled) {
    const fence = fenceFor(run.assembled.markdown)
    out.push("## Assembled CV", "", `${fence}markdown`, run.assembled.markdown.replace(/\n+$/, ""), fence, "")
  }

  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`
}

const countLabel = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

// ── Discussing concerns with the coach ──────────────────────────────────────

type CoachJob = { title: string; company?: string | null }

const jobPhrase = (job: CoachJob) => `${job.title}${job.company ? ` at ${job.company}` : ""}`

const concernBlock = (c: ConcernRow) => [
  `- ${c.title}${c.why ? `: ${c.why}` : ""}`,
  `  Question: ${c.question}`,
  ...c.refs.map((r) => `  Evidence: ${r}`),
].join("\n")

const COACH_TAIL = "Please talk it through with me first. Don't change my profile; I'll make any change myself."

/**
 * The message put in the coach's input (never sent for the user) to talk one
 * concern through. Plain, short, and clear that nothing should be written to the profile.
 */
export function concernCoachMessage(concern: ConcernRow, job: CoachJob): string {
  return [`The review of the CV drafted for ${jobPhrase(job)} raised a question I'd like to talk through.`, "", concernBlock(concern), "", COACH_TAIL].join("\n")
}

/** As `concernCoachMessage`, for every concern at once. */
export function allConcernsCoachMessage(concerns: ConcernRow[], job: CoachJob): string {
  return [`The review of the CV drafted for ${jobPhrase(job)} raised ${concerns.length === 1 ? "a question" : `${concerns.length} questions`} I'd like to talk through.`, "", ...concerns.map(concernBlock), "", COACH_TAIL].join("\n")
}

// ── Collapsible sections on the log page ────────────────────────────────────

/** Sections the user acts on: open by default once a run has finished. */
const OPEN_WHEN_FINISHED: readonly string[] = ["concerns", "assembled"]

/** Whether a section starts open. While a run is active every section starts collapsed. */
export function defaultSectionOpen(status: CvGenerationStatus | null | undefined, id: string): boolean {
  return !isCvGenerationActive(status) && OPEN_WHEN_FINISHED.includes(id)
}

/** A section's open state: the user's own choice wins, else the status default. */
export function resolveSectionOpen(
  overrides: Readonly<Record<string, boolean>>,
  status: CvGenerationStatus | null | undefined,
  id: string,
): boolean {
  return id in overrides ? overrides[id] : defaultSectionOpen(status, id)
}

/** "Expand all" / "Collapse all": an explicit choice for every section. */
export function setAllSections(ids: readonly string[], open: boolean): Record<string, boolean> {
  return Object.fromEntries(ids.map((id) => [id, open]))
}

/** The control offers "Collapse all" only when every section is open. */
export function allSectionsOpen(
  overrides: Readonly<Record<string, boolean>>,
  status: CvGenerationStatus | null | undefined,
  ids: readonly string[],
): boolean {
  return ids.length > 0 && ids.every((id) => resolveSectionOpen(overrides, status, id))
}

/** Whether a stage row has anything beyond its one-line purpose to show. */
export function stageRowHasDetail(row: StageRow, warnings: readonly string[] = []): boolean {
  const e = row.entry
  if (warnings.length > 0) return true
  if (!e) return stageMeta(row).length > 0
  return (
    stageMeta(row).length > 0 || retryReasonLine(e) !== null || stageNotes(e).length > 0 || e.sections.length > 0 ||
    e.kept.length > 0 || e.dropped.length > 0 || e.flaggedClaims.length > 0
  )
}

/** Every collapsible section on the page, in order (the ids "Expand all" acts on). */
export function logSectionIds(p: {
  rows: StageRow[]
  hasConcerns: boolean
  hasAssembled: boolean
  hasBrief: boolean
  hasSelection: boolean
  assembleWarnings?: readonly string[]
}): string[] {
  const ids: string[] = []
  if (p.hasConcerns) ids.push("concerns")
  if (p.hasAssembled) ids.push("assembled")
  if (p.hasBrief) ids.push("brief")
  if (p.hasSelection) ids.push("selection")
  for (const r of p.rows) if (stageRowHasDetail(r, r.stage === "assemble" ? p.assembleWarnings : [])) ids.push(`stage:${r.stage}`)
  return ids
}
