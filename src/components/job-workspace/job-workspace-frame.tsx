"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import type { JobWorkspace } from "@/modules/jobs/queries"
import { EXPAND_HEADER_AT, nextCompactState } from "@/modules/jobs/workspace-nav"
import { JobWorkspaceHeader } from "./job-workspace-header"
import { JobDocumentNav } from "./job-document-nav"

type HeaderState = { compact: boolean; pinned: boolean; path: string }

/**
 * Header and document navigation sit outside the content scroller, so only
 * the page (or editor) scrolls beneath them. On phones the header compacts
 * after scrolling (with hysteresis, see nextCompactState) and offers an
 * explicit "Expand job controls"; compact styles are `max-md:` only, so the
 * state has no effect on wider screens.
 */
export function JobWorkspaceFrame({ workspace, children }: { workspace: JobWorkspace; children: ReactNode }) {
  const pathname = usePathname()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [header, setHeader] = useState<HeaderState>({ compact: false, pinned: false, path: pathname })

  // A new document starts with the full header.
  if (header.path !== pathname) setHeader({ compact: false, pinned: false, path: pathname })

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const lastTop = new WeakMap<EventTarget, number>()

    // Capture: editors scroll their own textareas/panes inside the scroller,
    // and scroll events don't bubble.
    const onScroll = (event: Event) => {
      const el = event.target
      if (!(el instanceof HTMLElement)) return
      const scrollTop = el.scrollTop
      if ((lastTop.get(el) ?? 0) === scrollTop) return // horizontal scroll
      if (el.scrollHeight <= el.clientHeight) return // no vertical overflow
      lastTop.set(el, scrollTop)
      const maxScroll = el.scrollHeight - el.clientHeight
      setHeader((prev) => {
        const pinned = scrollTop < EXPAND_HEADER_AT ? false : prev.pinned
        let compact = nextCompactState(prev.compact, { scrollTop, maxScroll, pinned })
        // Hiding the controls would drop keyboard focus to <body>.
        if (compact && !prev.compact && document.getElementById(CONTROLS_ID)?.contains(document.activeElement)) compact = false
        return compact === prev.compact && pinned === prev.pinned ? prev : { ...prev, compact, pinned }
      })
    }
    scroller.addEventListener("scroll", onScroll, { capture: true, passive: true })
    return () => scroller.removeEventListener("scroll", onScroll, { capture: true })
  }, [])

  function expandControls() {
    setHeader((prev) => ({ ...prev, compact: false, pinned: true }))
    requestAnimationFrame(() => document.getElementById(STATUS_TRIGGER_ID)?.focus())
  }

  return (
    <div data-job-workspace="" className="flex h-full min-h-0 flex-1 flex-col print:block print:h-auto">
      <JobWorkspaceHeader
        workspace={workspace}
        compact={header.compact}
        onExpand={expandControls}
        statusTriggerId={STATUS_TRIGGER_ID}
      />
      <JobDocumentNav workspace={workspace} />
      <div ref={scrollerRef} className="flex min-h-0 flex-1 flex-col overflow-auto print:block print:overflow-visible">
        {children}
      </div>
    </div>
  )
}

const STATUS_TRIGGER_ID = "job-workspace-status"
const CONTROLS_ID = "job-workspace-controls"
