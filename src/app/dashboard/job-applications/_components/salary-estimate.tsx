'use client'

import { useState, useTransition } from 'react'
import { Loader2, Info, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { estimateSalary } from '@/modules/jobs/salary-estimate'
import { notifyUsageUpdated } from '@/lib/usage-events'
import type { SalaryEstimate as SalaryEstimateType } from '@/app/types/job-application'

type Props = {
  jobId: string
  initialEstimate: SalaryEstimateType | null
  hasJD: boolean
  hasLLMKey: boolean
  compact?: boolean
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$',
}

function formatRange(estimate: SalaryEstimateType): string {
  const sym = CURRENCY_SYMBOLS[estimate.currency] ?? estimate.currency
  const fmt = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
  const prefix = estimate.source === 'estimated' ? '~' : ''
  if (estimate.min !== null && estimate.max !== null) {
    return `${prefix}${sym}${fmt(estimate.min)}–${sym}${fmt(estimate.max)}`
  }
  if (estimate.min !== null) return `${prefix}${sym}${fmt(estimate.min)}+`
  if (estimate.max !== null) return `${prefix}up to ${sym}${fmt(estimate.max)}`
  return 'not stated'
}

export function SalaryEstimate({ jobId, initialEstimate, hasJD, hasLLMKey, compact = false }: Props) {
  const [estimate, setEstimate] = useState<SalaryEstimateType | null>(initialEstimate)
  const [isPending, startTransition] = useTransition()
  const [expanded, setExpanded] = useState(false)

  function handleEstimate() {
    if (isPending) return
    startTransition(async () => {
      const result = await estimateSalary(jobId)
      if (result.ok) {
        setEstimate(result.estimate)
        setExpanded(false)
        notifyUsageUpdated()
      } else {
        toast.error(result.message, {
          action: result.error === 'not_configured'
            ? { label: 'Set up', onClick: () => { window.location.href = '/dashboard/settings/llm' } }
            : undefined,
        })
      }
    })
  }

  if (isPending) {
    return (
      <div className={cn(
        "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
        compact ? "h-5" : "h-6 px-1",
      )}>
        <Loader2 className="size-3 animate-spin" />
        {!compact && 'Estimating...'}
      </div>
    )
  }

  if (estimate) {
    const rangeText = formatRange(estimate)
    const isEstimated = estimate.source === 'estimated'

    if (compact) {
      return (
        <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
          {rangeText}
          {isEstimated && (
            <Tooltip>
              <TooltipTrigger
                render={<Info size={10} className="cursor-help text-muted-foreground/60" aria-label="Salary estimate info" />}
              />
              <TooltipContent side="top" className="max-w-56 text-xs">
                AI-estimated range — not stated in the job listing
              </TooltipContent>
            </Tooltip>
          )}
        </span>
      )
    }

    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{rangeText}</span>
          {isEstimated && (
            <Tooltip>
              <TooltipTrigger
                render={<Info size={12} className="cursor-help text-muted-foreground/60" aria-label="Salary estimate info" />}
              />
              <TooltipContent side="top" className="max-w-64 text-xs">
                AI-estimated range — not stated in the job listing
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {isEstimated && estimate.confidence && (
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-xs capitalize",
              estimate.confidence === 'high'   ? 'text-green-600 dark:text-green-400' :
              estimate.confidence === 'medium' ? 'text-amber-600 dark:text-amber-400' :
              'text-muted-foreground',
            )}>
              {estimate.confidence} confidence
            </span>
            {estimate.reasoning && (
              <button
                type="button"
                onClick={() => setExpanded(e => !e)}
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                {expanded ? 'less' : 'why?'}
              </button>
            )}
          </div>
        )}
        {expanded && estimate.reasoning && (
          <p className="text-xs leading-relaxed text-muted-foreground">{estimate.reasoning}</p>
        )}
      </div>
    )
  }

  // No estimate yet
  if (!hasLLMKey) {
    if (compact) return null
    return (
      <Link
        href="/dashboard/settings/llm"
        className="text-xs text-muted-foreground underline hover:text-foreground"
      >
        Set up AI to estimate
      </Link>
    )
  }

  if (!hasJD) {
    if (compact) return null
    return (
      <button
        type="button"
        disabled
        title="Add a job description first"
        className="inline-flex h-6 cursor-not-allowed items-center gap-1.5 rounded-md bg-muted px-2 text-xs text-muted-foreground opacity-40"
      >
        <TrendingUp size={11} />
        estimate salary
      </button>
    )
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleEstimate}
        title="Estimate salary"
        className="text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
      >
        est. salary
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={handleEstimate}
      className="inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-2 text-xs text-primary-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <TrendingUp size={11} />
      estimate salary
    </button>
  )
}
