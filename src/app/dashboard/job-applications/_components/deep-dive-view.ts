/**
 * Display helpers for the job deep dive (button, sidebar entry, report page).
 * Pure: no React, no server imports, so client components can use it.
 */

import type { DeepDiveAccess } from "@/modules/deep-dive/access"
import { ACTIVE_STATUSES, type DeepDiveStatus, type Verdict } from "@/modules/deep-dive/schema"

// Shared with the Markdown report (the coach and Copy as Markdown use it too).
export { VERDICT_LABEL, formatMoney, hostOf } from "@/modules/deep-dive/report-text"

export function isDeepDiveActive(status: DeepDiveStatus | null | undefined): boolean {
  return !!status && (ACTIVE_STATUSES as readonly DeepDiveStatus[]).includes(status)
}

export function deepDiveHref(jobId: string, runId?: string | null): string {
  const base = `/dashboard/job-applications/view/${jobId}/deep-dive`
  return runId ? `${base}?run=${encodeURIComponent(runId)}` : base
}

/** Poller signature: '' when nothing is running (AssessmentPoller stops). */
export function deepDiveSignature(run: { id: string; status: DeepDiveStatus } | null | undefined): string {
  return run && isDeepDiveActive(run.status) ? `${run.id}:${run.status}` : ''
}

/** Tinted status colours (DESIGN.md): meaning, not brand. Always paired with a label. */
export const VERDICT_TEXT: Record<Verdict, string> = {
  apply: 'text-emerald-700 dark:text-emerald-400',
  apply_with_caveats: 'text-sky-700 dark:text-sky-400',
  long_shot: 'text-amber-700 dark:text-amber-400',
  dont_apply: 'text-destructive',
}

export const VERDICT_CHIP: Record<Verdict, string> = {
  apply: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  apply_with_caveats: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  long_shot: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  dont_apply: 'bg-destructive/15 text-destructive',
}

/** The stages a run goes through, in order, as the report page shows them. */
export const DEEP_DIVE_STAGES = [
  { status: 'gathering', label: 'Gather', detail: 'Your profile, the ad, the early assessment and the sponsor register' },
  { status: 'researching', label: 'Research', detail: 'Company, pay and practicalities, from the web. Researchers never see your profile' },
  { status: 'synthesising', label: 'Write the report', detail: 'One model weighs everything against your profile' },
] as const

export const DEEP_DIVE_STATUS_LABEL: Record<DeepDiveStatus, string> = {
  queued: 'Starting…',
  gathering: 'Gathering…',
  researching: 'Researching…',
  synthesising: 'Writing the report…',
  complete: 'Complete',
  failed: 'Failed',
}

/** Index of the current stage in DEEP_DIVE_STAGES: -1 while queued, 3 once finished. */
export function stageIndex(status: DeepDiveStatus): number {
  if (status === 'queued') return -1
  if (status === 'complete' || status === 'failed') return DEEP_DIVE_STAGES.length
  return DEEP_DIVE_STAGES.findIndex((s) => s.status === status)
}

/**
 * What to say about the user's provider before and after a run. Null when
 * there is nothing to say (a tested provider with web research).
 */
export function researchNote(access: Pick<DeepDiveAccess, 'research' | 'providerName'>): string | null {
  switch (access.research) {
    case 'tested':
      return null
    case 'untested':
      return `Deep dives are tested with Anthropic. With ${access.providerName ?? 'your provider'}, web research runs but hasn't been tested, so check the sources.`
    case 'none':
      return 'No web research with your provider: the report uses the job ad, your profile, the early assessment and the sponsor register only.'
  }
}

/** "$0.74" or "under $0.01"; adds "+ searches" when web search has no list price. */
export function formatRunCost(usd: number, complete: boolean): string {
  const amount = usd > 0 && usd < 0.01 ? 'under $0.01' : `$${usd.toFixed(2)}`
  return complete ? amount : `${amount} + web searches`
}
