'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { toggleBoardSource, scanBoardSource } from '@/modules/job-hunt/board-sources/actions'
import type { JobBoardSource } from '@prisma/client'

const PROVIDER_META: Record<string, { label: string; description: string }> = {
  remotive:  { label: 'Remotive',  description: 'Remote tech · no auth' },
  remoteok:  { label: 'RemoteOK',  description: 'Remote jobs · no auth' },
  adzuna:    { label: 'Adzuna',    description: 'Global broad coverage' },
  jsearch:   { label: 'JSearch',   description: 'LinkedIn · Indeed · Glassdoor' },
}

export function BoardSourceRow({
  source,
  isAdapterAvailable,
}: {
  source: JobBoardSource
  isAdapterAvailable: boolean
}) {
  const [isToggling, startToggle] = useTransition()
  const [isScanning, startScan] = useTransition()
  const router = useRouter()
  const meta = PROVIDER_META[source.provider] ?? { label: source.provider, description: '' }

  function handleToggle() {
    startToggle(async () => {
      await toggleBoardSource(source.id)
      router.refresh()
    })
  }

  function handleScan() {
    startScan(async () => {
      const result = await scanBoardSource(source.id)
      if (!result.ok) {
        const messages: Record<string, string> = {
          not_found: 'Source not found',
          no_ats_detected: source.provider === 'jsearch'
            ? 'JSearch API key not configured — add it in Settings → Job Boards'
            : 'Source not available — check app configuration',
          fetch_failed: 'Could not reach job board. Try again later.',
          key_invalid: 'API key rejected — check your key in Settings → Job Boards',
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

  const canScan = source.enabled && isAdapterAvailable

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">{meta.label}</p>
        <p className="text-xs text-muted-foreground">{meta.description}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {canScan && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleScan}
            disabled={isScanning}
            className="h-7 px-2 text-xs"
          >
            {isScanning
              ? <Loader2 className="size-3 animate-spin" />
              : <RefreshCw className="size-3" />}
            <span className="ml-1">{isScanning ? 'Scanning…' : 'Scan'}</span>
          </Button>
        )}
        {!isAdapterAvailable && source.provider === 'jsearch' && (
          <a
            href="/dashboard/settings/job-boards"
            className="text-xs text-primary hover:underline whitespace-nowrap"
          >
            Configure →
          </a>
        )}
        <Switch
          checked={source.enabled}
          onCheckedChange={handleToggle}
          disabled={isToggling}
          aria-label={`Toggle ${meta.label}`}
        />
      </div>
    </div>
  )
}
