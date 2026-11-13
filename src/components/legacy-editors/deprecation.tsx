"use client"

import { useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { Plus, TriangleAlert, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { NewDocumentDialog } from "@/components/job-workspace/new-document-dialog"
import { cn } from "@/lib/utils"
import { MAX_WRITING_DESK_DOCUMENTS_PER_JOB } from "@/modules/writing-desk/schema"

/**
 * "Deprecating soon" markers for the legacy structured editors (#379): the CV
 * Builder, the cover letter editor and interview prep. They keep working;
 * Writing Desk documents replace them. One badge and one notice, so every
 * entry point says the same thing. The badge carries text and an icon, not
 * colour alone; the amber tones are the existing warning treatment and read
 * in both themes.
 */

export type LegacyEditorKind = "cv" | "cover-letter" | "interview-prep"

export const DEPRECATING_SOON = "Deprecating soon"

const EDITOR_NAME: Record<LegacyEditorKind, string> = {
  cv: "The CV Builder",
  "cover-letter": "The cover letter editor",
  "interview-prep": "Interview prep",
}

/** What to create instead, as the "+" dialog names the type. */
const REPLACEMENT: Record<LegacyEditorKind, string> = {
  cv: "CV",
  "cover-letter": "cover letter",
  "interview-prep": "interview prep document",
}

/** The short explanation shown beside the badge where there's room for one line. */
export const LEGACY_EDITORS_EXPLANATION = "Being replaced by Writing Desk documents. They keep working for now."

export function DeprecatingSoonBadge({ className }: { className?: string }) {
  return (
    <Badge variant="warning" className={cn("gap-1 font-medium", className)}>
      <TriangleAlert aria-hidden="true" />
      {DEPRECATING_SOON}
    </Badge>
  )
}

const DISMISSED_KEY_PREFIX = "legacy-editor-notice-dismissed:"
const DISMISS_EVENT = "legacy-editor-notice-dismissed"

function readDismissed(kind: LegacyEditorKind): boolean {
  try {
    return localStorage.getItem(`${DISMISSED_KEY_PREFIX}${kind}`) === "1"
  } catch {
    return false
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange)
  window.addEventListener(DISMISS_EVENT, onChange)
  return () => {
    window.removeEventListener("storage", onChange)
    window.removeEventListener(DISMISS_EVENT, onChange)
  }
}

/** Per-viewer and per-editor: once dismissed on this device, it stays dismissed. The tabs and menus keep their badges. */
function useDismissed(kind: LegacyEditorKind): [boolean, () => void] {
  const dismissed = useSyncExternalStore(subscribe, () => readDismissed(kind), () => false)
  function dismiss() {
    try {
      localStorage.setItem(`${DISMISSED_KEY_PREFIX}${kind}`, "1")
    } catch {}
    window.dispatchEvent(new Event(DISMISS_EVENT))
  }
  return [dismissed, dismiss]
}

/** The job a legacy page belongs to, so the notice can create its Writing Desk replacement there. */
export type LegacyNoticeJob = { id: string; documentNames: string[] }

/**
 * Dismissible notice at the top of a legacy editor (and its list pages). On a
 * job's legacy editor it offers to create the matching Writing Desk document
 * for that job; elsewhere it points to the Writing Desk.
 */
export function LegacyEditorNotice({
  kind,
  job,
  className,
}: {
  kind: LegacyEditorKind
  job?: LegacyNoticeJob | null
  className?: string
}) {
  const [dismissed, dismiss] = useDismissed(kind)
  const [creating, setCreating] = useState(false)
  if (dismissed) return null

  const atCap = job ? job.documentNames.length >= MAX_WRITING_DESK_DOCUMENTS_PER_JOB : false
  const replacement = REPLACEMENT[kind]

  return (
    <section
      aria-label={`${EDITOR_NAME[kind]}: ${DEPRECATING_SOON.toLowerCase()}`}
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 print:hidden",
        className,
      )}
    >
      <DeprecatingSoonBadge />
      <p className="min-w-0 flex-1 basis-64 text-sm text-amber-900 dark:text-amber-100">
        {EDITOR_NAME[kind]} is being replaced by Writing Desk documents. It keeps working for now, and nothing you have here is removed.
        {job
          ? atCap
            ? ` This job already has ${MAX_WRITING_DESK_DOCUMENTS_PER_JOB} documents; delete one to make room for a new ${replacement}.`
            : ` Try a Writing Desk ${replacement} for this job instead.`
          : ` Start one from a job's "+" button, or open the Writing Desk.`}
      </p>
      <div className="flex shrink-0 items-center gap-1">
        {job ? (
          !atCap && (
            <Button size="sm" variant="outline" className="h-7 gap-1 bg-background text-xs" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              New Writing Desk {replacement}
            </Button>
          )
        ) : (
          <Link href="/dashboard/writing-desk" className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-7 bg-background text-xs")}>
            Open the Writing Desk
          </Link>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-amber-900 hover:bg-amber-500/15 dark:text-amber-100"
          aria-label="Dismiss this notice"
          title="Dismiss"
          onClick={dismiss}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      {creating && job && (
        <NewDocumentDialog
          jobId={job.id}
          existingNames={job.documentNames}
          initialType={kind}
          open
          onOpenChange={setCreating}
        />
      )}
    </section>
  )
}
