'use client'

import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { TrendingUp } from 'lucide-react'
import { SalaryEstimate } from './salary-estimate'
import type { SalaryEstimate as SalaryEstimateType } from '@/app/types/job-application'

type Props = {
  jobId: string
  initialEstimate: SalaryEstimateType | null
  hasJD: boolean
  hasLLMKey: boolean
  showLabel?: boolean
}

export function SalaryPopover({ jobId, initialEstimate, hasJD, hasLLMKey, showLabel = false }: Props) {
  return (
    <Popover>
      <PopoverTrigger
        className={showLabel ? "inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm text-muted-foreground" : "inline-flex size-5 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-muted hover:text-muted-foreground"}
        aria-label={showLabel ? "Salary details and estimate" : "Salary estimate"}
      >
        <TrendingUp size={showLabel ? 16 : 11} />
        {showLabel && "Salary details"}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-64 space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Salary estimate
        </p>
        <SalaryEstimate
          jobId={jobId}
          initialEstimate={initialEstimate}
          hasJD={hasJD}
          hasLLMKey={hasLLMKey}
        />
      </PopoverContent>
    </Popover>
  )
}
