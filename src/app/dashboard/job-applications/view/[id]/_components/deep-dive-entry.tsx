'use client'

import Link from "next/link"
import { ArrowRight, Loader2 } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { DeepDiveAccess } from "@/modules/deep-dive/access"
import type { DeepDiveSummary } from "@/modules/deep-dive/queries"
import { AssessmentPoller } from "@/app/dashboard/job-applications/_components/assessment-poller"
import { DeepDiveButton, VerdictChip } from "@/app/dashboard/job-applications/_components/deep-dive-button"
import {
  DEEP_DIVE_STATUS_LABEL,
  deepDiveHref,
  deepDiveSignature,
  isDeepDiveActive,
} from "@/app/dashboard/job-applications/_components/deep-dive-view"

/** The job page sidebar's Deep dive entry (spec §7): the verdict chip and a way into the report. */
export function DeepDiveEntry({ jobId, deepDive, access }: {
  jobId: string
  deepDive: DeepDiveSummary | null
  access: DeepDiveAccess
}) {
  if (!deepDive) {
    return <DeepDiveButton jobId={jobId} deepDive={null} access={access} />
  }

  const active = isDeepDiveActive(deepDive.status)
  return (
    <div className="flex flex-col gap-2">
      <AssessmentPoller signature={deepDiveSignature(deepDive)} />
      {deepDive.verdict && <VerdictChip verdict={deepDive.verdict} />}
      {active && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          {DEEP_DIVE_STATUS_LABEL[deepDive.status]}
        </p>
      )}
      {deepDive.status === 'failed' && (
        <p className="text-xs text-muted-foreground">
          {deepDive.hasReport ? 'The latest run failed. The last report is still there.' : 'The last run failed.'}
        </p>
      )}
      <Link
        href={deepDiveHref(jobId)}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 gap-1 text-xs")}
      >
        {deepDive.hasReport ? 'Open report' : active ? 'Watch progress' : 'Open'}
        <ArrowRight className="size-3" aria-hidden="true" />
      </Link>
    </div>
  )
}
