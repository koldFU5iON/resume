import Link from 'next/link'
import { ContentContainer } from '@/app/components/ContentContainer'
import { requireProfile } from '@/lib/session'
import { getWatchlist, getDiscoveredJobs, getScanSummary } from '@/modules/job-hunt/queries'
import { getBoardSources, getSearchCriteriaForScanner, getJobBoardKeyStatus } from '@/modules/job-hunt/board-sources/queries'
import { getManualBoards } from '@/modules/job-hunt/manual-boards/queries'
import { Watchlist } from './_components/watchlist'
import { DiscoveredJobs } from './_components/discovered-jobs'
import { JobBoardSources } from './_components/job-board-sources'
import { ScanStatusBar } from './_components/scan-status-bar'
import { ScoutInvites } from './_components/scout-invites'
import { ArrowDown, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { listScoutInvites } from '@/modules/scout-inbox/service'

// Server Actions on this page queue the early job assessment, which runs in
// after() within this limit; keep in sync with ROUTE_MAX_DURATION_S in
// src/modules/job-assessment/queue.ts.
export const maxDuration = 300

export default async function JobHuntPage() {
  const { profile } = await requireProfile()

  const [watches, jobs, boardSources, criteria, keyStatus, summary, manualBoards, scoutInvites] = await Promise.all([
    getWatchlist(),
    getDiscoveredJobs(),
    getBoardSources(),
    getSearchCriteriaForScanner(),
    getJobBoardKeyStatus(),
    getScanSummary(),
    getManualBoards(),
    listScoutInvites(profile.id),
  ])

  const availableProviders = new Set<string>([
    'remotive',
    'remoteok',
    ...(keyStatus.adzunaConfigured ? ['adzuna'] : []),
    ...(keyStatus.jSearchConfigured ? ['jsearch'] : []),
  ])

  const hasCriteria = criteria.roles.length > 0 || criteria.countries.length > 0

  return (
    <ContentContainer
      title="Job Hunt"
      description="Scan companies and job boards, then review matched roles."
      fullWidth
    >
      <div className="@container">
        {/* What we search for, and how the last scan went */}
        <section aria-label="Search criteria and scan status" className="mb-8 divide-y rounded-lg border bg-card">
          <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {criteria.roles.length > 0 && (
                <span><span className="text-muted-foreground text-xs uppercase tracking-wide mr-1.5">Roles</span>{criteria.roles.join(', ')}</span>
              )}
              {criteria.countries.length > 0 && (
                <span><span className="text-muted-foreground text-xs uppercase tracking-wide mr-1.5">Countries</span>{criteria.countries.join(', ')}</span>
              )}
              {criteria.remotePreference && (
                <span><span className="text-muted-foreground text-xs uppercase tracking-wide mr-1.5">Remote</span>{criteria.remotePreference}</span>
              )}
              {!hasCriteria && (
                <span className="text-muted-foreground text-sm">No search criteria set yet</span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* Sources sit below the roles until the rail fits beside them */}
              <a href="#sources" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '@4xl:hidden')}>
                <ArrowDown className="size-3.5 mr-1.5" />
                Sources
              </a>
              <Link
                href="/dashboard/search-context"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <Settings2 className="size-3.5 mr-1.5" />
                Edit search context
              </Link>
            </div>
          </div>
          <ScanStatusBar summary={summary} />
        </section>

        <div className="grid items-start gap-x-10 gap-y-12 @4xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0">
            <DiscoveredJobs jobs={jobs} />
          </div>

          <aside
            id="sources"
            aria-label="Sources"
            className="grid scroll-mt-6 items-start gap-10 @2xl:grid-cols-2 @4xl:grid-cols-1"
          >
            <Watchlist
              watches={watches}
              defaultLocations={criteria.countries}
              defaultRemote={criteria.remotePreference !== 'onsite'}
            />
            <div className="space-y-10">
              <JobBoardSources sources={boardSources} availableProviders={availableProviders} manualBoards={manualBoards} />
              <ScoutInvites invites={scoutInvites} />
            </div>
          </aside>
        </div>
      </div>
    </ContentContainer>
  )
}
