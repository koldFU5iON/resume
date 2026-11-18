/**
 * Stored selection reuse (docs/cv-generation.md, Phase 4a). When a new run's
 * reuse key equals that of the newest eligible run of the same job, and that
 * run's Brief and Select are recent enough and usable, the new run copies them
 * and skips the two calls.
 *
 * The REUSE KEY (not `inputsHash`, which the deep dive's staleness check also
 * compares and so must not change) is a hash of: the inputsHash (profile text,
 * job description, strategy, deep dive id), SELECTION_PIPELINE_VERSION (bump it
 * when Brief or Select semantics change in code), and the effective texts of the
 * cv-gen-brief and cv-gen-select prompts (a user's edit changes them). Brief and
 * Select read nothing else (not the writing rules). It is stored on the run's
 * log (`reuseKey`); a run without one (stored before this key existed) is never
 * reused.
 *
 * Rules, all in code:
 * - profile-scoped: another profile's runs are never read (the query filters by
 *   profileId, so a matching hash is not enough);
 * - eligible runs: the NEWEST run of the job that is complete, or failed AFTER
 *   Select with a kind in REUSABLE_FAILURE_KINDS (draft_exists, document_limit:
 *   the run had already paid for its Brief and Select); a failure earlier than
 *   that is never a donor;
 * - the stored brief and selection must both parse, and the selection must be
 *   the employer shape (a Phase 2 row cannot feed the writers) and a model
 *   answer (a rules fallback means the model call failed: try again);
 * - the window (SELECTION_REUSE_WINDOW_DAYS) is measured from the ORIGIN of the
 *   pair, the run that actually made it (`log.reuseOrigin`), not from the run
 *   that last copied it, so reuse cannot chain on indefinitely; the note names
 *   the origin's date;
 * - `fresh: true` (start option) never reuses.
 */

import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { loadCVBriefPrompt, loadCVSelectPrompt } from '@/modules/llm/prompt-context'
import {
  REUSABLE_FAILURE_KINDS,
  SELECTION_PIPELINE_VERSION,
  SELECTION_REUSE_WINDOW_MS,
  parseBrief,
  parseSelection,
  type CvBrief,
  type CvSelection,
} from './schema'

export type ReusableSelection = {
  /** The run that MADE the brief and selection (the origin, not an intermediate run that copied them). */
  runId: string
  /** When that run started. */
  at: Date
  brief: CvBrief
  selection: CvSelection
}

/** The key a stored brief and selection must have to be reused (see the header). Pure. */
export function reuseKeyOf(parts: { version: number; inputsHash: string; briefPrompt: string; selectPrompt: string }): string {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex')
  return sha(JSON.stringify([parts.version, parts.inputsHash, sha(parts.briefPrompt), sha(parts.selectPrompt)]))
}

/** The reuse key of a run about to start: the current pipeline version and the EFFECTIVE prompts (a user's override included). */
export async function computeReuseKey(profileId: string, inputsHash: string): Promise<string> {
  const [briefPrompt, selectPrompt] = await Promise.all([loadCVBriefPrompt(profileId), loadCVSelectPrompt(profileId)])
  return reuseKeyOf({ version: SELECTION_PIPELINE_VERSION, inputsHash, briefPrompt, selectPrompt })
}

/** "18 Nov 2026" (UTC, so a log reads the same wherever it is rendered). */
export function reuseDate(at: Date): string {
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** The log line for a reused brief and selection. */
export function reuseNote(at: Date): string {
  return `Reused the brief and selection from the run of ${reuseDate(at)} (nothing changed since)`
}

/** The reuse key and origin a stored log carries, read tolerantly (anything else reads as absent). */
export function readReuseMeta(log: unknown): { key: string | null; origin: { runId: string; at: Date } | null } {
  const o = log && typeof log === 'object' && !Array.isArray(log) ? (log as Record<string, unknown>) : {}
  const key = typeof o.reuseKey === 'string' && o.reuseKey ? o.reuseKey : null
  const raw = o.reuseOrigin && typeof o.reuseOrigin === 'object' ? (o.reuseOrigin as Record<string, unknown>) : null
  const at = raw && typeof raw.at === 'string' ? new Date(raw.at) : null
  const origin = raw && typeof raw.runId === 'string' && at && !Number.isNaN(at.getTime()) ? { runId: raw.runId, at } : null
  return { key, origin }
}

/** The stored brief and selection to reuse for this run's keys, or null (see the header for the rules). */
export async function findReusableSelection(
  profileId: string,
  jobId: string,
  keys: { inputsHash: string; reuseKey: string },
  now: Date = new Date(),
): Promise<ReusableSelection | null> {
  const row = await prisma.cvGeneration.findFirst({
    where: {
      profileId,
      jobApplicationId: jobId,
      // The donor is at least as new as its origin, so a donor outside the window has an origin outside it too.
      createdAt: { gte: new Date(now.getTime() - SELECTION_REUSE_WINDOW_MS) },
      OR: [{ status: 'complete' }, { status: 'failed', failureKind: { in: [...REUSABLE_FAILURE_KINDS] } }],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, inputsHash: true, brief: true, selection: true, log: true, createdAt: true },
  })
  if (!row || !row.inputsHash || row.inputsHash !== keys.inputsHash) return null
  const meta = readReuseMeta(row.log)
  if (!meta.key || meta.key !== keys.reuseKey) return null
  const origin = meta.origin ?? { runId: row.id, at: row.createdAt }
  if (now.getTime() - origin.at.getTime() > SELECTION_REUSE_WINDOW_MS) return null
  const brief = parseBrief(row.brief)
  const selection = parseSelection(row.selection)
  if (!brief || !selection || selection.mode !== 'model' || selection.employers.length === 0) return null
  return { runId: origin.runId, at: origin.at, brief, selection }
}
