"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronDown, Library, Sparkles, type LucideIcon } from "lucide-react"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { JobDocumentCreateLink, JobDocumentKind, JobDocumentLink } from "@/modules/jobs/workspace-nav"
import { guardedNavigate } from "./navigation-guard"

/** Where the switcher can take you: the nav's links plus Deep Dive. */
export type SwitcherEntry = Pick<JobDocumentLink, "key" | "label" | "detail" | "href"> & { kind: JobDocumentKind | "deep-dive" }

const LEGACY_EDITOR: Record<JobDocumentCreateLink["kind"], string> = {
  cv: "CV Builder",
  "cover-letter": "Cover Letters",
  "interview-prep": "Interview Prep",
}

/**
 * Searchable list of every destination in the job (#371). On phones it is
 * the document selector, its trigger naming the open document; on wider
 * screens it is the "All documents" overflow beside the tabs, so documents
 * stay reachable however many there are or however long their names. It
 * also keeps the legacy editors' creation flows reachable, clearly labelled
 * as separate editors, so "+" can be only the new-document dialog.
 */
export function DocumentSwitcher({
  variant,
  entries,
  activeKey,
  legacyCreateLinks,
  icons,
  className,
}: {
  variant: "selector" | "overflow"
  entries: SwitcherEntry[]
  activeKey: string | null
  legacyCreateLinks: JobDocumentCreateLink[]
  icons: Record<JobDocumentKind, LucideIcon>
  className?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const active = entries.find(entry => entry.key === activeKey) ?? null
  const documentCount = entries.filter(entry => entry.kind !== "description" && entry.kind !== "deep-dive").length

  function go(href: string) {
    setOpen(false)
    void guardedNavigate(() => router.push(href))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {variant === "selector" ? (
        <PopoverTrigger
          aria-label={`Current document: ${active ? active.label : "none"}. Switch document`}
          className={cn(
            "flex h-9 min-w-0 items-center gap-2 rounded-lg border border-input bg-background px-2.5 text-left text-sm font-medium outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
            className,
          )}
        >
          <span className="min-w-0 flex-1 truncate">{active ? active.label : "Choose a document"}</span>
          {active?.detail && <span className="shrink-0 text-xs font-normal text-muted-foreground">{active.detail}</span>}
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </PopoverTrigger>
      ) : (
        <PopoverTrigger
          aria-label={`All documents (${documentCount})`}
          title="All documents"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 shrink-0 gap-1.5 px-2 text-muted-foreground", className)}
        >
          <Library aria-hidden="true" />
          <span className="tabular-nums">{documentCount}</span>
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </PopoverTrigger>
      )}
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-1.5rem))] p-0">
        <Command loop>
          <CommandInput placeholder="Find a document…" aria-label="Find a document" />
          <CommandList className="max-h-[min(24rem,60vh)]">
            <CommandEmpty>No matching documents.</CommandEmpty>
            <CommandGroup heading="This job">
              {entries.map(entry => {
                const Icon = entry.kind === "deep-dive" ? Sparkles : icons[entry.kind]
                const current = entry.key === activeKey
                return (
                  <CommandItem
                    key={entry.key}
                    value={entry.key}
                    keywords={[entry.label, entry.detail ?? ""]}
                    onSelect={() => go(entry.href)}
                    aria-current={current ? "page" : undefined}
                    title={entry.detail ? `${entry.label} · ${entry.detail}` : entry.label}
                    className="py-2"
                  >
                    <Icon aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                    {entry.detail && <span className="shrink-0 text-xs text-muted-foreground">{entry.detail}</span>}
                    <Check className={cn("size-4 shrink-0", current ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {legacyCreateLinks.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Older editors (not Writing Desk documents)">
                  {legacyCreateLinks.map(link => {
                    const Icon = icons[link.kind]
                    return (
                      <CommandItem
                        key={link.kind}
                        value={`legacy:${link.kind}`}
                        keywords={[link.label, LEGACY_EDITOR[link.kind]]}
                        onSelect={() => go(link.href)}
                        className="py-2"
                      >
                        <Icon aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">{link.label}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{LEGACY_EDITOR[link.kind]}</span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
