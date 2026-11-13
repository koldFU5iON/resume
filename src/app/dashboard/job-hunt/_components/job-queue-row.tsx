'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Clock, ExternalLink, Loader2, Trash2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { daysAgo, formatRelative } from '@/lib/utils'
import { scoreDiscoveredJob, importJob, ignoreJob, removeDiscoveredJob } from '@/modules/job-hunt/actions'

const FIT_BADGE_STYLES: Record<string, string> = {
  standout: 'bg-red-500/15 text-red-700 dark:text-red-400',
  solid:    'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  stretch:  'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  possible: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  reach:    'bg-muted text-muted-foreground',
}

export type DiscoveredJobWithWatch = {
  id: string
  title: string
  company: string
  location: string | null
  url: string | null
  salary: string | null
  postedAt: Date | null
  createdAt: Date
  fitLabel: string | null
  fitScore: number | null
  status: string
  importedJobId: string | null
  source: 'COMPANY' | 'BOARD' | 'SCOUT'
  scoutVerdict: 'PRIORITY' | 'REVIEW' | 'PASS' | null
  triageStatus: 'PENDING' | 'PROCESSING' | 'COMPLETE' | 'FAILED'
  watch: { name: string; atsProvider: string } | null
  boardSource: { provider: string } | null
}

export function JobQueueRow({ job }: { job: DiscoveredJobWithWatch }) {
  const [isScoring, startScore] = useTransition()
  const [isImporting, startImport] = useTransition()
  const [isIgnoring, startIgnore] = useTransition()
  const [isRemoving, startRemove] = useTransition()
  const router = useRouter()

  const days = daysAgo(job.postedAt ?? job.createdAt) ?? 0
  const ageLabel = job.postedAt
    ? `Posted ${formatRelative(days)}`
    : `Found ${formatRelative(days)}`

  function handleScore() {
    startScore(async () => {
      const result = await scoreDiscoveredJob(job.id)
      if (!result.ok) { toast.error(result.error); return }
      toast.success(`Fit scored: ${result.fitLabel}`)
      router.refresh()
    })
  }

  function handleImport() {
    startImport(async () => {
      const result = await importJob(job.id)
      if (!result.ok) { toast.error(result.error); return }
      toast.success('Added to Job Applications')
      router.refresh()
    })
  }

  function handleIgnore() {
    startIgnore(async () => {
      try {
        await ignoreJob(job.id)
        router.refresh()
      } catch {
        toast.error('Failed to ignore role')
      }
    })
  }

  function handleRemove() {
    startRemove(async () => {
      try {
        await removeDiscoveredJob(job.id)
        router.refresh()
      } catch {
        toast.error('Failed to remove role')
      }
    })
  }

  const isImported = job.status === 'imported'
  const isIgnored = job.status === 'ignored'
  const isFoundToday = (daysAgo(job.createdAt) ?? 1) === 0
  const isRecentPost = job.postedAt !== null && (daysAgo(job.postedAt) ?? Infinity) < 7

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 @xl:flex-row @xl:items-start @xl:justify-between @xl:gap-4">
      <div className="min-w-0 space-y-1">
        <p className="font-medium leading-snug">{job.title}</p>
        <p className="text-sm text-muted-foreground">
          {job.company}
          {job.location && <> · {job.location}</>}
        </p>
        {/* Status first, then the facts that back it up */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1 text-xs text-muted-foreground">
          {job.fitLabel && (
            <Badge variant="outline" className={cn('border-transparent', FIT_BADGE_STYLES[job.fitLabel])}>
              {job.fitLabel}
              {job.fitScore != null ? ` · ${job.fitScore.toFixed(0)}/10` : ''}
            </Badge>
          )}
          {job.scoutVerdict && (
            <Badge variant="outline" className="border-transparent bg-violet-500/15 text-violet-700 dark:text-violet-400">
              Scout: {job.scoutVerdict.toLowerCase()}
            </Badge>
          )}
          {!isFoundToday && isRecentPost && (
            <Badge variant="info">New</Badge>
          )}
          {isImported && (
            <Badge variant="secondary">Imported</Badge>
          )}
          {job.salary && (
            <span className="font-medium text-foreground">{job.salary}</span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {ageLabel}
          </span>
          {job.watch && <span>Company watch</span>}
          {job.boardSource && <span>Job board</span>}
          {job.source === 'SCOUT' && !job.scoutVerdict && <span>Scout</span>}
          {job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <ExternalLink className="size-3" />
              View posting
            </a>
          )}
        </div>
      </div>

      {!isImported && !isIgnored && (
        <div className="flex items-center gap-1.5 shrink-0">
          {!job.fitLabel && (
            <Button size="sm" variant="outline" onClick={handleScore} disabled={isScoring}>
              {isScoring ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
              {isScoring ? 'Scoring…' : 'Score Fit'}
            </Button>
          )}
          <Button size="sm" onClick={handleImport} disabled={isImporting}>
            {isImporting ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
            {isImporting ? 'Importing…' : 'Import'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleIgnore}
            disabled={isIgnoring}
            className="text-muted-foreground"
          >
            Ignore
          </Button>
        </div>
      )}

      {isIgnored && (
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" variant="outline" onClick={handleImport} disabled={isImporting}>
            {isImporting ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
            {isImporting ? 'Importing…' : 'Import'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRemove}
            disabled={isRemoving}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
            aria-label="Remove from list"
          >
            {isRemoving ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          </Button>
        </div>
      )}

      {isImported && (
        <div className="flex items-center gap-1.5 shrink-0">
          {job.importedJobId && (
            <a
              href={`/dashboard/job-applications/view/${job.importedJobId}`}
              className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))}
            >
              View application
            </a>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRemove}
            disabled={isRemoving}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
            aria-label="Remove from list"
          >
            {isRemoving ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          </Button>
        </div>
      )}
    </div>
  )
}
