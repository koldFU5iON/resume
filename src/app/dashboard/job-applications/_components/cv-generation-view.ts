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
  type CvBrief,
  type CvGenerationStage,
  type CvGenerationStatus,
  type CvAssembled,
  type CvSelection,
  type SectionLogEntry,
  type StageLogEntry,
} from "@/modules/cv-generation/schema"

export { formatRunCost } from "./deep-dive-view"

/** The stages as the page shows them, in order (docs/cv-generation.md). */
export const CV_GENERATION_STAGE_INFO: Record<CvGenerationStage, { label: string; detail: string }> = {
  gather: { label: "Gather", detail: "Your profile, the job, and the deep dive or job analysis for strategy" },
  brief: { label: "Brief", detail: "What problem the role is hired to solve, and what to lead with, emphasise and play down" },
  select: { label: "Select", detail: "The evidence worth showing per section, within hard limits" },
  write: { label: "Write", detail: "Each section, from only its selected evidence" },
  assemble: { label: "Assemble", detail: "Ordering, contact details, block validation and fact checks" },
  review: { label: "Review", detail: "Cohesion against the brief, and every factual claim checked against your profile" },
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

// ── Preview run (stages 0-2 only) ───────────────────────────────────────────

/** Shown on a complete run that stopped after Assemble (log.partial). */
export const PREVIEW_NOTICE = "Preview run: review and draft stages are not built yet. The assembled CV is below."
export const PREVIEW_DETAIL =
  "This run gathered your evidence, wrote the brief, chose what to show, wrote each section and assembled the CV. Nothing was reviewed against your profile yet and no draft was created."

/** Shown on a preview run stored before the writing stages existed: it has a selection but no CV. */
export const PREVIEW_NOTICE_SELECTION_ONLY = "Preview run: selection only"
export const PREVIEW_DETAIL_SELECTION_ONLY =
  "This run gathered your evidence, wrote the brief and chose what to show. It was made before the writing stages existed, so there is no assembled CV. Run the preview again to get one."

/** The notice and detail for a preview run: the assembled-CV wording only when there is a CV. */
export function previewCopy(hasAssembled: boolean): { notice: string; detail: string } {
  return hasAssembled
    ? { notice: PREVIEW_NOTICE, detail: PREVIEW_DETAIL }
    : { notice: PREVIEW_NOTICE_SELECTION_ONLY, detail: PREVIEW_DETAIL_SELECTION_ONLY }
}

/** What the run-preview button tells the user for each response of POST /api/jobs/[id]/cv-generation. */
export function startResponseMessage(status: number): { ok: boolean; message: string | null } {
  if (status === 200 || status === 202) return { ok: true, message: null }
  if (status === 401) return { ok: false, message: "Sign in again to run a preview." }
  if (status === 404) return { ok: false, message: "Job not found." }
  if (status === 429) return { ok: false, message: `${CV_GENERATION_CONCURRENCY_PER_PROFILE} CV generations are already running. Try again when one finishes.` }
  return { ok: false, message: "Couldn't start the preview. Check your connection and try again." }
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
