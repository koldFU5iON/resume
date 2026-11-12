import type { ReactNode } from "react"
import { requireProfile } from "@/lib/session"
import { getJobWorkspace } from "@/modules/jobs/queries"
import { JobWorkspaceFrame } from "./job-workspace-frame"

/**
 * The persistent job workspace (#369): job header and document navigation
 * above a single content scroller. Used by the job routes' layout and by the
 * legacy editors (CV, cover letter, interview prep) that belong to a job, so
 * every document of a job keeps the same identity, status, archive and fit
 * access. With no job (or one the user doesn't own) the children render in a
 * plain column, as the standalone editors always have.
 */
export async function JobWorkspace({ jobId, children }: { jobId: string | null; children: ReactNode }) {
  const { profile } = await requireProfile()
  const workspace = jobId ? await getJobWorkspace(profile.id, jobId) : null
  if (!workspace) return <div className="flex h-full min-h-0 flex-col">{children}</div>
  return <JobWorkspaceFrame workspace={workspace}>{children}</JobWorkspaceFrame>
}
