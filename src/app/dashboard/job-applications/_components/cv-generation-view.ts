/**
 * Display helpers for the CV generation log page.
 * Pure: no React, no server imports beyond types and constants, so client
 * components can use it and it is easy to test.
 */

import { FLAT_SECTIONS } from "@/modules/cv-generation/caps"
import {
  ACTIVE_STATUSES,
  CV_GENERATION_CONCURRENCY_PER_PROFILE,
  CV_GENERATION_STAGES,
  DROP_REASON_LABEL,
  stageForStatus,
  type CvBrief,
  type CvGenerationStage,
  type CvGenerationStatus,
  type CvSelection,
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

/** Shown on a complete run that stopped after Select (log.partial). */
export const PREVIEW_NOTICE = "Preview run: writing, review and draft stages are not built yet"
export const PREVIEW_DETAIL =
  "This run gathered your evidence, wrote the brief and chose what to show. No CV was written and no draft was created."

/** What the run-preview button tells the user for each response of POST /api/jobs/[id]/cv-generation. */
export function startResponseMessage(status: number): { ok: boolean; message: string | null } {
  if (status === 200 || status === 202) return { ok: true, message: null }
  if (status === 401) return { ok: false, message: "Sign in again to run a preview." }
  if (status === 404) return { ok: false, message: "Job not found." }
  if (status === 429) return { ok: false, message: `${CV_GENERATION_CONCURRENCY_PER_PROFILE} CV generations are already running. Try again when one finishes.` }
  return { ok: false, message: "Couldn't start the preview. Check your connection and try again." }
}

export type BriefRow = { label: string; text?: string; items?: string[] }

/** The Brief as labelled rows for reading (not raw JSON); empty lists are left out. */
export function briefRows(brief: CvBrief): BriefRow[] {
  const b = brief.budgets
  const rows: BriefRow[] = [
    { label: "The hidden question", text: brief.hiddenQuestion },
    { label: "Lead with", items: brief.leadWith },
    { label: "Emphasise", items: brief.emphasise.map((e) => `${e.item}: ${e.why}`) },
    { label: "Play down", items: brief.playDown },
    { label: "Positioning", text: brief.positioning },
    { label: "Tone", text: brief.tone },
    {
      label: "Budget",
      text: `Roles ${b.experiences} · skills ${b.skills} · tools ${b.tools} · competencies ${b.competencies} · certifications ${b.certifications} · education ${b.education} · projects ${b.projects}`,
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

const FLAT_TITLE: Record<(typeof FLAT_SECTIONS)[number], string> = {
  skills: "Skills", tools: "Tools", competencies: "Competencies",
  certifications: "Certifications", education: "Education", projects: "Projects",
}

/**
 * The selection grouped for reading: roles, then each kept role's activities,
 * then the flat sections. Sections with nothing kept and nothing dropped are
 * left out.
 */
export function selectionGroups(sel: CvSelection): SelectionGroup[] {
  const dropOf = (section: string, parentId?: string) =>
    sel.dropped
      .filter((d) => d.section === section && (parentId === undefined || d.parentId === parentId))
      .map((d) => ({ label: d.label || d.id, why: DROP_REASON_LABEL[d.why] }))
  const groups: SelectionGroup[] = [
    { key: "experiences", title: "Roles", kept: sel.experiences.map((e) => ({ label: e.label, reason: e.reason })), dropped: dropOf("experiences") },
  ]
  for (const e of sel.experiences) {
    groups.push({
      key: `activities:${e.id}`,
      title: `Evidence: ${e.label}`,
      kept: (sel.activities[e.id] ?? []).map((a) => ({ label: a.label, reason: a.reason })),
      dropped: dropOf("activities", e.id),
    })
  }
  for (const s of FLAT_SECTIONS) {
    groups.push({ key: s, title: FLAT_TITLE[s], kept: sel[s].map((i) => ({ label: i.label, reason: i.reason })), dropped: dropOf(s) })
  }
  // Activities dropped because their role was not kept have no role group to sit in.
  const orphans = sel.dropped.filter((d) => d.section === "activities" && !sel.experiences.some((e) => e.id === d.parentId))
  if (orphans.length > 0) {
    groups.push({ key: "activities:orphans", title: "Evidence of roles that were left out", kept: [], dropped: orphans.map((d) => ({ label: d.label || d.id, why: DROP_REASON_LABEL[d.why] })) })
  }
  return groups.filter((g) => g.kept.length > 0 || g.dropped.length > 0)
}

/** "12 kept, 30 left out" for the selection heading. */
export function selectionSummary(sel: CvSelection): string {
  const kept = sel.experiences.length
    + Object.values(sel.activities).reduce((n, l) => n + l.length, 0)
    + FLAT_SECTIONS.reduce((n, s) => n + sel[s].length, 0)
  return `${kept} kept, ${sel.droppedTotal} left out${sel.mode === "fallback" ? " (chosen by rules: the model's answer wasn't usable)" : ""}`
}
