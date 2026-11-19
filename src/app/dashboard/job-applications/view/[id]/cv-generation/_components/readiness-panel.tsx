"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronRight, CircleCheck, ClipboardCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ReadinessFinding, ReadinessReport } from "@/modules/profile-readiness/schema"

/** Anchor the writing desk hint links to. */
export const READINESS_PANEL_ID = "profile-readiness"

/** How many titles the collapsed panel previews. */
const PREVIEW_TITLES = 3

export const readinessHeading = (r: Pick<ReadinessReport, "total" | "fixCount">): string =>
  r.total === 0 ? "Profile ready" : `Profile readiness: ${r.fixCount > 0 ? `${r.fixCount} to fix` : "nothing to fix"}${r.total > r.fixCount ? `, ${r.total - r.fixCount} to consider` : ""}`

/**
 * What in the profile will limit the CV, checked before a paid run (no model
 * call). Collapsible like the log sections; never blocks generating. Its own
 * open state, so it works on the empty page too (outside LogSectionsProvider).
 */
export function ReadinessPanel({ report }: { report: ReadinessReport }) {
  const [open, setOpen] = useState(false)
  if (report.total === 0) {
    return (
      <p id={READINESS_PANEL_ID} className="flex items-center gap-2 text-sm text-muted-foreground">
        <CircleCheck className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
        Profile ready: nothing to fix before generating.
      </p>
    )
  }
  const bodyId = `${READINESS_PANEL_ID}-body`
  const hidden = report.total - report.findings.length
  return (
    <section id={READINESS_PANEL_ID} className="rounded-lg border bg-muted/30 px-3 py-3 text-sm" data-open={open ? "true" : "false"}>
      <h2 className="font-semibold">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-start gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden="true" />
          <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0">{readinessHeading(report)}</span>
        </button>
      </h2>
      {!open && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {report.findings.slice(0, PREVIEW_TITLES).map((f) => f.title).join(" · ")}
          {report.total > PREVIEW_TITLES ? " …" : ""}
        </p>
      )}
      <div id={bodyId} hidden={!open}>
        <p className="mt-2 text-xs text-muted-foreground">Thin or inconsistent profile data limits what a CV can say. This check runs on your profile only (no model, no cost) and never blocks generating.</p>
        <ul className="mt-3 space-y-3">
          {report.findings.map((f) => <FindingRow key={f.id} finding={f} />)}
        </ul>
        {hidden > 0 && <p className="mt-3 text-xs text-muted-foreground">{hidden} more not shown.</p>}
      </div>
    </section>
  )
}

function FindingRow({ finding: f }: { finding: ReadinessFinding }) {
  return (
    <li className="space-y-0.5">
      <p>
        <span className={cn("mr-1.5 text-xs font-medium", f.severity === "fix" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
          {f.severity === "fix" ? "Fix" : "Consider"}
        </span>
        {f.message}
      </p>
      <p className="text-xs text-muted-foreground">{f.suggestion}</p>
      {f.editHref && (
        <Link href={f.editHref} className="inline-block text-xs underline underline-offset-2 hover:text-foreground">Edit in profile</Link>
      )}
    </li>
  )
}
