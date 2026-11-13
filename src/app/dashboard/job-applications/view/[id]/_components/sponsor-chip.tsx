'use client'

import { BadgeCheck } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { SponsorStatus } from "@/modules/companies/queries"

/**
 * "Licensed sponsor" chip from the UK register. Shown only for a match: a
 * "not listed" result is left out because a name match can't prove absence
 * (the register may use a different legal name).
 */
export function SponsorChip({ sponsor }: { sponsor: SponsorStatus | null }) {
  if (!sponsor || (sponsor.result !== 'licensed' && sponsor.result !== 'licensed_other_route')) return null

  const licensed = sponsor.result === 'licensed'
  const bRated = licensed && sponsor.rating === 'B'
  const label = licensed
    ? `Licensed sponsor${sponsor.rating === 'A' || sponsor.rating === 'B' ? ` · ${sponsor.rating}` : ''}`
    : 'Sponsor licence · other routes'
  const more = sponsor.totalEntries - sponsor.entries.length

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${label}: register details`}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-muted",
          bRated
            ? "border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400"
            : licensed
              ? "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400"
              : "text-muted-foreground",
        )}
      >
        <BadgeCheck size={11} />
        {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 text-xs">
        <p className="font-medium">UK register of licensed sponsors</p>
        <p className="text-muted-foreground">
          Matched by company name
          {sponsor.registerAsOf && ` (register as of ${new Date(sponsor.registerAsOf).toLocaleDateString()})`}.
          Check the entry is this employer: similar names can belong to different businesses.
        </p>
        <ul className="space-y-1">
          {sponsor.entries.map((e) => (
            <li key={`${e.orgName}|${e.townCity}|${e.route}`} className="rounded border px-2 py-1">
              <span className="font-medium">{e.orgName}</span>
              {e.townCity && <span className="text-muted-foreground"> · {e.townCity}</span>}
              <div className="text-muted-foreground">{e.route} · {e.typeRating}</div>
            </li>
          ))}
        </ul>
        {more > 0 && <p className="text-muted-foreground">+{more} more {more === 1 ? 'entry' : 'entries'}</p>}
        {bRated && <p className="text-amber-700 dark:text-amber-400">B-rated: the sponsor is on an action plan with the Home Office.</p>}
        {!licensed && <p className="text-muted-foreground">No Skilled Worker licence in the register.</p>}
        <p className="text-muted-foreground">A licence doesn&apos;t mean this role will be sponsored.</p>
      </PopoverContent>
    </Popover>
  )
}
