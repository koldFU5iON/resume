"use client"

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  allSectionsOpen,
  resolveSectionOpen,
  setAllSections,
} from "@/app/dashboard/job-applications/_components/cv-generation-view"
import type { CvGenerationStatus } from "@/modules/cv-generation/schema"

type Ctx = {
  status: CvGenerationStatus
  ids: readonly string[]
  overrides: Record<string, boolean>
  setOpen: (id: string, open: boolean) => void
  setAll: (open: boolean) => void
}

const SectionsContext = createContext<Ctx | null>(null)

/**
 * Open state for every collapsible section on the log page. It lives here, in
 * client state, so the poller's router.refresh() (which re-renders the server
 * page but keeps this component mounted) never resets a section the user
 * opened. Only the user's own choices are stored; everything else follows the
 * status default (all collapsed while a run is active).
 */
export function LogSectionsProvider({ status, ids, children }: { status: CvGenerationStatus; ids: readonly string[]; children: ReactNode }) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const setOpen = useCallback((id: string, open: boolean) => setOverrides((o) => ({ ...o, [id]: open })), [])
  const setAll = useCallback((open: boolean) => setOverrides(setAllSections(ids, open)), [ids])
  const value = useMemo(() => ({ status, ids, overrides, setOpen, setAll }), [status, ids, overrides, setOpen, setAll])
  return <SectionsContext.Provider value={value}>{children}</SectionsContext.Provider>
}

function useSections(): Ctx {
  const ctx = useContext(SectionsContext)
  if (!ctx) throw new Error("LogSection must be rendered inside LogSectionsProvider")
  return ctx
}

export function ExpandAllButton() {
  const { status, ids, overrides, setAll } = useSections()
  if (ids.length === 0) return null
  const allOpen = allSectionsOpen(overrides, status, ids)
  return (
    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setAll(!allOpen)}>
      {allOpen ? "Collapse all" : "Expand all"}
    </Button>
  )
}

/**
 * A collapsible section. The toggle is a real button carrying aria-expanded and
 * aria-controls; when `level` is set the button sits inside that heading so the
 * heading outline is kept. The body stays in the DOM (hidden) so nothing is
 * lost or re-fetched on collapse.
 */
export function LogSection({
  id, level, title, titleClassName, actions, preview, className, children,
}: {
  id: string
  /** Heading level the toggle sits in; omit for a row that is not a heading. */
  level?: 2 | 3
  title: ReactNode
  titleClassName?: string
  /** Controls beside the title (not inside the toggle). */
  actions?: ReactNode
  /** Always visible, under the title, even when collapsed. */
  preview?: ReactNode
  className?: string
  children: ReactNode
}) {
  const { status, overrides, setOpen } = useSections()
  const open = resolveSectionOpen(overrides, status, id)
  const bodyId = `log-section-${id.replace(/[^a-z0-9]+/gi, "-")}`
  const Heading = level === 2 ? "h2" : level === 3 ? "h3" : "div"
  return (
    <section className={className} data-open={open ? "true" : "false"}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <Heading className={cn("min-w-0", titleClassName)}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen(id, !open)}
            className="group flex w-full items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden="true" />
            <span className="min-w-0">{title}</span>
          </button>
        </Heading>
        {actions}
      </div>
      {preview}
      <div id={bodyId} hidden={!open}>{children}</div>
    </section>
  )
}
