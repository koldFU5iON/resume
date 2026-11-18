/**
 * Display helpers for the CV generation log page.
 * Pure: no React, no server imports beyond types and constants, so client
 * components can use it and it is easy to test.
 */

import {
  ACTIVE_STATUSES,
  CV_GENERATION_STAGES,
  stageForStatus,
  type CvGenerationStage,
  type CvGenerationStatus,
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
    else if (run.status === "complete") state = "done"
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
