import Link from "next/link"
import { TriangleAlert } from "lucide-react"
import { jobWritingDeskHref } from "@/modules/jobs/workspace-nav"

/**
 * Shown on the old CV and cover letter generation pages, which nothing links
 * to any more (the writing desk replaced them; Phase 5 deletes them). It says
 * so and points at the writing desk for the job, or the job list without one.
 */
export function LegacyGenerationBanner({ what, jobId }: { what: "CV" | "cover letter"; jobId?: string | null }) {
  const href = jobId ? jobWritingDeskHref(jobId) : "/dashboard/job-applications"
  return (
    <div role="note" className="max-w-xl rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert className="size-4" aria-hidden="true" />
        This {what} generator is being retired
      </p>
      <p className="mt-1">
        The writing desk now writes {what === "CV" ? "CVs" : "cover letters"} for a job, shows how it chose the evidence and lets you review before accepting.{" "}
        <Link href={href} className="underline underline-offset-2">{jobId ? "Open this job's writing desk" : "Pick a job to open its writing desk"}</Link>.
      </p>
    </div>
  )
}
