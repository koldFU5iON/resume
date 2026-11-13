import { JobWorkspace } from "@/components/job-workspace/job-workspace"

/**
 * Job Description, Writing Desk and Deep Dive share the workspace header and
 * document navigation; the layout keeps them in place while the pages change.
 */
export default async function JobLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <JobWorkspace jobId={id}>{children}</JobWorkspace>
}
