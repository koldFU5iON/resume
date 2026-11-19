import { z } from 'zod'

export const READINESS_KINDS = [
  'thin_narrative', 'duplicate_project',
  'cert_no_issuer', 'cert_status_in_name', 'cert_in_progress_no_date', 'cert_expired',
  'education_dates_reversed', 'education_undated',
  'experience_dates_reversed', 'concurrent_roles', 'employment_gap', 'experience_no_evidence', 'role_overview_thin',
  'unmeasured_achievements', 'figure_in_prose', 'filler_responsibility', 'long_activity', 'conflicting_figures',
  'claimed_only_capabilities', 'unlinked_evidence', 'unlisted_capability',
  'contact_missing', 'location_missing', 'right_to_work_not_shown',
] as const

/** `fix`: the CV generator cannot work around it. `consider`: worth a look; may be intended. */
export const READINESS_SEVERITIES = ['fix', 'consider'] as const

export const ReadinessFindingSchema = z.object({
  /** Stable for the same problem on the same note, so React keys and dismissals can rely on it. */
  id: z.string(),
  kind: z.enum(READINESS_KINDS),
  severity: z.enum(READINESS_SEVERITIES),
  noteId: z.string().optional(),
  noteType: z.string().optional(),
  title: z.string(),
  message: z.string(),
  suggestion: z.string(),
  editHref: z.string().optional(),
})

export type ReadinessFinding = z.infer<typeof ReadinessFindingSchema>
export type ReadinessKind = ReadinessFinding['kind']
export type ReadinessSeverity = ReadinessFinding['severity']

/** What a check returns: a finding plus how much it matters, used only for ordering. */
export type Candidate = ReadinessFinding & { impact: number }

export type ReadinessReport = {
  /** Most severe and most impactful first, at most MAX_FINDINGS. */
  findings: ReadinessFinding[]
  /** Findings before the cap. */
  total: number
  /** `fix` findings before the cap. */
  fixCount: number
}
