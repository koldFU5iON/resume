"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, Copy } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export type CopyFormat = "markdown" | "text"

const HOVER_OPEN_DELAY = 250
const HOVER_CLOSE_DELAY = 200

/**
 * Copy, beside Export (#383). A click copies Markdown at once. Hovering the
 * control, or the attached chevron (click, Enter or Space; touch), reveals the
 * format choice: Markdown or plain text.
 */
export function CopyButton({ onCopy }: { onCopy: (format: CopyFormat) => void }) {
  const [open, setOpen] = useState(false)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearTimers() {
    if (openTimer.current) clearTimeout(openTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
    openTimer.current = null
    closeTimer.current = null
  }

  useEffect(() => clearTimers, [])

  // Mouse only: touch and pen use the chevron, so a tap never opens a menu by surprise.
  function hoverEnter(event: React.PointerEvent) {
    if (event.pointerType !== "mouse") return
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
    if (!open && !openTimer.current) openTimer.current = setTimeout(() => { openTimer.current = null; setOpen(true) }, HOVER_OPEN_DELAY)
  }

  function hoverLeave(event: React.PointerEvent) {
    if (event.pointerType !== "mouse") return
    if (openTimer.current) clearTimeout(openTimer.current)
    openTimer.current = null
    closeTimer.current = setTimeout(() => { closeTimer.current = null; setOpen(false) }, HOVER_CLOSE_DELAY)
  }

  function choose(format: CopyFormat) {
    clearTimers()
    setOpen(false)
    onCopy(format)
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={next => { clearTimers(); setOpen(next) }}
      modal={false}
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
          title="Copy as Markdown"
        >
          <Copy className="size-3" aria-hidden="true" />
          Copy
          <span className="sr-only">as Markdown</span>
        </Button>
        <DropdownMenuTrigger
          aria-label="Choose a copy format"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 w-6 rounded-l-none px-0 text-muted-foreground")}
        >
          <ChevronDown className="size-3" aria-hidden="true" />
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent
        align="end"
        className="w-40"
        onPointerEnter={hoverEnter}
        onPointerLeave={hoverLeave}
      >
        <DropdownMenuItem onClick={() => choose("markdown")}>Copy Markdown</DropdownMenuItem>
        <DropdownMenuItem onClick={() => choose("text")}>Copy plain text</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
