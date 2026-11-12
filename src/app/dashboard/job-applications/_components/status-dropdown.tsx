'use client'

import { useTransition } from "react"
import {
  APPLICATION_STATUS_LABEL,
  ClosedStatuses,
  OpenStatuses,
  type ApplicationStatusType,
} from "@/app/types/job-application"
import { updateJobStatus } from "@/modules/jobs/mutations"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"

type StatusDropdownProps = {
  jobId: string
  status: ApplicationStatusType
  /** Called after the status is saved (e.g. to refresh a view the mutation doesn't revalidate). */
  onChanged?: () => void
  className?: string
  triggerId?: string
}

function statusDotColor(status: ApplicationStatusType): string {
  switch (status) {
    case "not started": return "bg-muted-foreground/50"
    case "in-progress": return "bg-violet-500"
    case "applied": return "bg-blue-500"
    case "interviewing": return "bg-amber-500"
    case "accepted": return "bg-green-500"
    case "rejected": return "bg-destructive"
    default: return "bg-muted-foreground/50"
  }
}

export function StatusDropdown({ jobId, status, onChanged, className, triggerId }: StatusDropdownProps) {
  const [isPending, startTransition] = useTransition()

  const handleSelect = (next: ApplicationStatusType) => {
    if (next === status) return
    startTransition(async () => {
      await updateJobStatus(jobId, next)
      onChanged?.()
    })
  }

  const renderItems = (states: readonly ApplicationStatusType[]) =>
    states.map((state) => (
      <DropdownMenuItem
        key={state}
        onClick={() => handleSelect(state)}
        className="gap-2"
      >
        <span className={cn("size-2 shrink-0 rounded-full", statusDotColor(state))} aria-hidden />
        {APPLICATION_STATUS_LABEL[state]}
      </DropdownMenuItem>
    ))

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        id={triggerId}
        disabled={isPending}
        aria-label={`Application status: ${APPLICATION_STATUS_LABEL[status]}`}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5", className)}
      >
        {isPending
          ? <Loader2 className="size-3 animate-spin" />
          : <span className={cn("size-2 shrink-0 rounded-full", statusDotColor(status))} aria-hidden />
        }
        {APPLICATION_STATUS_LABEL[status]}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>{renderItems(OpenStatuses)}</DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>{renderItems(ClosedStatuses)}</DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
