// The one rule for what a project "says": the evidence it owns, else the
// legacy `highlights` column. Shared by the CV snapshot (profile-map) and the
// project card so the two cannot drift.

type ProjectEvidence = { description: string; impact: string | null }

/** Evidence as one line, with its impact in brackets when it has one. */
export function evidenceLine(a: ProjectEvidence): string {
  return a.impact ? `${a.description} (${a.impact})` : a.description
}

/** Owned evidence if there is any, otherwise the legacy highlights (already parsed). */
export function projectHighlights(activities: ProjectEvidence[], legacy: unknown): string[] {
  const lines: unknown[] = activities.length ? activities.map(evidenceLine) : Array.isArray(legacy) ? legacy : []
  return lines.filter((h): h is string => typeof h === 'string')
}
