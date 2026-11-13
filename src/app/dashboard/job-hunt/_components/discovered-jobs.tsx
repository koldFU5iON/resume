'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { JobQueueRow } from './job-queue-row'
import type { DiscoveredJobWithWatch } from './job-queue-row'

type FilterTab = 'all' | 'company' | 'board' | 'scout' | 'scored'

const TABS: { value: FilterTab; label: string }[] = [
  { value: 'all',     label: 'All' },
  { value: 'company', label: 'Company' },
  { value: 'board',   label: 'Boards' },
  { value: 'scout',   label: 'Scout' },
  { value: 'scored',  label: 'Scored' },
]

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function GroupAccordion({
  title,
  jobs,
  pillVariant = 'neutral',
  defaultOpen = true,
}: {
  title: string
  jobs: DiscoveredJobWithWatch[]
  pillVariant?: 'neutral' | 'amber' | 'green'
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (jobs.length === 0) return null

  const pillClass = {
    neutral: 'bg-muted text-muted-foreground',
    amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  }[pillVariant]

  return (
    <div className="mb-8 last:mb-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 mb-2 py-1.5 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold">{title}</span>
        <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium tabular-nums', pillClass)}>
          {jobs.length}
        </span>
        <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform duration-200 ml-auto shrink-0', !open && '-rotate-90')} />
      </button>
      {open && (
        <div className="divide-y rounded-lg border">
          {jobs.map(job => <JobQueueRow key={job.id} job={job} />)}
        </div>
      )}
    </div>
  )
}

type Props = {
  jobs: DiscoveredJobWithWatch[]
}

export function DiscoveredJobs({ jobs }: Props) {
  const [tab, setTab] = useState<FilterTab>('all')
  const [showIgnored, setShowIgnored] = useState(false)

  const today = startOfToday()

  const visible = jobs.filter((j) => {
    if (!showIgnored && j.status === 'ignored') return false
    if (tab === 'company') return j.watch != null
    if (tab === 'board')   return j.boardSource != null
    if (tab === 'scout')   return j.source === 'SCOUT'
    if (tab === 'scored')  return j.fitLabel != null
    return true
  })

  const foundToday  = visible.filter(j => (j.status === 'new' || j.status === 'scored') && new Date(j.createdAt) >= today)
  const underReview = visible.filter(j => (j.status === 'new' || j.status === 'scored') && new Date(j.createdAt) < today)
  const imported    = visible.filter(j => j.status === 'imported')

  const pendingCount = jobs.filter(j => j.status === 'new' || j.status === 'scored').length

  return (
    <section className="@container">
      <div className="flex items-end justify-between gap-4 mb-4">
        <div>
          <h2 className="text-base font-semibold">Discovered Roles</h2>
          <p className="text-sm text-muted-foreground">
            {pendingCount > 0 ? `${pendingCount} waiting for review` : 'No roles pending review'}
          </p>
        </div>
        <button
          className="shrink-0 py-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          aria-pressed={showIgnored}
          onClick={() => setShowIgnored(v => !v)}
        >
          {showIgnored ? 'Hide ignored' : 'Show ignored'}
        </button>
      </div>

      {/* Source filter tabs */}
      <div className="flex mb-6 border-b overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            aria-pressed={tab === t.value}
            className={`shrink-0 px-2.5 py-2 text-sm font-medium border-b-2 transition-colors @md:px-3.5 ${
              tab === t.value
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {foundToday.length + underReview.length + imported.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {tab === 'company'
              ? 'No company roles found yet. Scan a watched company to discover matching roles.'
              : tab === 'board'
              ? 'No board roles found yet. Enable a job board source and click Scan.'
              : tab === 'scout'
              ? 'No Scout roles have been shared yet.'
              : tab === 'scored'
              ? 'No scored roles yet. Use Score Fit on a role to see how well it matches.'
              : 'No roles found yet. Watch a company or enable a job board under Sources, then Sync All.'}
          </p>
        </div>
      ) : (
        <>
          <GroupAccordion title="Found today"   jobs={foundToday}  pillVariant="amber"   defaultOpen={true} />
          <GroupAccordion title="Under review"  jobs={underReview} pillVariant="neutral" defaultOpen={true} />
          <GroupAccordion title="Imported"      jobs={imported}    pillVariant="green"   defaultOpen={false} />
        </>
      )}
    </section>
  )
}
