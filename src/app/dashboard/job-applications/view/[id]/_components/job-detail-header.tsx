'use client'

import { useState } from "react"
import Link from "next/link"
import { type Job } from "@/app/types/job-application"
import { ArrowLeft, Pencil, SquareArrowOutUpRight } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { EditJobDialog } from "@/app/dashboard/job-applications/_components/edit-job-dialog"
import type { SponsorStatus } from "@/modules/companies/queries"
import { SponsorChip } from "./sponsor-chip"

export function JobDetailHeader({
  job,
  hasLLMKey,
  sponsor = null,
}: {
  job: Job
  hasLLMKey: boolean
  sponsor?: SponsorStatus | null
}) {
  const [editOpen, setEditOpen] = useState(false)

  return (
    <>
      <div className="flex items-center justify-between gap-4 border-b bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <Link
            href="/dashboard/job-applications"
            className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft size={14} />
            Back
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold leading-tight">{job.title}</h1>
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm text-muted-foreground">{job.company}</p>
              <SponsorChip sponsor={sponsor} />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditOpen(true)}>
            <Pencil size={13} />
            Edit
          </Button>
          {job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
            >
              <SquareArrowOutUpRight size={13} />
              View listing
            </a>
          )}
        </div>
      </div>

      <EditJobDialog job={job} open={editOpen} onOpenChange={setEditOpen} hasLLMKey={hasLLMKey} />
    </>
  )
}
