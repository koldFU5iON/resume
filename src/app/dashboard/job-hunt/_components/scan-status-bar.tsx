'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { scanAll } from '@/modules/job-hunt/actions'

type ScanSummary = {
  companiesScanned: number
  companiesFailed: number
  boardsScanned: number
  boardsFailed: number
  jobsToday: number
}

function StatPill({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <span className={`text-xs ${alert && value > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
      <span className="font-medium text-foreground">{value}</span> {label}
    </span>
  )
}

export function ScanStatusBar({ summary }: { summary: ScanSummary }) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSync() {
    startTransition(async () => {
      const result = await scanAll()
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      const { scanned, newJobs, failed } = result
      const failedSuffix = failed > 0 ? ` · ${failed} failed` : ''
      if (newJobs > 0) {
        toast.success(
          `Scanned ${scanned} source${scanned === 1 ? '' : 's'} · ${newJobs} new role${newJobs === 1 ? '' : 's'} found${failedSuffix}`
        )
      } else if (failed > 0 && failed === scanned) {
        toast.error('All scans failed — check configuration')
      } else {
        toast.success(`Scanned ${scanned} source${scanned === 1 ? '' : 's'} · no new roles${failedSuffix}`)
      }
      router.refresh()
    })
  }

  const { companiesScanned, companiesFailed, boardsScanned, boardsFailed, jobsToday } = summary

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
      <Button size="sm" variant="outline" onClick={handleSync} disabled={isPending} className="shrink-0">
        {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        <span className="ml-1.5">{isPending ? 'Syncing…' : 'Sync All'}</span>
      </Button>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs tabular-nums">
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Companies</span>
          <StatPill label="scanned" value={companiesScanned} />
          {companiesFailed > 0 && <StatPill label="failed" value={companiesFailed} alert />}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Job Sources</span>
          <StatPill label="scanned" value={boardsScanned} />
          {boardsFailed > 0 && <StatPill label="failed" value={boardsFailed} alert />}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Found today</span>
          <span className="font-medium text-foreground">{jobsToday}</span>
        </span>
      </div>
    </div>
  )
}
