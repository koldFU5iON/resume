'use client'

import { useTransition } from "react"
import { toast } from "sonner"
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

export function StatusDropdown({ jobId, status }: StatusDropdownProps) {
  const [isPending, startTransition] = useTransition()

  const handleSelect = (next: ApplicationStatusType) => {
    if (next === status) return
    startTransition(async () => {
      try {
        await updateJobStatus(jobId, next)
      } catch {
        toast.error('Could not update status. Please try again.')
      }
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
        disabled={isPending}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
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
