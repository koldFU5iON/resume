"use client"

import { useTransition } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { toast } from "sonner"
import { Archive, ArchiveRestore, ArrowLeft, ChevronDown, ChevronRight, Loader2, Menu, Telescope } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSidebar } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import type { JobWorkspace } from "@/modules/jobs/queries"
import { isJobDeepDivePath, jobDeepDiveHref } from "@/modules/jobs/workspace-nav"
import { archiveJobApplication, restoreJobApplication } from "@/modules/jobs/mutations"
import { StatusDropdown } from "@/app/dashboard/job-applications/_components/status-dropdown"
import { EarlyAssessment } from "@/app/dashboard/job-applications/_components/early-assessment"
import { VerdictChip } from "@/app/dashboard/job-applications/_components/deep-dive-button"
import { DEEP_DIVE_STATUS_LABEL, isDeepDiveActive } from "@/app/dashboard/job-applications/_components/deep-dive-view"

const CONTROLS_ID = "job-workspace-controls" // also read by JobWorkspaceFrame

export function JobWorkspaceHeader({ workspace, compact, onExpand, statusTriggerId }: {
  workspace: JobWorkspace
  /** Phone only: title row only, controls behind "Expand job controls". */
  compact: boolean
  onExpand: () => void
  statusTriggerId: string
}) {
  const router = useRouter()
  const { setOpenMobile } = useSidebar()
  const archived = workspace.archivedAt !== null

  return (
    <header
      className={cn(
        "flex min-w-0 shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b bg-background px-2 py-2 md:gap-x-3 md:px-4 md:py-2.5 lg:flex-nowrap print:hidden",
        compact && "max-md:flex-nowrap max-md:py-1.5",
      )}
    >
      <Button variant="ghost" size="icon-lg" className="md:hidden" onClick={() => setOpenMobile(true)} aria-label="Open navigation">
        <Menu className="size-5" />
      </Button>
      <Link
        href="/dashboard/job-applications"
        aria-label="Back to applications"
        title="Back to applications"
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          compact && "max-md:hidden",
        )}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
      </Link>

      <div className="min-w-0 flex-1">
        {workspace.company && (
          <p className={cn("truncate text-xs text-muted-foreground", compact && "max-md:hidden")}>{workspace.company}</p>
        )}
        <h1
          className={cn("truncate text-[15px] leading-snug font-semibold md:text-base", compact && "max-md:text-sm")}
          title={workspace.company ? `${workspace.title} — ${workspace.company}` : workspace.title}
        >
          {workspace.title}
        </h1>
      </div>

      {compact && (
        <Button
          variant="outline"
          size="icon"
          className="md:hidden"
          onClick={onExpand}
          aria-label="Expand job controls"
          title="Expand job controls"
          aria-expanded={false}
          aria-controls={CONTROLS_ID}
        >
          <ChevronDown aria-hidden="true" />
        </Button>
      )}

      <div
        id={CONTROLS_ID}
        className={cn("flex w-full min-w-0 items-center gap-2 lg:w-auto lg:shrink-0", compact && "max-md:hidden")}
      >
        {archived && (
          <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">Archived</span>
        )}
        <StatusDropdown
          jobId={workspace.jobId}
          status={workspace.status}
          triggerId={statusTriggerId}
          onChanged={() => router.refresh()}
          className="h-8"
        />
        <FitControl workspace={workspace} />
        <ArchiveControl jobId={workspace.jobId} archived={archived} />
      </div>
    </header>
  )
}

/** The fit score (early assessment detail on click) and the Deep Dive, as one entry point. */
function FitControl({ workspace }: { workspace: JobWorkspace }) {
  const pathname = usePathname()
  const { jobId, earlyAssessment, earlyEnabled, deepDive, deepDiveAccess } = workspace
  const onDeepDive = isJobDeepDivePath(pathname, jobId)
  const showFit = earlyAssessment !== null || earlyEnabled
  const active = isDeepDiveActive(deepDive?.status)

  return (
    <div className="flex h-8 min-w-0 items-center rounded-lg border bg-background dark:border-input dark:bg-input/30">
      {showFit && (
        <span className="flex h-full items-center border-r px-1">
          <EarlyAssessment
            jobId={jobId}
            assessment={earlyAssessment}
            enabled={earlyEnabled}
            deepDive={deepDive}
            deepDiveAccess={deepDiveAccess}
          />
        </span>
      )}
      <Link
        href={jobDeepDiveHref(jobId)}
        aria-current={onDeepDive ? "page" : undefined}
        className={cn(
          "flex h-full min-w-0 items-center gap-1.5 rounded-r-lg px-2 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          !showFit && "rounded-l-lg",
          onDeepDive && "bg-muted text-foreground",
        )}
      >
        {active
          ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
          : <Telescope className="size-3.5 shrink-0" aria-hidden="true" />}
        {/* Phones keep the fit pill and an icon; the label stays for screen readers. */}
        <span className={cn("whitespace-nowrap", showFit && "max-sm:sr-only")}>
          {active && deepDive ? DEEP_DIVE_STATUS_LABEL[deepDive.status] : "Deep Dive"}
        </span>
        {!active && deepDive?.verdict && <VerdictChip verdict={deepDive.verdict} className="max-lg:hidden" />}
        <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
      </Link>
    </div>
  )
}

/**
 * Archive in destructive red in both themes; Restore is neutral. Same
 * mutations and recovery as the Applications list (its Archived tab), plus
 * Undo on the toast.
 */
function ArchiveControl({ jobId, archived }: { jobId: string; archived: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function restore() {
    startTransition(async () => {
      try {
        await restoreJobApplication(jobId)
        router.refresh()
        toast.success("Job restored")
      } catch {
        toast.error("Failed to restore")
      }
    })
  }

  function archive() {
    startTransition(async () => {
      try {
        await archiveJobApplication(jobId)
        router.refresh()
        toast.success("Job archived", {
          description: "Find it under Applications → Archived.",
          action: { label: "Undo", onClick: restore },
        })
      } catch {
        toast.error("Failed to archive")
      }
    })
  }

  if (archived) {
    return (
      <Button variant="outline" size="sm" className="ml-auto h-8 gap-1.5 lg:ml-0" onClick={restore} disabled={isPending}>
        {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ArchiveRestore aria-hidden="true" />}
        Restore
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="ml-auto h-8 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive lg:ml-0 dark:hover:bg-destructive/20"
      onClick={archive}
      disabled={isPending}
    >
      {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Archive aria-hidden="true" />}
      Archive
    </Button>
  )
}
