/**
 * Stored selection reuse (docs/cv-generation.md, Phase 4a). When a new run's
 * inputsHash (profile + job + strategy, computed in Gather) equals that of the
 * newest COMPLETE run of the same job, and that run is recent enough and holds
 * a usable Brief and Select, the new run copies them and skips the two calls.
 *
 * Rules, all in code:
 * - profile-scoped: another profile's runs are never read (the query filters by
 *   profileId, so a hash that happens to match is not enough);
 * - only the NEWEST complete run of the job counts, and only within
 *   SELECTION_REUSE_WINDOW_DAYS (by its creation date);
 * - the stored brief and selection must both parse, and the selection must be
 *   the employer shape (a Phase 2 row cannot feed the writers) and a model
 *   answer (a rules fallback means the model call failed: try again);
 * - `fresh: true` (start option) never reuses.
 */

import { prisma } from '@/lib/db'
import {
  SELECTION_REUSE_WINDOW_MS,
  parseBrief,
  parseSelection,
  type CvBrief,
  type CvSelection,
} from './schema'

export type ReusableSelection = {
  /** The run the brief and selection came from. */
  runId: string
  /** When that run was created. */
  at: Date
  brief: CvBrief
  selection: CvSelection
}

/** "18 Nov 2026" (UTC, so a log reads the same wherever it is rendered). */
export function reuseDate(at: Date): string {
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** The log line for a reused brief and selection. */
export function reuseNote(at: Date): string {
  return `Reused the brief and selection from the run of ${reuseDate(at)} (nothing changed since)`
}

/** The stored brief and selection to reuse for `inputsHash`, or null (see the header for the rules). */
export async function findReusableSelection(
  profileId: string,
  jobId: string,
  inputsHash: string,
  now: Date = new Date(),
): Promise<ReusableSelection | null> {
  const row = await prisma.cvGeneration.findFirst({
    where: {
      profileId,
      jobApplicationId: jobId,
      status: 'complete',
      createdAt: { gte: new Date(now.getTime() - SELECTION_REUSE_WINDOW_MS) },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, inputsHash: true, brief: true, selection: true, createdAt: true },
  })
  if (!row || !row.inputsHash || row.inputsHash !== inputsHash) return null
  const brief = parseBrief(row.brief)
  const selection = parseSelection(row.selection)
  if (!brief || !selection || selection.mode !== 'model' || selection.employers.length === 0) return null
  return { runId: row.id, at: row.createdAt, brief, selection }
}
