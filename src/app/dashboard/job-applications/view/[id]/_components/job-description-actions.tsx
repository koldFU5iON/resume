'use client'

import { useState } from "react"
import { Pencil, SquareArrowOutUpRight } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Job } from "@/app/types/job-application"
import { EditJobDialog } from "@/app/dashboard/job-applications/_components/edit-job-dialog"

/** Edit details and View listing, beside the Job Description heading. */
export function JobDescriptionActions({ job, hasLLMKey }: { job: Job; hasLLMKey: boolean }) {
  const [editOpen, setEditOpen] = useState(false)

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => setEditOpen(true)}>
        <Pencil aria-hidden="true" />
        Edit details
      </Button>
      {job.url && (
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1.5 text-muted-foreground")}
        >
          <SquareArrowOutUpRight aria-hidden="true" />
          View listing
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      )}
      <EditJobDialog job={job} open={editOpen} onOpenChange={setEditOpen} hasLLMKey={hasLLMKey} />
    </div>
  )
}
