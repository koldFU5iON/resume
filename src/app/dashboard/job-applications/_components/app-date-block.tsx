'use client'

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Pencil } from "lucide-react"
import { daysAgo, formatShortDate } from "@/lib/utils"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover'
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { updateJobDate } from "@/modules/jobs/mutations"

type ApplicationDateBlockProps = {
  date: Date | null
  label: string
  // When set, the block becomes editable and saves to this job's dateApplied.
  jobId?: string
}

export function ApplicationDateBlock({ label, date, jobId }: ApplicationDateBlockProps) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [value, setValue] = useState("")

  if (!date && !jobId) {
    return <div className="text-xs text-muted-foreground/30">—</div>
  }

  function handleOpenChange(next: boolean) {
    if (next) setValue(date?.toLocaleDateString("en-CA") ?? "")
    setOpen(next)
  }

  function handleSubmit() {
    if (!jobId || !value) return
    startTransition(async () => {
      try {
        await updateJobDate(jobId, new Date(`${value}T00:00:00`))
        setOpen(false)
      } catch {
        toast.error('Could not save the date. Your edit is still here; please try again.')
      }
    })
  }

  const days = date ? daysAgo(date) : null
  return (
    <div className="flex flex-col gap-0.5 group/date">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">{date ? formatShortDate(date) : "—"}</span>
        {jobId && (
          <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger
              aria-label={`${date ? 'Edit' : 'Add'} ${label.toLowerCase()} date`}
              className="inline-flex size-8 items-center justify-center cursor-pointer rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Pencil size={10} />
            </PopoverTrigger>
            <PopoverContent className="w-auto">
              <form action={handleSubmit} className="flex flex-col gap-2">
                <span className="text-xs font-medium">{date ? "Change" : "Add"} {label.toLowerCase()} date</span>
                <Input
                  type="date"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  required
                />
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? "Saving..." : "Save"}
                </Button>
              </form>
            </PopoverContent>
          </Popover>
        )}
      </div>
      {days !== null && (
        <div className="text-[10px] text-muted-foreground/50">
          {days === 0 ? "today" : `${days}d ago`}
        </div>
      )}
    </div>
  )
}
