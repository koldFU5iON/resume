"use client"

import { AlertTriangle, Check, Loader2 } from "lucide-react"
import type { SaveState } from "./use-document-save"

/** The save indicator every document editor shows: unsaved, saving, saved, failed (retry), or in conflict (resolve). */
export function SaveStatus({ state, onRetry, onResolve }: { state: SaveState; onRetry: () => void; onResolve: () => void }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-7 items-center gap-1.5 text-xs">
      {state === "dirty" && <span className="text-muted-foreground">Unsaved changes</span>}
      {state === "saving" && <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="size-3 animate-spin" aria-hidden="true" />Saving…</span>}
      {state === "saved" && <span className="flex items-center gap-1 text-muted-foreground"><Check className="size-3" aria-hidden="true" />Saved</span>}
      {state === "failed" && <>
        <span className="flex items-center gap-1 text-destructive" title="Your edits are kept on this device until they save"><AlertTriangle className="size-3" aria-hidden="true" />Couldn&apos;t save</span>
        <button type="button" onClick={onRetry} className="text-muted-foreground underline underline-offset-2 hover:text-foreground">Retry</button>
      </>}
      {state === "conflict" && <>
        <span className="flex items-center gap-1 text-destructive"><AlertTriangle className="size-3" aria-hidden="true" />Changed elsewhere</span>
        <button type="button" onClick={onResolve} className="text-muted-foreground underline underline-offset-2 hover:text-foreground">Resolve…</button>
      </>}
    </div>
  )
}
