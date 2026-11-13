'use client'

import { useState, useMemo } from 'react'
import type { CompanyWatch } from '@prisma/client'
import { ChevronDown, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { AddCompanySheet } from './add-company-sheet'
import { CompanyWatchRow } from './company-watch-row'

type Filter = 'all' | 'working' | 'failed'

const PAGE_SIZE = 15

function isWorking(w: CompanyWatch) {
  return w.status === 'active' && !w.lastScanError
}
function isFailed(w: CompanyWatch) {
  return w.status !== 'active' || !!w.lastScanError
}

export function Watchlist({
  watches,
  defaultLocations = [],
  defaultRemote = true,
}: {
  watches: CompanyWatch[]
  defaultLocations?: string[]
  defaultRemote?: boolean
}) {
  const [open, setOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(1)

  const working = watches.filter(isWorking).length
  const failed = watches.length - working

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return watches.filter((w) => {
      if (q && !w.name.toLowerCase().includes(q)) return false
      if (filter === 'working') return isWorking(w)
      if (filter === 'failed') return isFailed(w)
      return true
    })
  }, [watches, search, filter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const healthy = filter === 'all' ? paged.filter(isWorking) : []
  const needsAttention = filter === 'all' ? paged.filter(isFailed) : paged

  function handleFilterChange(f: Filter) {
    setFilter(f)
    setPage(1)
  }
  function handleSearch(v: string) {
    setSearch(v)
    setPage(1)
  }

  return (
    <section>
      <div className="w-full flex items-center gap-2 mb-3">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 flex-1 min-w-0 text-left"
          aria-expanded={open}
          aria-controls="watchlist-body"
        >
          <h2 className="text-sm font-semibold whitespace-nowrap">Watched Companies</h2>
          <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform duration-200 shrink-0", !open && "-rotate-90")} />
          <span className="basis-full text-xs tabular-nums text-muted-foreground">
            {watches.length}
            {working > 0 && <> · {working} working</>}
            {failed > 0 && <> · <span className="text-destructive">{failed} failed</span></>}
          </span>
        </button>
        <AddCompanySheet defaultLocations={defaultLocations} defaultRemote={defaultRemote} />
      </div>

      {open && (
        <div id="watchlist-body">
          {watches.length > 0 && (
            <div className="mb-3 space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search companies…"
                  aria-label="Search watched companies"
                  className="h-8 pl-8 text-sm"
                />
              </div>
              <div className="flex gap-1">
                {(['all', 'working', 'failed'] as Filter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => handleFilterChange(f)}
                    aria-pressed={filter === f}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize ${
                      filter === f
                        ? 'bg-foreground text-background border-foreground'
                        : 'text-muted-foreground border-border hover:border-foreground/40'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          )}

          {watches.length === 0 && (
            <p className="text-xs text-muted-foreground">No companies watched yet</p>
          )}

          {filtered.length === 0 && watches.length > 0 && (
            <p className="text-xs text-muted-foreground py-4 text-center">No companies match this filter</p>
          )}

          {filter === 'all' ? (
            <>
              {healthy.length > 0 && (
                <div className="divide-y rounded-lg border">
                  {healthy.map((w) => <CompanyWatchRow key={w.id} watch={w} />)}
                </div>
              )}
              {needsAttention.length > 0 && (
                <div className={healthy.length > 0 ? 'mt-5' : undefined}>
                  {healthy.length > 0 && (
                    <p className="text-xs font-medium text-muted-foreground mb-2">Needs attention</p>
                  )}
                  <div className="divide-y rounded-lg border">
                    {needsAttention.map((w) => <CompanyWatchRow key={w.id} watch={w} />)}
                  </div>
                </div>
              )}
            </>
          ) : paged.length > 0 && (
            <div className="divide-y rounded-lg border">
              {paged.map((w) => <CompanyWatchRow key={w.id} watch={w} />)}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-3">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                aria-label="Previous page"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
              >
                <ChevronLeft className="size-3" />
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">{safePage} / {totalPages}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                aria-label="Next page"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
              >
                <ChevronRight className="size-3" />
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
