"use client"

import { useState } from "react"
import { Copy, Plus, Search } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { BLOCK_LIST } from "@/modules/writing-desk/blocks/registry"
import type { BlockDefinition } from "@/modules/writing-desk/blocks/types"

function profileLabel(definition: BlockDefinition): string {
  return Object.keys(definition.pdf)
    .map(profile => profile === "cv" ? "CV" : "General")
    .join(" · ")
}

export function AvailableBlocks({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInsert: (snippet: string) => void
}) {
  const [query, setQuery] = useState("")
  const normalized = query.trim().toLowerCase()
  const blocks = BLOCK_LIST.filter(definition =>
    !normalized ||
    definition.label.toLowerCase().includes(normalized) ||
    definition.description.toLowerCase().includes(normalized) ||
    definition.id.includes(normalized),
  )

  async function copySnippet(definition: BlockDefinition) {
    try {
      await navigator.clipboard.writeText(definition.example)
      toast.success(`${definition.label} snippet copied`)
    } catch {
      toast.error("Could not copy to the clipboard")
    }
  }

  function insertSnippet(definition: BlockDefinition) {
    onInsert(definition.example)
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Available blocks</SheetTitle>
          <SheetDescription>
            Optional Markdown blocks for structured, predictable formatting. Ordinary Markdown still works everywhere.
          </SheetDescription>
        </SheetHeader>
        <div className="relative px-4">
          <Search className="pointer-events-none absolute left-7 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search blocks"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search blocks..."
            className="pl-8"
          />
        </div>
        <div className="flex flex-col gap-3 px-4 pb-6">
          {blocks.map(definition => (
            <article key={definition.id} className="rounded-lg border p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="text-sm font-semibold">{definition.label}</h3>
                    <Badge variant="secondary">{definition.category}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{definition.description}</p>
                </div>
              </div>
              <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-2.5 font-mono text-[11px] leading-relaxed text-foreground"><code>{definition.example}</code></pre>
              <dl className="mt-2.5 grid gap-1 text-[11px] text-muted-foreground">
                <div><dt className="inline font-medium text-foreground">Profiles: </dt><dd className="inline">{profileLabel(definition)}</dd></div>
                <div><dt className="inline font-medium text-foreground">ATS: </dt><dd className="inline">{definition.ats.safe ? "Safe" : "Check profile fallback"}{definition.ats.note ? ` — ${definition.ats.note}` : ""}</dd></div>
              </dl>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => insertSnippet(definition)}>
                  <Plus className="mr-1 size-3" />Insert
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void copySnippet(definition)}>
                  <Copy className="mr-1 size-3" />Copy
                </Button>
              </div>
            </article>
          ))}
          {blocks.length === 0 ? <p className="text-sm text-muted-foreground">No blocks match “{query}”.</p> : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
