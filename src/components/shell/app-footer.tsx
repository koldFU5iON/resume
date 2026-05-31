"use client"

import { useState } from "react"
import Link from "next/link"
import { MessageSquareWarning, Settings } from "lucide-react"

import { APP_VERSION } from "@/lib/version"
import { FeedbackDrawer } from "@/app/components/FeedbackDrawer"

export function AppFooter() {
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  return (
    <footer className="flex h-9 shrink-0 items-center justify-between gap-4 border-t bg-background px-3 text-xs text-muted-foreground">
      {/* Status / context — static for now; wire to LLM ping / search context later. */}
      <div className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
        <span>Ready</span>
      </div>

      <div className="flex items-center gap-4">
        <Link
          href="/dashboard/settings"
          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
        >
          <Settings className="size-3.5" />
          <span className="hidden sm:inline">Settings</span>
        </Link>
        <button
          type="button"
          onClick={() => setFeedbackOpen(true)}
          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
        >
          <MessageSquareWarning className="size-3.5" />
          <span className="hidden sm:inline">Report an issue</span>
        </button>
        <span className="font-mono tabular-nums">v{APP_VERSION}</span>
      </div>

      <FeedbackDrawer open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </footer>
  )
}
