"use client"

import { useRef, useState } from "react"
import { ChevronsUpDown, FileText } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { WritingDeskSourceOption } from "@/modules/writing-desk/queries"

import { matchSourceLabel as matchLabel, SOURCE_ID_SEPARATOR as ID_SEPARATOR } from "@/modules/writing-desk/source-search"

/**
 * "Replace with a CV…" as a searchable picker (#383). Choosing a CV hands its
 * id to `onChoose`, which keeps the existing confirmation and the server's
 * ownership check; this only replaces the native select.
 */
export function ReplaceWithCvPicker({ sources, onChoose }: {
  sources: WritingDeskSourceOption[]
  onChoose: (cvId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Replace this document with a CV"
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 max-w-52 justify-between gap-1.5 text-xs font-normal")}
      >
        <span className="truncate">Replace with a CV…</span>
        <ChevronsUpDown className="size-3 text-muted-foreground" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" initialFocus={searchRef} className="w-72 gap-0 p-0">
        <Command filter={matchLabel}>
          <CommandInput ref={searchRef} placeholder="Search your CVs…" aria-label="Search your CVs" />
          <CommandList className="max-h-64">
            <CommandEmpty>{sources.length === 0 ? "You don't have any CVs yet." : "No CV matches that."}</CommandEmpty>
            {sources.length > 0 && (
              <CommandGroup heading="Replace this document's text with">
                {sources.map(source => (
                  <CommandItem
                    key={source.id}
                    value={`${source.label}${ID_SEPARATOR}${source.id}`}
                    onSelect={() => {
                      setOpen(false)
                      onChoose(source.id)
                    }}
                  >
                    <FileText aria-hidden="true" />
                    <span className="flex-1 truncate">{source.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
