/** Selection follows rendered groups, excluding collapsed rows. */
export function visibleJobIds(
  groups: { key: string; label: string | null; jobs: { id: string }[]; defaultCollapsed: boolean }[],
  collapsed: Record<string, boolean>,
): Set<string> {
  return new Set(groups.flatMap(group =>
    group.label !== null && (collapsed[group.key] ?? group.defaultCollapsed)
      ? []
      : group.jobs.map(job => job.id),
  ))
}
