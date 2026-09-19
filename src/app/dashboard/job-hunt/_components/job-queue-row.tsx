'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { MapPin, Clock, ExternalLink, Loader2, Trash2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { daysAgo, formatRelative } from '@/lib/utils'
import { scoreDiscoveredJob, importJob, ignoreJob, removeDiscoveredJob } from '@/modules/job-hunt/actions'

const FIT_BADGE_STYLES: Record<string, string> = {
  standout: 'bg-red-100 text-red-800 border-red-200',
  solid:    'bg-orange-100 text-orange-800 border-orange-200',
  stretch:  'bg-amber-100 text-amber-800 border-amber-200',
  possible: 'bg-blue-100 text-blue-800 border-blue-200',
  reach:    'bg-slate-100 text-slate-600 border-slate-200',
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
    <div className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium">{job.title}</p>
          {isFoundToday && (
            <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-emerald-50 text-emerald-700 border-emerald-200">
              Found today
            </span>
          )}
          {!isFoundToday && isRecentPost && (
            <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-blue-50 text-blue-700 border-blue-200">
              New
            </span>
          )}
          {job.fitLabel && (
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${FIT_BADGE_STYLES[job.fitLabel] ?? ''}`}>
              {job.fitLabel}
              {job.fitScore != null ? ` · ${job.fitScore.toFixed(0)}/10` : ''}
            </span>
          )}
          {isImported && (
            <Badge variant="secondary" className="text-xs">Imported</Badge>
          )}
          {job.watch && (
            <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-purple-50 text-purple-700 border-purple-200">
              company
            </span>
          )}
          {job.boardSource && (
            <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-emerald-50 text-emerald-700 border-emerald-200">
              board
            </span>
          )}
          {job.source === 'SCOUT' && (
            <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-sky-50 text-sky-700 border-sky-200">
              scout
            </span>
          )}
          {job.scoutVerdict && (
            <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-violet-50 text-violet-700 border-violet-200">
              {job.scoutVerdict.toLowerCase()}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{job.company}</p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          {job.location && (
            <span className="flex items-center gap-1">
              <MapPin className="size-3" />
              {job.location}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {ageLabel}
          </span>
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
        {job.salary && (
          <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-green-50 text-green-700 border-green-200">
            {job.salary}
          </span>
        )}
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
