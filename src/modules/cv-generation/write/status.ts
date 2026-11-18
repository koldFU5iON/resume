/**
 * "In progress", "expired" and "no end date" for certifications and education,
 * computed ONCE here and reused by render.ts (what the CV says), evidence.ts
 * (a capability backed only by an unfinished certification is still a claim),
 * candidates.ts (the Brief and Select are told) and the writers' name check.
 * The profile has no status field: it is read from the data. Pure.
 */

import type { CapabilityNote, Vault } from '@/modules/profile-map/types'
import { EDUCATION_RECENT_START_YEARS } from './limits'

export const IN_PROGRESS_WORDING = /\b(in[\s-]?progress|ongoing|expected|studying|working towards|pursuing)\b/i
export const ALREADY_MARKED = /in[\s-]?progress/i

export type CertificationDates = { name: string; issueDate: Date | null; expiryDate: Date | null }
export type CertificationStatus = 'held' | 'in_progress' | 'expired'

/**
 * In progress: an issue date in the future, or in-progress wording in the
 * name. Expired: a past expiry date (and not in progress). Otherwise held (a
 * future expiry date is a held certification).
 */
export function certificationStatus(c: CertificationDates, now: Date = new Date()): CertificationStatus {
  if ((c.issueDate !== null && c.issueDate.getTime() > now.getTime()) || IN_PROGRESS_WORDING.test(c.name)) return 'in_progress'
  if (c.expiryDate !== null && c.expiryDate.getTime() < now.getTime()) return 'expired'
  return 'held'
}

export type EducationDates = { qualification: string; field: string | null; grade: string | null; startDate: Date; endDate: Date | null }
export type EducationStatus = 'completed' | 'in_progress' | 'undated'

/**
 * In progress: in-progress wording, an end date in the future, or no end date
 * and a start within EDUCATION_RECENT_START_YEARS. A past end date is
 * completed. No end date and an older start is `undated`: the CV claims
 * neither completion nor progress.
 */
export function educationStatus(e: EducationDates, now: Date = new Date()): EducationStatus {
  if ([e.qualification, e.field ?? '', e.grade ?? ''].some((t) => IN_PROGRESS_WORDING.test(t))) return 'in_progress'
  if (e.endDate !== null) return e.endDate.getTime() > now.getTime() ? 'in_progress' : 'completed'
  const cutoff = new Date(now)
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - EDUCATION_RECENT_START_YEARS)
  return e.startDate.getTime() >= cutoff.getTime() ? 'in_progress' : 'undated'
}

/**
 * Whether a capability the profile only backs with certifications is, in fact,
 * backed by nothing finished: every certification that certifies it is still
 * in progress. profile-map calls such a capability "certified"; for a CV it is
 * still a claim. `certifierIds` are the ids of the certification notes that
 * certify it (its `certifies` backlinks).
 */
export function certifiedOnlyInProgress(
  status: string,
  certifiers: ReadonlyArray<CertificationDates>,
  now: Date = new Date(),
): boolean {
  return status === 'certified' && certifiers.length > 0 && certifiers.every((c) => certificationStatus(c, now) === 'in_progress')
}

/**
 * A capability that is a claim as far as a CV goes: the profile lists it with
 * no evidence, or its only backing is certification(s) still in progress.
 * profile-map's own status is left alone for its other consumers; this is the
 * CV generation view of it.
 */
export function isClaimedCapability(vault: Vault, note: CapabilityNote, now: Date): boolean {
  if (note.props.status === 'claimed') return true
  const certifiers = note.backlinks.flatMap((b) => {
    const c = b.type === 'certifies' ? vault.notes.get(b.id) : undefined
    return c?.type === 'certification' ? [c.props] : []
  })
  return certifiedOnlyInProgress(note.props.status, certifiers, now)
}
