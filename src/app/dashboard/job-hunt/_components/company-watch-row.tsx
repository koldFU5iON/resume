'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw, Trash2, AlertTriangle, Pencil, MapPin, Clock, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { daysAgo, formatRelative } from '@/lib/utils'
import { scanCompany, removeWatch } from '@/modules/job-hunt/actions'
import { EditWatchSheet } from './edit-watch-sheet'
import type { CompanyWatch } from '@prisma/client'

const PROVIDER_LABELS: Record<string, string> = {
  greenhouse:      'Greenhouse',
  lever:           'Lever',
  ashby:           'Ashby',
  successfactors:  'SuccessFactors',
  workday:         'Workday',
  smartrecruiters: 'SmartRecruiters',
  bamboohr:        'BambooHR',
  unknown:         'Unknown',
}

export function CompanyWatchRow({ watch }: { watch: CompanyWatch }) {
  const [isScanning, startScan] = useTransition()
  const [isRemoving, startRemove] = useTransition()
  const [editOpen, setEditOpen] = useState(false)
  const router = useRouter()

  function handleScan() {
    startScan(async () => {
      const result = await scanCompany(watch.id)
      if (!result.ok) {
        const messages: Record<string, string> = {
          not_found:      'Watch not found',
          no_ats_detected: 'No ATS detected — try updating the careers URL',
          fetch_failed:   'Could not reach the job board. Try again later.',
        }
        toast.error(messages[result.error] ?? 'Scan failed')
        return
      }
      toast.success(
        result.newJobs > 0
          ? `Found ${result.newJobs} new role${result.newJobs === 1 ? '' : 's'}`
          : 'No new roles found',
      )
      router.refresh()
    })
  }

  function handleRemove() {
    startRemove(async () => {
      await removeWatch(watch.id)
      toast.success(`Stopped watching ${watch.name}`)
      router.refresh()
    })
  }

  const scanDays = daysAgo(watch.lastScannedAt)
  const scanLabel = scanDays !== null
    ? `Scanned ${formatRelative(scanDays)}`
    : 'Never scanned'

  const detectionFailed = watch.status === 'discovery_failed'

  return (
    <div className="space-y-1.5 px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        {/* Line 1: name + ATS inline */}
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 pt-1">
          <p className="text-sm font-medium leading-snug">{watch.name}</p>
          {detectionFailed ? (
            <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-3" />
              ATS unknown
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {PROVIDER_LABELS[watch.atsProvider] ?? watch.atsProvider}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={handleScan}
            disabled={isScanning || detectionFailed}
            className="h-7 px-2 text-xs"
          >
            {isScanning
              ? <Loader2 className="size-3 animate-spin" />
              : <RefreshCw className="size-3" />}
            <span className="ml-1">{isScanning ? 'Scanning…' : 'Scan'}</span>
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditOpen(true)}
            className="h-7 w-7 p-0 text-muted-foreground"
            aria-label="Edit watch"
          >
            <Pencil className="size-3.5" />
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={handleRemove}
            disabled={isRemoving}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            aria-label="Remove watch"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Line 2: meta — location filters + scan time + careers link */}
      <div className="flex items-center gap-x-3 gap-y-1 text-xs text-muted-foreground flex-wrap">
        {watch.searchLocations.length > 0 ? (
          <>
            {watch.searchLocations.map((loc) => (
              <span key={loc} className="flex items-center gap-1">
                <MapPin className="size-3" />
                {loc}
              </span>
            ))}
            {watch.includeRemote && (
              <span className="text-muted-foreground/70">+remote</span>
            )}
          </>
        ) : null}
        <span className="flex items-center gap-1">
          <Clock className="size-3" />
          {scanLabel}
        </span>
        {(watch.careersUrl || watch.website) && (
          <a
            href={watch.careersUrl ?? watch.website}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-foreground transition-colors"
            onClick={e => e.stopPropagation()}
          >
            <ExternalLink className="size-3" />
            Board
          </a>
        )}
      </div>

      {/* Line 3: persistent scan error */}
      {watch.lastScanError && (
        <p className="flex items-start gap-1 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          {watch.lastScanError}
        </p>
      )}

      <EditWatchSheet watch={watch} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  )
}
