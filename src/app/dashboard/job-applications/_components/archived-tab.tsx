'use client'

import { useState, useTransition, useEffect, useMemo } from 'react'
import { ArchiveRestore, ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { getArchivedJobsAction, restoreJobApplication } from '@/modules/jobs/mutations'
import { formatShortDate } from '@/lib/utils'
import { APPLICATION_STATUS_LABEL } from '@/app/types/job-application'
import type { Job } from '@/app/types/job-application'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const PAGE_SIZE = 20

export function ArchivedTab() {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    getArchivedJobsAction()
      .then(setJobs)
      .catch(() => {
        toast.error('Failed to load archived jobs')
        setError(true)
      })
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    if (!jobs) return []
    const q = query.trim().toLowerCase()
    if (!q) return jobs
    return jobs.filter(j =>
      j.title?.toLowerCase().includes(q) || j.company?.toLowerCase().includes(q)
    )
  }, [jobs, query])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function handleQueryChange(q: string) {
    setQuery(q)
    setPage(1)
  }

  if (loading || jobs === null) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground gap-2">
        <Loader2 className="size-4 animate-spin" />
        Loading archived jobs…
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Failed to load archived jobs.
      </div>
    )
  }

  if (jobs.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No archived jobs yet.
      </div>
    )
  }

  return (
    <div className="space-y-2 mt-2">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          placeholder="Search archived jobs…"
          className="pl-8 h-11 text-base md:h-8 md:text-sm"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          No archived jobs match &ldquo;{query}&rdquo;.
        </div>
      ) : (
        <>
          <div className="divide-y divide-border/30 border border-border/30 rounded-md overflow-hidden">
            {paginated.map(job => (
              <ArchivedRow
                key={job.id}
                job={job}
                onRestored={(id) => setJobs(prev => (prev ?? []).filter(j => j.id !== id))}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-muted-foreground">
                {filtered.length} job{filtered.length !== 1 ? 's' : ''}
                {query && jobs.length !== filtered.length && ` of ${jobs.length}`}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 md:size-7"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={14} />
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums px-1">
                  {safePage} / {totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 md:size-7"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  aria-label="Next page"
                >
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ArchivedRow({ job, onRestored }: { job: Job; onRestored: (id: string) => void }) {
  const [isPending, startTransition] = useTransition()

  function handleRestore() {
    startTransition(async () => {
      try {
        await restoreJobApplication(job.id)
        toast.success(`${job.title} restored`)
        onRestored(job.id)
      } catch {
        toast.error('Failed to restore job')
      }
    })
  }

  return (
    <div className="flex items-center gap-3 px-3 py-3 hover:bg-muted/30 transition-colors">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium md:truncate">{job.title}</p>
        <p className="text-sm text-muted-foreground md:truncate md:text-xs">
          {job.company}
          {job.countries.length > 0 && ` · ${job.countries.join(', ')}`}
          <span className="ml-2 opacity-60">{APPLICATION_STATUS_LABEL[job.status]}</span>
          {job.archivedAt && (
            <span className="ml-2 opacity-50">Archived {formatShortDate(job.archivedAt)}</span>
          )}
        </p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={handleRestore}
        disabled={isPending}
        className="min-h-11 shrink-0 gap-1.5 md:min-h-0"
      >
        {isPending
          ? <Loader2 size={13} className="animate-spin" />
          : <ArchiveRestore size={13} />
        }
        Restore
      </Button>
    </div>
  )
}
