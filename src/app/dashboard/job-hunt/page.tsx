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
import { Settings2 } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { listScoutInvites } from '@/modules/scout-inbox/service'

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
      {/* Search criteria summary */}
      <div className="rounded-lg border bg-card px-4 py-3 mb-4 flex items-center justify-between gap-4">
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
        <Link
          href="/dashboard/search-context"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          <Settings2 className="size-3.5 mr-1.5" />
          Edit search context
        </Link>
      </div>

      {/* Sync status bar */}
      <ScanStatusBar summary={summary} />

      <div className="grid grid-cols-1 lg:grid-cols-[280px_280px_1fr] gap-6 items-start">
        <aside className="space-y-6 lg:sticky lg:top-6">
          <Watchlist
            watches={watches}
            defaultLocations={criteria.countries}
            defaultRemote={criteria.remotePreference !== 'onsite'}
          />
        </aside>

          <aside className="lg:sticky lg:top-6">
          <div className="space-y-6">
            <JobBoardSources sources={boardSources} availableProviders={availableProviders} manualBoards={manualBoards} />
            <ScoutInvites invites={scoutInvites} />
          </div>
        </aside>

        <div className="min-w-0">
          <DiscoveredJobs jobs={jobs} />
        </div>
      </div>
    </ContentContainer>
  )
}
