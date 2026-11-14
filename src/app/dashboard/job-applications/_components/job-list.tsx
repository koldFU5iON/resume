'use client'

import { useRouter, useSearchParams } from "next/navigation"
import { createPortal } from "react-dom"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Archive, ArrowDown, ArrowUp, ListPlus, Plus, SearchIcon, X } from "lucide-react"
import {
  APPLICATION_STATUS_LABEL,
  ApplicationStatus,
  ClosedStatuses,
  type ApplicationStatusType,
  type Job,
  type JobFit,
} from "@/app/types/job-application"
import {
  FilterBar,
  MobileListControls,
  DEFAULT_FILTER,
  DEFAULT_SORT,
  isFilterActive,
  normaliseSort,
  type FilterState,
  type SortState,
} from './filter-bar'
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"
import { JobGroup } from "./job-group"
import { JOB_LIST_COLUMNS } from "./job-list-layout"
import { EditJobDialog } from "./edit-job-dialog"
import { AddJobDialog } from "./add-job-dialog"
import { BatchCaptureDialog } from "./batch-capture-dialog"
import { archiveJobApplication, bulkArchiveJobApplications, bulkRestoreJobApplications } from "@/modules/jobs/mutations"
import { visibleJobIds } from "./list-selection"
import { AssessmentPoller } from "./assessment-poller"
import { DeepDiveAccessProvider } from "./deep-dive-button"
import { deepDiveSignature } from "./deep-dive-view"
import type { DeepDiveAccess } from "@/modules/deep-dive/access"
import { earlyFilterKey, earlySortValue, parseEarlyFilter, pendingSignature } from "./early-assessment-view"

type ViewMode = 'grouped' | 'all'
const VIEW_MODE_KEY = 'jobs-view-mode'
const FILTER_KEY = 'jobs-filter'
const SORT_KEY = 'jobs-sort'
const COLLAPSE_KEY = 'jobs-group-collapsed'
const QUERY_KEY = 'jobs-query'

// Priority order for open work — interviews top (most time-pressing), then
// active prep work, then sent-and-waiting, then untouched leads.
const OPEN_PRIORITY: ApplicationStatusType[] = [
  ApplicationStatus.Interviewing,
  ApplicationStatus.InProgress,
  ApplicationStatus.Applied,
  ApplicationStatus.NotStarted,
]

const CLOSED_SET: ReadonlySet<string> = new Set(ClosedStatuses)

export function JobList({ jobs, hasLLMKey, deepDiveAccess, earlyEnabled = false }: {
  jobs: Job[]
  hasLLMKey: boolean
  /** The user's deep dive access (server-computed): enables the Deep dive action in rows. */
  deepDiveAccess?: DeepDiveAccess
  /** Early assessment on for this user (decided on the server). */
  earlyEnabled?: boolean
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [viewMode, setViewMode] = useState<ViewMode>('grouped')
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER)
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const archiving = useRef(new Set<string>())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<Job | null>(null)
  const [creating, setCreating] = useState(false)
  const [createUrl, setCreateUrl] = useState('')
  const [batching, setBatching] = useState(false)
  // Per-row in-flight label so the user sees "Archiving…" the instant they click,
  // not after the server roundtrip + revalidate finishes.
  const [busyRows, setBusyRows] = useState<Map<string, string>>(new Map())

  // Stable ref so the keydown handler always sees the latest archive callback
  // without re-attaching the listener on every selection change.
  const bulkArchiveRef = useRef<(() => Promise<void>) | null>(null)

  // Every manual-add entry point opens the form this way; no URL clears an earlier prefill.
  const openCreate = useCallback((url = '') => {
    setCreateUrl(url)
    setCreating(true)
  }, [setCreating, setCreateUrl])

  // Deep link `?create=1[&url=…]` (dashboard, command palette, /create redirect,
  // quick-capture fallback). Consume only those two params so reload and Back
  // don't reopen the form and the same link works again. An open draft wins
  // over a new prefill.
  const searchParams = useSearchParams()
  const deepLinkCreate = searchParams.get('create') === '1'
  const deepLinkUrl = searchParams.get('url') ?? ''
  useEffect(() => {
    if (!deepLinkCreate) return
    if (!creating) openCreate(deepLinkUrl) // eslint-disable-line react-hooks/set-state-in-effect
    const next = new URL(window.location.href)
    next.searchParams.delete('create')
    next.searchParams.delete('url')
    // Next syncs replaceState with useSearchParams, so this effect re-runs once with no deep link.
    window.history.replaceState(null, '', next.href)
  }, [deepLinkCreate, deepLinkUrl, creating, openCreate])

  // ⌘J / Ctrl+J — open the Add Job form. E — archive selection (guards against input focus).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.repeat) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return
      if (e.metaKey || e.ctrlKey) {
        if (e.key.toLowerCase() === 'j') {
          e.preventDefault()
          openCreate()
        }
        return
      }
      const tag = (e.target as HTMLElement).tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement).isContentEditable) return
      if (e.key.toLowerCase() === 'e' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        bulkArchiveRef.current?.()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [openCreate])

  // Hydrate view-mode preference once on mount. Doing this in an effect (rather
  // than as a lazy initial state) avoids an SSR/CSR hydration mismatch — server
  // renders with the default, client re-applies the saved preference.
  useEffect(() => {
    const saved = window.localStorage.getItem(VIEW_MODE_KEY)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === 'all' || saved === 'grouped') setViewMode(saved)

    try {
      setQuery(window.sessionStorage.getItem(QUERY_KEY) ?? '')
      const map: unknown = JSON.parse(window.localStorage.getItem(COLLAPSE_KEY) ?? '{}')
      if (map && typeof map === 'object' && !Array.isArray(map)) {
        setCollapsedGroups(Object.fromEntries(Object.entries(map).filter(([, value]) => typeof value === 'boolean')))
      }
    } catch { /* preferences are optional */ }

    try {
      const savedFilter = window.localStorage.getItem(FILTER_KEY)
      if (savedFilter) {
        const p = JSON.parse(savedFilter)
        setFilter({
          status: new Set(p.status ?? []),
          source: new Set(p.source ?? []),
          // Only the current model's fit filter is kept, so a hidden one can't stay active.
          fit: earlyEnabled ? new Set() : new Set(p.fit ?? []),
          early: earlyEnabled ? parseEarlyFilter(p.early) : new Set(),
        })
      }
    } catch { /* ignore malformed filter cache */ }

    try {
      const savedSort = window.localStorage.getItem(SORT_KEY)
      if (savedSort) {
        const p = JSON.parse(savedSort)
        // "Fit score" follows whichever assessment is current for this user.
        if (p.field && p.direction) setSort(normaliseSort(p, earlyEnabled))
      }
    } catch { /* ignore malformed sort cache */ }
  }, [earlyEnabled])

  function changeViewMode(next: ViewMode) {
    clearSelection()
    setViewMode(next)
    window.localStorage.setItem(VIEW_MODE_KEY, next)
  }

  function changeFilter(next: FilterState) {
    setSelected(new Set())
    setFilter(next)
    window.localStorage.setItem(FILTER_KEY, JSON.stringify({
      status: [...next.status],
      source: [...next.source],
      fit: [...next.fit],
      early: [...next.early],
    }))
  }

  function changeQuery(next: string) {
    clearSelection()
    setQuery(next)
    window.sessionStorage.setItem(QUERY_KEY, next)
  }

  function toggleGroup(key: string, current: boolean) {
    clearSelection()
    const next = { ...collapsedGroups, [key]: !current }
    setCollapsedGroups(next)
    window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next))
  }

  function changeSort(next: SortState) {
    setSort(next)
    window.localStorage.setItem(SORT_KEY, JSON.stringify(next))
  }

  const filteredJobs = useMemo(() => {
    const q = query.trim().toLowerCase()

    let result = q
      ? jobs.filter(j =>
          j.title.toLowerCase().includes(q) ||
          (j.company ?? '').toLowerCase().includes(q) ||
          j.countries.join(' ').toLowerCase().includes(q) ||
          (j.notes ?? '').toLowerCase().includes(q) ||
          APPLICATION_STATUS_LABEL[j.status].toLowerCase().includes(q)
        )
      : [...jobs]

    if (filter.status.size > 0) {
      result = result.filter(j => filter.status.has(j.status))
    }
    if (filter.source.size > 0) {
      result = result.filter(j => filter.source.has(j.applicationSource))
    }
    // The deprecated JobFit filter applies only while the early assessment is off.
    if (!earlyEnabled && filter.fit.size > 0) {
      result = result.filter(j => {
        const label = j.jobFit?.label ?? 'none'
        return filter.fit.has(label as JobFit['label'] | 'none')
      })
    }
    if (earlyEnabled && filter.early.size > 0) {
      result = result.filter(j => filter.early.has(earlyFilterKey(j.earlyAssessment)))
    }

    result.sort((a, b) => {
      let cmp = 0
      switch (sort.field) {
        case 'dateApplied': {
          const aVal = a.dateApplied?.getTime()
          const bVal = b.dateApplied?.getTime()
          if (aVal == null && bVal == null) { cmp = 0; break }
          if (aVal == null) { return 1 }   // nulls always last
          if (bVal == null) { return -1 }
          cmp = aVal - bVal
          break
        }
        case 'datePublished': {
          const aVal = a.datePublished?.getTime()
          const bVal = b.datePublished?.getTime()
          if (aVal == null && bVal == null) { cmp = 0; break }
          if (aVal == null) { return 1 }
          if (bVal == null) { return -1 }
          cmp = aVal - bVal
          break
        }
        case 'company':
          cmp = (a.company ?? '').localeCompare(b.company ?? '')
          break
        case 'fitRating':
          cmp = (a.jobFit?.rating ?? -1) - (b.jobFit?.rating ?? -1)
          break
        case 'earlyScore': {
          const aVal = earlySortValue(a.earlyAssessment)
          const bVal = earlySortValue(b.earlyAssessment)
          // Unassessed or running (-1) always last, like missing dates.
          if (aVal < 0 && bVal < 0) { cmp = 0; break }
          if (aVal < 0) { return 1 }
          if (bVal < 0) { return -1 }
          cmp = aVal - bVal
          break
        }
        case 'lastUpdated':
          cmp = a.lastUpdated.getTime() - b.lastUpdated.getTime()
          break
      }
      return sort.direction === 'asc' ? cmp : -cmp
    })

    return result
  }, [jobs, query, filter, sort, earlyEnabled])

  const pendingRuns = useMemo(
    // Early assessments and deep dives in progress: rows show both, so both keep the list refreshing.
    () => [pendingSignature(jobs.map(j => j.earlyAssessment)), ...jobs.map(j => deepDiveSignature(j.deepDive))]
      .filter(Boolean)
      .join(','),
    [jobs],
  )

  // Search auto-switches to "All" so matches aren't visually split across groups.
  // User's view-mode preference is preserved — restored when the query clears.
  const effectiveMode: ViewMode = query.trim() ? 'all' : viewMode

  const groups = useMemo(() => {
    if (effectiveMode === 'all') {
      return [{ key: 'all', label: null as string | null, jobs: filteredJobs, defaultCollapsed: false }]
    }
    const openGroups = OPEN_PRIORITY.map(s => ({
      key: s,
      label: APPLICATION_STATUS_LABEL[s] as string | null,
      jobs: filteredJobs.filter(j => j.status === s),
      defaultCollapsed: false,
    }))
    const closedJobs = filteredJobs.filter(j => CLOSED_SET.has(j.status))
    return [
      ...openGroups,
      { key: 'closed', label: 'Closed' as string | null, jobs: closedJobs, defaultCollapsed: true },
    ]
  }, [filteredJobs, effectiveMode])

  const visibleIds = visibleJobIds(groups, collapsedGroups)
  const visibleSelected = new Set([...selected].filter(id => visibleIds.has(id)))

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function clearSelection() {
    setSelected(new Set())
  }

  const isAllSelected = visibleIds.size > 0 && [...visibleIds].every(id => visibleSelected.has(id))
  const isSomeSelected = !isAllSelected && visibleSelected.size > 0

  function toggleSelectAll() {
    const allIds = [...visibleIds]
    const allSelected = allIds.every(id => selected.has(id))
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(allIds))
    }
  }

  function markBusy(ids: string[], label: string | null) {
    setBusyRows(prev => {
      const next = new Map(prev)
      for (const id of ids) {
        if (label) next.set(id, label)
        else next.delete(id)
      }
      return next
    })
  }

  function handleGenerateCV(id: string) {
    markBusy([id], 'Generating CV…')
    router.push(`/dashboard/cv-builder/new?jobId=${id}`)
  }

  function handleCreateCoverLetter(id: string) {
    router.push(`/dashboard/cover-letters/new?jobId=${id}`)
  }

  function showArchivedToast(ids: string[]) {
    toast.success(`${ids.length} ${ids.length === 1 ? 'job' : 'jobs'} archived`, {
      action: {
        label: 'Undo',
        onClick: async () => {
          try {
            const { restored } = await bulkRestoreJobApplications(ids)
            toast.success(`${restored} ${restored === 1 ? 'job' : 'jobs'} restored`)
          } catch {
            toast.error('Could not undo archive. Restore the jobs from Archived.')
          }
        },
      },
    })
  }

  async function handleSingleArchive(id: string) {
    if (archiving.current.has(id)) return
    archiving.current.add(id)
    markBusy([id], 'Archiving…')
    try {
      await archiveJobApplication(id)
      showArchivedToast([id])
      setSelected(prev => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    } catch {
      toast.error('Failed to archive')
    } finally {
      markBusy([id], null)
      archiving.current.delete(id)
    }
  }

  async function handleBulkArchive() {
    const ids = [...visibleSelected].filter(id => !archiving.current.has(id))
    if (ids.length === 0) return
    ids.forEach(id => archiving.current.add(id))
    markBusy(ids, 'Archiving…')
    try {
      await bulkArchiveJobApplications(ids)
      showArchivedToast(ids)
      clearSelection()
    } catch {
      toast.error('Failed to archive')
    } finally {
      markBusy(ids, null)
      ids.forEach(id => archiving.current.delete(id))
    }
  }

  useEffect(() => { bulkArchiveRef.current = handleBulkArchive })

  const content = (
    <div className={cn("@container w-full border-t border-accent pt-3 mt-2", visibleSelected.size > 0 && "pb-24 md:pb-0")}>
      <AssessmentPoller signature={pendingRuns} />
      <ToolBar
        query={query}
        onQueryChange={changeQuery}
        visibleCount={filteredJobs.length}
        totalCount={jobs.length}
        viewMode={viewMode}
        onViewModeChange={changeViewMode}
        selectedCount={visibleSelected.size}
        onClearSelection={clearSelection}
        onBulkArchive={handleBulkArchive}
        filter={filter}
        sort={sort}
        onFilterChange={changeFilter}
        onSortChange={changeSort}
        onCreateOpen={() => openCreate()}
        onBatchOpen={() => setBatching(true)}
        earlyEnabled={earlyEnabled}
      />
      <Separator className="my-3" />

      {filteredJobs.length > 0 ? (
        <>
          {/* Cards when the available content width cannot fit the table. */}
          <div className="@5xl:hidden border border-border/30 rounded-md overflow-hidden">
            {groups.map(g => (
              <JobGroup
                key={g.key}
                label={g.label}
                jobs={g.jobs}
                collapsed={g.label !== null && (collapsedGroups[g.key] ?? g.defaultCollapsed)}
                onToggleCollapse={() => toggleGroup(g.key, collapsedGroups[g.key] ?? g.defaultCollapsed)}
                selected={visibleSelected}
                busyRows={busyRows}
                onToggleSelect={toggleSelect}
                onEdit={setEditing}
                onArchive={handleSingleArchive}
                onGenerateCV={handleGenerateCV}
                onCreateCoverLetter={handleCreateCoverLetter}
                hasLLMKey={hasLLMKey}
                earlyEnabled={earlyEnabled}
                isMobile
              />
            ))}
          </div>

          {/* Fixed metadata columns leave the remaining width to the role. */}
          <div className={cn("hidden @5xl:grid", JOB_LIST_COLUMNS)}>
            <ColHeaders
              isAllSelected={isAllSelected}
              isSomeSelected={isSomeSelected}
              onToggleAll={toggleSelectAll}
              sort={sort}
              onSortChange={changeSort}
              fitField={earlyEnabled ? 'earlyScore' : 'fitRating'}
            />
            {groups.map(g => (
              <JobGroup
                key={g.key}
                label={g.label}
                jobs={g.jobs}
                collapsed={g.label !== null && (collapsedGroups[g.key] ?? g.defaultCollapsed)}
                onToggleCollapse={() => toggleGroup(g.key, collapsedGroups[g.key] ?? g.defaultCollapsed)}
                selected={visibleSelected}
                busyRows={busyRows}
                onToggleSelect={toggleSelect}
                onEdit={setEditing}
                onArchive={handleSingleArchive}
                onGenerateCV={handleGenerateCV}
                onCreateCoverLetter={handleCreateCoverLetter}
                hasLLMKey={hasLLMKey}
                earlyEnabled={earlyEnabled}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="text-sm text-muted-foreground py-6 text-center">
          {(query || isFilterActive(filter))
            ? "No jobs match your filters."
            : "No jobs yet. Create your first application."}
        </div>
      )}

      {editing && (
        <EditJobDialog
          job={editing}
          open={!!editing}
          onOpenChange={(o) => { if (!o) setEditing(null) }}
          hasLLMKey={hasLLMKey}
        />
      )}

      <AddJobDialog
        open={creating}
        onOpenChange={setCreating}
        initialUrl={createUrl}
      />

      <BatchCaptureDialog open={batching} onOpenChange={setBatching} />
    </div>
  )
  if (!deepDiveAccess) return content
  return <DeepDiveAccessProvider access={deepDiveAccess}>{content}</DeepDiveAccessProvider>
}

type ToolBarProps = {
  query: string
  onQueryChange: (value: string) => void
  visibleCount: number
  totalCount: number
  viewMode: ViewMode
  onViewModeChange: (m: ViewMode) => void
  selectedCount: number
  onClearSelection: () => void
  onBulkArchive: () => void
  filter: FilterState
  sort: SortState
  onFilterChange: (f: FilterState) => void
  onSortChange: (s: SortState) => void
  onCreateOpen: () => void
  onBatchOpen: () => void
  earlyEnabled: boolean
}

function ToolBar({
  query,
  onQueryChange,
  visibleCount,
  totalCount,
  viewMode,
  onViewModeChange,
  selectedCount,
  onClearSelection,
  onBulkArchive,
  filter,
  sort,
  onFilterChange,
  onSortChange,
  onCreateOpen,
  onBatchOpen,
  earlyEnabled,
}: ToolBarProps) {
  return (
    <div className="flex flex-col gap-3 md:gap-1">
      <div className="space-y-3 md:hidden">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground" role="status">{visibleCount === totalCount ? `${totalCount} ${totalCount === 1 ? 'job' : 'jobs'}` : `${visibleCount} of ${totalCount} jobs`}</span>
          <Button className="min-h-11 px-4" onClick={onCreateOpen}><Plus className="size-4" />Add Job</Button>
        </div>
        <JobSearchBar value={query} onChange={onQueryChange} />
        <MobileListControls filter={filter} sort={sort} onFilterChange={onFilterChange} onSortChange={onSortChange} earlyEnabled={earlyEnabled} viewMode={viewMode} onViewModeChange={onViewModeChange} onBatchOpen={onBatchOpen} resultCount={visibleCount} />
        {selectedCount > 0 && createPortal(
          <div role="region" aria-label="Selected job actions" className="fixed inset-x-3 bottom-[calc(3rem+env(safe-area-inset-bottom))] z-30 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-3 md:hidden">
            <span className="mr-auto text-sm" role="status">{selectedCount} selected</span>
            <Button variant="outline" className="min-h-11" onClick={onClearSelection}>Deselect</Button>
            <Button className="min-h-11" onClick={onBulkArchive}><Archive className="size-4" />Archive</Button>
          </div>,
          document.body,
        )}
      </div>
      <div className="hidden flex-wrap gap-2 items-center md:flex">
        <JobSearchBar value={query} onChange={onQueryChange} />
        <Separator orientation="vertical" className="h-8" />
        <ViewModeToggle value={viewMode} onChange={onViewModeChange} />
        <Separator orientation="vertical" className="h-8" />
        <FilterBar
          filter={filter}
          sort={sort}
          onFilterChange={onFilterChange}
          onSortChange={onSortChange}
          earlyEnabled={earlyEnabled}
        />

        {selectedCount > 0 && (
          <>
            <Separator orientation="vertical" className="h-8" />
            <Button variant="default" size="sm" onClick={onBulkArchive} className="gap-1.5">
              <Archive size={14} />
              Archive ({selectedCount})
              <kbd className="ml-0.5 hidden items-center rounded border bg-background/20 px-1.5 font-mono text-[10px] font-medium sm:inline-flex">
                E
              </kbd>
            </Button>
            <Button variant="ghost" size="sm" onClick={onClearSelection} className="gap-1.5">
              <X size={14} />
              Clear
            </Button>
          </>
        )}

        <div className="flex-1" />

        <Button variant="outline" size="sm" className="gap-1.5" onClick={onBatchOpen}>
          <ListPlus size={16} />
          Batch Add
        </Button>

        <Button size="sm" className="gap-1.5" onClick={onCreateOpen}>
          <Plus size={16} />
          Add Job
          <kbd className="ml-0.5 hidden items-center gap-0.5 rounded border bg-background/20 px-1.5 font-mono text-[10px] font-medium sm:inline-flex">
            <span className="text-xs">⌘</span>J
          </kbd>
        </Button>
      </div>
      <div className="hidden text-xs text-muted-foreground md:block">
        {selectedCount > 0
          ? `${selectedCount} selected`
          : visibleCount === totalCount
            ? `${totalCount} ${totalCount === 1 ? 'job' : 'jobs'}`
            : `${visibleCount} of ${totalCount} jobs`}
      </div>
    </div>
  )
}

function ViewModeToggle({ value, onChange }: { value: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="inline-flex rounded-md border border-border bg-background text-xs overflow-hidden">
      <button
        type="button"
        onClick={() => onChange('grouped')}
        className={cn(
          'px-2.5 py-1.5 transition-colors',
          value === 'grouped'
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
        aria-pressed={value === 'grouped'}
      >
        By status
      </button>
      <button
        type="button"
        onClick={() => onChange('all')}
        className={cn(
          'px-2.5 py-1.5 border-l border-border transition-colors',
          value === 'all'
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
        aria-pressed={value === 'all'}
      >
        All
      </button>
    </div>
  )
}

type JobSearchBarProps = {
  value: string
  onChange: (value: string) => void
}

function JobSearchBar({ value, onChange }: JobSearchBarProps) {
  return (
    <div className="w-full md:w-auto md:max-w-sm">
      <InputGroup className="h-12 w-full md:h-8 md:w-80">
        <InputGroupInput
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-full text-base md:h-auto md:text-sm"
          placeholder="Search jobs"
          aria-label="Search jobs"
        />
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

type ColHeadersProps = {
  isAllSelected: boolean
  isSomeSelected: boolean
  onToggleAll: () => void
  sort: SortState
  onSortChange: (s: SortState) => void
  /** The sort behind the Fit column: the early score, or the deprecated JobFit rating while that is off. */
  fitField: SortState['field']
}

const COL_HEADERS = [
  { label: "Role",        className: "px-3" },
  { label: "Application", className: "px-2" },
  { label: "Fit",         className: "px-2" },
  { label: "Dates",       className: "px-2" },
] as const

function ColHeaders({ isAllSelected, isSomeSelected, onToggleAll, sort, onSortChange, fitField }: ColHeadersProps) {
  const fitSorted = sort.field === fitField
  // First click sorts best-first; later clicks flip the direction.
  function sortByFit() {
    onSortChange({ field: fitField, direction: fitSorted && sort.direction === 'desc' ? 'asc' : 'desc' })
  }

  return (
    <div className="col-span-full grid grid-cols-subgrid border-b border-border/50">
      <div className="flex items-center justify-center px-2 py-1.5">
        <Checkbox
          checked={isAllSelected}
          indeterminate={isSomeSelected}
          onCheckedChange={onToggleAll}
          aria-label={isAllSelected ? 'Deselect visible jobs' : 'Select visible jobs'}
        />
      </div>
      {COL_HEADERS.map(({ label, className }) => label === 'Fit' ? (
        <button
          key={label}
          type="button"
          onClick={sortByFit}
          aria-label={`Sort by fit score${fitSorted ? `, currently ${sort.direction === 'desc' ? 'highest' : 'lowest'} first` : ''}`}
          className={cn(
            'flex items-center gap-0.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            fitSorted ? 'text-foreground' : 'text-muted-foreground/50',
            className,
          )}
        >
          {label}
          {fitSorted && (sort.direction === 'desc'
            ? <ArrowDown size={10} aria-hidden="true" />
            : <ArrowUp size={10} aria-hidden="true" />)}
        </button>
      ) : (
        <div key={label} className={`py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50 ${className}`}>
          {label}
        </div>
      ))}
      <div className="px-2 py-1.5"><span className="sr-only">Notes and actions</span></div>
    </div>
  )
}
