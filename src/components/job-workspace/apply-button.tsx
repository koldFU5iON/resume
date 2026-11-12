"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, Loader2, SquareArrowOutUpRight } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { ApplicationStatusType } from "@/app/types/job-application"
import { canOfferMarkApplied, jobApplyHref } from "@/modules/jobs/apply"
import { updateJobStatus } from "@/modules/jobs/mutations"
import { jobHubHref } from "@/modules/jobs/workspace-nav"

/**
 * The header's primary action (#383). Opens the job's posting in a new tab,
 * then offers "Mark as applied" beside the button. The status never changes
 * by itself: the user may want to read the posting first. With no usable
 * link, the same popover explains where to add one.
 */
export function ApplyButton({ jobId, url, status }: {
  jobId: string
  url: string | null
  status: ApplicationStatusType
}) {
  const router = useRouter()
  const href = jobApplyHref(url)
  const offer = href !== null && canOfferMarkApplied(status)
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleOpenChange(next: boolean, details: { reason: string }) {
    if (details.reason === "trigger-press" && href) {
      // Every press opens the posting; the offer stays up until dismissed.
      window.open(href, "_blank", "noopener,noreferrer")
      setOpen(offer)
      return
    }
    setOpen(next)
  }

  function markApplied() {
    startTransition(async () => {
      try {
        await updateJobStatus(jobId, "applied")
        setOpen(false)
        router.refresh()
        toast.success("Marked as applied")
      } catch {
        toast.error("Couldn't update the status. Try again.")
      }
    })
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        className={cn(
          buttonVariants({ variant: "default", size: "sm" }),
          "h-8 shrink-0 gap-1.5",
          !href && "opacity-60",
        )}
        aria-describedby={href ? undefined : `${jobId}-apply-missing`}
        title={href ? "Open the job posting in a new tab" : "No posting link saved for this job"}
      >
        Apply
        <SquareArrowOutUpRight aria-hidden="true" />
        {href && <span className="sr-only">(opens the job posting in a new tab)</span>}
      </PopoverTrigger>
      <span id={`${jobId}-apply-missing`} className="sr-only">No posting link saved for this job</span>
      <PopoverContent align="start" className="w-72">
        {href ? (
          <>
            <PopoverHeader>
              <PopoverTitle className="text-sm font-medium">Applied for this job?</PopoverTitle>
              <PopoverDescription className="text-xs text-muted-foreground">
                The posting opened in a new tab. Mark the job as applied once you&apos;ve sent your application.
              </PopoverDescription>
            </PopoverHeader>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Not yet</Button>
              <Button size="sm" className="gap-1.5" onClick={markApplied} disabled={isPending}>
                {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
                Mark as applied
              </Button>
            </div>
          </>
        ) : (
          <>
            <PopoverHeader>
              <PopoverTitle className="text-sm font-medium">No posting link yet</PopoverTitle>
              <PopoverDescription className="text-xs text-muted-foreground">
                Add the job&apos;s link with Edit details on the Job Description tab, then Apply opens it here.
              </PopoverDescription>
            </PopoverHeader>
            <div className="flex justify-end">
              <Link
                href={jobHubHref(jobId)}
                onClick={() => setOpen(false)}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Go to Job Description
              </Link>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
