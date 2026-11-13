"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, Copy } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type CopyFormat = "markdown" | "text"

const HOVER_OPEN_DELAY = 250
const HOVER_CLOSE_DELAY = 200

/**
 * Copy, beside Export (#383). A click copies Markdown at once. Hovering the
 * control, or the attached chevron (click, Enter or Space; touch), reveals the
 * format choice: Markdown or plain text.
 *
 * A popover rather than a menu: a menu always takes focus when it opens, and a
 * hover mustn't pull focus out of the editor. Opened from the chevron, focus
 * moves into the choices and returns to the chevron, as a menu's would.
 */
export function CopyButton({ onCopy }: { onCopy: (format: CopyFormat) => void }) {
  const [open, setOpen] = useState(false)
  /** Opened by hovering: leave focus where it is, both on open and on close. */
  const [byHover, setByHover] = useState(false)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearTimers() {
    if (openTimer.current) clearTimeout(openTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
    openTimer.current = null
    closeTimer.current = null
  }

  useEffect(() => clearTimers, [])

  // Mouse only: touch and pen use the chevron, so a tap never opens it by surprise.
  function hoverEnter(event: React.PointerEvent) {
    if (event.pointerType !== "mouse") return
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
    if (open || openTimer.current) return
    openTimer.current = setTimeout(() => {
      openTimer.current = null
      setByHover(true)
      setOpen(true)
    }, HOVER_OPEN_DELAY)
  }

  function hoverLeave(event: React.PointerEvent) {
    if (event.pointerType !== "mouse") return
    if (openTimer.current) clearTimeout(openTimer.current)
    openTimer.current = null
    // Only a hover-opened chooser closes when the pointer leaves.
    if (!byHover) return
    closeTimer.current = setTimeout(() => { closeTimer.current = null; setOpen(false) }, HOVER_CLOSE_DELAY)
  }

  function choose(format: CopyFormat) {
    clearTimers()
    setOpen(false)
    onCopy(format)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        clearTimers()
        // A press on the chevron while hover-opened keeps it open, now as a click-opened chooser.
        if (!next && byHover && details.reason === "trigger-press") {
          setByHover(false)
          return
        }
        if (next) setByHover(false)
        setOpen(next)
      }}
    >
      <div
        className="flex h-7 items-stretch"
        role="group"
        aria-label="Copy"
        onPointerEnter={hoverEnter}
        onPointerLeave={hoverLeave}
      >
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 rounded-r-none border-r-0 text-xs"
          onClick={() => choose("markdown")}
        >
          <Copy className="size-3" aria-hidden="true" />
          Copy
          <span className="sr-only">as Markdown</span>
        </Button>
        <PopoverTrigger
          aria-label="Choose a copy format"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 w-6 rounded-l-none px-0 text-muted-foreground")}
        >
          <ChevronDown className="size-3" aria-hidden="true" />
        </PopoverTrigger>
      </div>
      <PopoverContent
        align="end"
        className="w-40 gap-0 p-1"
        initialFocus={!byHover}
        finalFocus={!byHover}
        onPointerEnter={hoverEnter}
        onPointerLeave={hoverLeave}
      >
        <CopyChoice onClick={() => choose("markdown")}>Copy Markdown</CopyChoice>
        <CopyChoice onClick={() => choose("text")}>Copy plain text</CopyChoice>
      </PopoverContent>
    </Popover>
  )
}

function CopyChoice({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  )
}
