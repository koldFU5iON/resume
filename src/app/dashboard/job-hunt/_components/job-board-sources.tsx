'use client'

import { useState } from 'react'
import type { JobBoardSource, ManualJobBoard } from '@prisma/client'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BoardSourceRow } from './board-source-row'
import { ManualBoardsSection } from './manual-boards-section'

const PROVIDER_GROUPS = [
  { label: 'Free', providers: ['remotive', 'remoteok', 'adzuna'] },
  { label: 'Paid — bring your own key', providers: ['jsearch'] },
]

type Props = {
  sources: JobBoardSource[]
  availableProviders: Set<string>
  manualBoards: ManualJobBoard[]
}

export function JobBoardSources({ sources, availableProviders, manualBoards }: Props) {
  const [open, setOpen] = useState(true)
  const byProvider = Object.fromEntries(sources.map((s) => [s.provider, s]))
  const active = sources.filter(s => !s.lastScanError).length
  const failed = sources.length - active

  return (
    <section>
      <div className="w-full flex items-center gap-2 mb-3">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 flex-1 min-w-0 text-left"
          aria-expanded={open}
          aria-controls="job-boards-body"
        >
          <h2 className="text-sm font-semibold whitespace-nowrap">Job Board Sources</h2>
          <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform duration-200 shrink-0", !open && "-rotate-90")} />
          <span className="basis-full text-xs tabular-nums text-muted-foreground">
            {sources.length}
            {active > 0 && <> · {active} working</>}
            {failed > 0 && <> · <span className="text-destructive">{failed} failed</span></>}
          </span>
        </button>
      </div>

      {open && (
        <div id="job-boards-body" className="space-y-5">
          {PROVIDER_GROUPS.map(({ label, providers }) => {
            const rows = providers.flatMap((p) => (byProvider[p] ? [byProvider[p]] : []))
            if (rows.length === 0) return null
            return (
              <div key={label}>
                <p className="mb-2 text-xs font-medium text-muted-foreground">{label}</p>
                <div className="divide-y rounded-lg border">
                  {rows.map((source) => (
                    <BoardSourceRow
                      key={source.provider}
                      source={source}
                      isAdapterAvailable={availableProviders.has(source.provider)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
          <ManualBoardsSection boards={manualBoards} />
        </div>
      )}
    </section>
  )
}
