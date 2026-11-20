import type { CallUsage } from '../call'
import type { BulletProvenance, BulletSource, CvBrief, SectionLogEntry } from '../schema'
import type { Strategy } from '../strategy'
import type { Evidence } from './evidence'

/** What every writer needs. Built once per run by runWrite. */
export type WriteContext = {
  profileId: string
  jobApplicationId: string
  runId: string
  /** The desk document the draft will land in, when it already exists (usage attribution). */
  writingDeskDocumentId?: string | null
  /** Epoch ms every call must finish by (the run's deadline less the Assemble reserve). */
  deadline: number
  brief: CvBrief
  strategy: Pick<Strategy, 'mustHave' | 'niceToHave'>
  evidence: Evidence
  /** The job's requirement text (must-have then nice-to-have): what makes a claimed tool allowed in a bullet. */
  requirementText: string
  /**
   * The years the profile opener states, already floored (years.ts: from the
   * earliest role start across every employer, to the nearest 5, 10 at the
   * least): the prompt asks for exactly "<n>+ years" and the figure check
   * accepts that number. Null or unset (a career under 10 years) the profile
   * writer is told NOT to state a number of years.
   */
  yearsOfExperience?: number | null
}

/**
 * What a "worth a quick check" note is about. Notes are cut to MAX_CHECK_NOTES
 * in this priority order: invented figures first, then claimed tools, then a
 * certification or education that may be shown as finished, then a
 * competency label the profile and experience do not back, then a missing
 * education end date.
 */
export type CheckKind = 'figure' | 'claimed' | 'credential' | 'competency' | 'education'
export const CHECK_KIND_RANK: Record<CheckKind, number> = { figure: 0, claimed: 1, credential: 2, competency: 3, education: 4 }
export type CheckNote = { kind: CheckKind; text: string }

/** The result of one writer: its markdown and what to log. */
export type WriterOutcome = {
  markdown: string
  model: string | null
  usage: CallUsage
  retries: number
  /** Why the retry happened, as short phrases ("figure 14k not in evidence", "first person"); empty with no retry. */
  retryReasons: string[]
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
  /** An employer or project entry's bullets with the evidence each came from (display order). */
  bullets?: BulletProvenance[]
  /** The source of an independent project's heading and fallback context. */
  projectSource?: BulletSource
  model?: string
  tokens?: { input: number; output: number }
  log: SectionLogEntry
}
