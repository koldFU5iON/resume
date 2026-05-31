"use client"

import { Sparkles, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type ChatPanelProps = {
  open: boolean
  onClose: () => void
}

export function ChatPanel({ open, onClose }: ChatPanelProps) {
  if (!open) return null

  return (
    <aside
      className={cn(
        // Full-height docked panel on md+, slide-over overlay on small screens.
        "flex h-full w-full flex-col border-l bg-background",
        "fixed inset-y-0 right-0 z-40 max-w-sm shadow-lg md:static md:z-auto md:w-80 md:max-w-none md:shadow-none lg:w-96"
      )}
      aria-label="Assistant"
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-muted-foreground" />
          Assistant
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close assistant"
        >
          <X />
        </Button>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted">
          <Sparkles className="size-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">Assistant coming soon</p>
        <p className="max-w-[14rem] text-xs text-muted-foreground">
          Ask questions and update your knowledge base right from here.
        </p>
      </div>
    </aside>
  )
}
