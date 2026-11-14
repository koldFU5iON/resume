import type { ReactNode } from 'react'
import type { FullProfile } from '@/app/types/profile'

/** Years since the earliest role, at least one; the skill gauges are drawn against it. */
export function careerYears(profile: Pick<FullProfile, 'experiences'>): number {
  const now = new Date().getFullYear()
  const earliest = profile.experiences.length > 0
    ? Math.min(...profile.experiences.map(e => new Date(e.startDate).getFullYear()))
    : now - 10
  return Math.max(now - earliest, 1)
}

/** A Records page: one title, one scrolling column. */
export function RecordsPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 flex-1 min-[1100px]:min-h-0 min-[1100px]:overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6">
        <h1 className="text-xl font-semibold leading-tight">{title}</h1>
        {children}
      </div>
    </div>
  )
}
