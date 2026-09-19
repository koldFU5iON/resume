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

  const pillClass = {
    neutral: 'bg-muted text-muted-foreground',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    green: 'bg-green-500/10 text-green-600 dark:text-green-400',
  }[pillVariant]

  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 mb-2 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold">{title}</span>
        {jobs.length > 0 && (
          <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium', pillClass)}>
            {jobs.length}
          </span>
        )}
        <ChevronDown className={cn('size-3.5 text-muted-foreground/50 transition-transform duration-200 ml-auto shrink-0', !open && 'rotate-90')} />
      </button>
      {open && (
        jobs.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">None</p>
        ) : (
          <div className="space-y-2">
            {jobs.map(job => <JobQueueRow key={job.id} job={job} />)}
          </div>
        )
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
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold">Discovered Roles</h2>
          <p className="text-sm text-muted-foreground">
            {pendingCount > 0 ? `${pendingCount} waiting for review` : 'No roles pending review'}
          </p>
        </div>
        <button
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setShowIgnored(v => !v)}
        >
          {showIgnored ? 'Hide ignored' : 'Show ignored'}
        </button>
      </div>

      {/* Source filter tabs */}
      <div className="flex gap-1 mb-4 border-b">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.value
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {tab === 'company'
              ? 'No company roles found yet. Scan a watched company to discover matching roles.'
              : tab === 'board'
              ? 'No board roles found yet. Enable a job board source and click Scan.'
              : tab === 'scout'
              ? 'No Scout roles have been shared yet.'
              : 'No roles found yet.'}
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
