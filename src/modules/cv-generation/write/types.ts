import type { CallUsage } from '../call'
import type { CvBrief, SectionLogEntry } from '../schema'
import type { Strategy } from '../strategy'
import type { Evidence } from './evidence'

/** What every writer needs. Built once per run by runWrite. */
export type WriteContext = {
  profileId: string
  jobApplicationId: string
  runId: string
  /** Epoch ms every call must finish by (the run's deadline less the Assemble reserve). */
  deadline: number
  brief: CvBrief
  strategy: Pick<Strategy, 'mustHave' | 'niceToHave'>
  evidence: Evidence
  /** The job's requirement text (must-have then nice-to-have): what makes a claimed tool allowed in a bullet. */
  requirementText: string
}

/**
 * What a "worth a quick check" note is about. Notes are cut to MAX_CHECK_NOTES
 * in this priority order: invented figures first, then claimed tools, then a
 * certification or education that may be shown as finished, then a missing
 * education end date.
 */
export type CheckKind = 'figure' | 'claimed' | 'credential' | 'education'
export const CHECK_KIND_RANK: Record<CheckKind, number> = { figure: 0, claimed: 1, credential: 2, education: 3 }
export type CheckNote = { kind: CheckKind; text: string }

/** The result of one writer: its markdown and what to log. */
export type WriterOutcome = {
  markdown: string
  model: string | null
  usage: CallUsage
  retries: number
  /** Notes for this section's log row. */
  notes: string[]
  /** Genuinely risky items, for "worth a quick check". Rare by design. */
  checks: CheckNote[]
  /** The same notes as plain text. */
  checkNotes: string[]
}

export type WrittenSection = {
  id: string
  kind: string
  employerKey?: string
  markdown: string
  model?: string
  tokens?: { input: number; output: number }
  log: SectionLogEntry
}
