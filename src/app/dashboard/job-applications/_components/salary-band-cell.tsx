'use client'

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Pencil, X } from "lucide-react"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover'
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { updateJobSalaryBand } from "@/modules/jobs/mutations"

type SalaryBandCellProps = {
  salaryBand: string | null
  jobId: string
}

export function SalaryBandCell({ salaryBand, jobId }: SalaryBandCellProps) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [value, setValue] = useState("")

  function handleOpenChange(next: boolean) {
    if (next) setValue(salaryBand ?? "")
    setOpen(next)
  }

  function saveSalary(next: string | null) {
    startTransition(async () => {
      try {
        await updateJobSalaryBand(jobId, next)
        setOpen(false)
      } catch {
        toast.error('Could not save the salary. Your edit is still here; please try again.')
      }
    })
  }

  return (
    <div className="flex items-center gap-1.5 group/salary">
      <span className={salaryBand ? "text-xs text-muted-foreground" : "text-xs text-muted-foreground/30"}>
        {salaryBand ?? "—"}
      </span>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          aria-label="Edit salary band"
          className="inline-flex size-8 items-center justify-center cursor-pointer rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Pencil size={10} />
        </PopoverTrigger>
        <PopoverContent className="w-56">
          <form action={() => saveSalary(value.trim() || null)} className="flex flex-col gap-2">
            <span className="text-xs font-medium">Salary band</span>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. $120–140k"
              maxLength={100}
              autoFocus
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={isPending} className="flex-1">
                {isPending ? "Saving..." : "Save"}
              </Button>
              {salaryBand && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => saveSalary(null)}
                  aria-label="Clear salary band"
                >
                  <X size={12} />
                </Button>
              )}
            </div>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  )
}
