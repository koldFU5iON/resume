"use client"

import { useEffect, useState } from "react"
import { PanelRight, Search } from "lucide-react"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CommandPalette } from "./command-palette"

type CommandBarProps = {
  chatOpen: boolean
  onToggleChat: () => void
}

export function CommandBar({ chatOpen, onToggleChat }: CommandBarProps) {
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-5" />

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="flex h-8 w-full max-w-sm items-center gap-2 rounded-lg border border-input bg-muted/40 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">Search or jump to…</span>
        <kbd className="ml-auto hidden shrink-0 items-center gap-0.5 rounded border bg-background px-1.5 font-mono text-[10px] font-medium sm:inline-flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleChat}
        aria-pressed={chatOpen}
        aria-label="Toggle assistant"
        className={cn("ml-auto", chatOpen && "bg-accent text-accent-foreground")}
      >
        <PanelRight />
      </Button>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </header>
  )
}
