'use client'

import { cn, daysAgo, formatShortDate } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ApplicationStatus, type ApplicationStatusType } from '@/app/types/job-application'

type PostingAgeProps = {
  datePublished: Date | null
  dateApplied: Date | null
  status: ApplicationStatusType
}

const PRE_APPLY_STATUSES = new Set<ApplicationStatusType>([
  ApplicationStatus.NotStarted,
  ApplicationStatus.InProgress,
])

export function PostingAge({ datePublished, dateApplied, status }: PostingAgeProps) {
  if (!datePublished) {
    return <span className="text-xs text-muted-foreground/30">—</span>
  }

  const isPreApply = PRE_APPLY_STATUSES.has(status)

  if (isPreApply) {
    const daysOld = daysAgo(datePublished) ?? 0
    const colorClass =
      daysOld >= 60 ? 'text-red-500/70' :
      daysOld >= 30 ? 'text-amber-500' :
      'text-muted-foreground'
    const tooltip =
      daysOld >= 60
        ? `Posted ${daysOld} days ago — pipeline is likely full, consider moving on`
        : daysOld >= 30
          ? `Posted ${daysOld} days ago — apply soon or the window may close`
          : `Posted ${daysOld} days ago — still fresh`

    return (
      <Tooltip>
        <TooltipTrigger className="max-md:min-h-11">
          <span className={cn('cursor-default text-xs', colorClass)}>
            {formatShortDate(datePublished)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
    )
  }

  // Post-application: show days between publishing and applying
  if (!dateApplied) {
    return <span className="text-xs text-muted-foreground">{formatShortDate(datePublished)}</span>
  }

  const daysAfter = Math.max(
    0,
    Math.round((dateApplied.getTime() - datePublished.getTime()) / (1000 * 60 * 60 * 24)),
  )
  const colorClass = daysAfter >= 30 ? 'text-muted-foreground/50' : 'text-muted-foreground'
  const tooltip =
    daysAfter === 0
      ? 'Applied the day the job was posted — excellent timing'
      : daysAfter <= 7
        ? `Applied ${daysAfter} day${daysAfter === 1 ? '' : 's'} after posting — strong timing`
        : daysAfter <= 30
          ? `Applied ${daysAfter} days after posting`
          : `Applied ${daysAfter} days after posting — late in the window`

  return (
    <Tooltip>
      <TooltipTrigger className="max-md:min-h-11">
        <span className={cn('cursor-default text-xs', colorClass)}>
          {formatShortDate(datePublished)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  )
}
