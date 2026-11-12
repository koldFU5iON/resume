"use client"

import { useState } from "react"
import { Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

/**
 * The document changed elsewhere (another tab, device, or an accepted agent
 * draft) after this editor loaded it, so the save was refused (#371), or a
 * draft was accepted while edits here hadn't saved yet (#378). Shows both
 * versions, each copyable, and lets the user pick which one continues.
 * Nothing is overwritten until they choose.
 */
export function SaveConflictDialog({
  open,
  reason = "elsewhere",
  onOpenChange,
  mine,
  saved,
  onKeepMine,
  onUseSaved,
  onCopy,
}: {
  open: boolean
  /** "accepted": the saved version is a draft just accepted from the Coach or the review. */
  reason?: "elsewhere" | "accepted"
  onOpenChange: (open: boolean) => void
  mine: string
  saved: string
  onKeepMine: () => Promise<void>
  onUseSaved: () => void
  onCopy: (value: string, label: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const accepted = reason === "accepted"
  const savedLabel = accepted ? "Accepted draft (saved)" : "Saved version"

  async function keepMine() {
    setBusy(true)
    try { await onKeepMine() } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next) }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{accepted ? "You have edits that aren't saved" : "This document changed elsewhere"}</DialogTitle>
          <DialogDescription>
            {accepted
              ? "The draft you accepted is now the saved version, but your latest edits here hadn't saved yet. They're kept. Choose which version to keep."
              : "Your edits weren't saved because a newer version was saved somewhere else. Choose which version to keep."}{" "}
            Copy the other first if you want to merge by hand.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-3 md:grid-cols-2">
          <VersionPane title="Your version (unsaved)" value={mine} onCopy={() => onCopy(mine, "Your version")} />
          <VersionPane title={savedLabel} value={saved} onCopy={() => onCopy(saved, savedLabel)} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Decide later</Button>
          <Button type="button" variant="outline" onClick={onUseSaved} disabled={busy}>{accepted ? "Use accepted draft" : "Use saved version"}</Button>
          <Button type="button" onClick={() => void keepMine()} disabled={busy}>{busy ? "Saving…" : "Keep my version"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function VersionPane({ title, value, onCopy }: { title: string; value: string; onCopy: () => void }) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={onCopy}>
          <Copy className="size-3.5" aria-hidden="true" />Copy
        </Button>
      </div>
      <textarea
        readOnly
        value={value}
        aria-label={title}
        className="h-48 w-full resize-none rounded-md border bg-muted/40 p-2 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-72"
      />
    </section>
  )
}
