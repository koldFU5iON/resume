'use client'

import { useState } from 'react'
import { ChevronDown, ListPlus, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter, DrawerClose, DrawerTrigger } from '@/components/ui/drawer'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import {
  APPLICATION_STATUS_LABEL,
  APPLICATION_SOURCE_LABEL,
  APPLICATION_SOURCES,
  ApplicationStatus,
  type ApplicationStatusType,
  type ApplicationSourceType,
} from '@/app/types/job-application'
import type { JobFit } from '@/app/types/job-application'
import { EARLY_FILTER_OPTIONS, type EarlyLevelFilter } from './early-assessment-view'

export type FilterState = {
  status: Set<ApplicationStatusType>
  source: Set<ApplicationSourceType>
  fit: Set<JobFit['label'] | 'none'>
  early: Set<EarlyLevelFilter>
}

/** `fitRating` is the deprecated JobFit score; `earlyScore` is the early assessment's. */
export type SortField = 'dateApplied' | 'datePublished' | 'company' | 'fitRating' | 'earlyScore' | 'lastUpdated'
export type SortDirection = 'asc' | 'desc'
export type SortState = { field: SortField; direction: SortDirection }

export const DEFAULT_FILTER: FilterState = {
  status: new Set(),
  source: new Set(),
  fit: new Set(),
  early: new Set(),
}

export const DEFAULT_SORT: SortState = { field: 'dateApplied', direction: 'desc' }

export function selectSortField(current: SortState, field: SortField): SortState {
  return field === current.field ? current : { field, direction: field === 'company' ? 'asc' : 'desc' }
}

export function isFilterActive(f: FilterState) {
  return f.status.size > 0 || f.source.size > 0 || f.fit.size > 0 || f.early.size > 0
}

/**
 * Sort options. With the early assessment on, "Fit score" sorts by it and the
 * deprecated JobFit rating isn't offered; with it off, "Fit score" is JobFit's.
 */
function sortOptions(earlyEnabled: boolean): { value: SortField; label: string }[] {
  return [
    { value: 'dateApplied',   label: 'Date applied' },
    { value: 'datePublished', label: 'Date published' },
    { value: 'company',       label: 'Company' },
    { value: earlyEnabled ? 'earlyScore' : 'fitRating', label: 'Fit score' },
    { value: 'lastUpdated',   label: 'Last updated' },
  ]
}

/**
 * The sort to use for this user: a saved sort on the other model's fit score
 * maps to the current one, so a "Fit score" choice survives the switch.
 */
export function normaliseSort(sort: SortState, earlyEnabled: boolean): SortState {
  if (earlyEnabled && sort.field === 'fitRating') return { ...sort, field: 'earlyScore' }
  if (!earlyEnabled && sort.field === 'earlyScore') return { ...sort, field: 'fitRating' }
  return sort
}

const STATUS_OPTIONS = Object.values(ApplicationStatus).map(v => ({
  value: v as ApplicationStatusType,
  label: APPLICATION_STATUS_LABEL[v as ApplicationStatusType],
}))

const SOURCE_OPTIONS = APPLICATION_SOURCES.map(v => ({
  value: v as ApplicationSourceType,
  label: APPLICATION_SOURCE_LABEL[v as ApplicationSourceType],
}))

const FIT_OPTIONS: { value: JobFit['label'] | 'none'; label: string }[] = [
  { value: 'standout', label: 'Standout' },
  { value: 'solid',    label: 'Solid' },
  { value: 'stretch',  label: 'Stretch' },
  { value: 'possible', label: 'Possible' },
  { value: 'reach',    label: 'Reach' },
  { value: 'none',     label: 'Not assessed' },
]

type FilterBarProps = {
  filter: FilterState
  sort: SortState
  onFilterChange: (f: FilterState) => void
  onSortChange: (s: SortState) => void
  /** Early assessment on for this user: "Fit" filters and sorts by it instead of the deprecated JobFit. */
  earlyEnabled?: boolean
}

export function FilterBar({ filter, sort, onFilterChange, onSortChange, earlyEnabled = false }: FilterBarProps) {
  const active = isFilterActive(filter)
  const options = sortOptions(earlyEnabled)

  function clearFilters() {
    onFilterChange({ status: new Set(), source: new Set(), fit: new Set(), early: new Set() })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterDropdown
        label="Status"
        options={STATUS_OPTIONS}
        selected={filter.status}
        onChange={(next) => onFilterChange({ ...filter, status: next as Set<ApplicationStatusType> })}
      />
      <FilterDropdown
        label="Source"
        options={SOURCE_OPTIONS}
        selected={filter.source}
        onChange={(next) => onFilterChange({ ...filter, source: next as Set<ApplicationSourceType> })}
      />
      {earlyEnabled ? (
        <FilterDropdown
          label="Fit"
          options={EARLY_FILTER_OPTIONS}
          selected={filter.early}
          onChange={(next) => onFilterChange({ ...filter, early: next })}
        />
      ) : (
        <FilterDropdown
          label="Fit"
          options={FIT_OPTIONS}
          selected={filter.fit}
          onChange={(next) => onFilterChange({ ...filter, fit: next as Set<JobFit['label'] | 'none'> })}
        />
      )}
      <SortDropdown sort={sort} options={options} onSortChange={onSortChange} />
      {active && (
        <button
          type="button"
          onClick={clearFilters}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={12} />
          Clear filters
        </button>
      )}
    </div>
  )
}

export function MobileListControls({ filter, sort, onFilterChange, onSortChange, earlyEnabled = false, viewMode, onViewModeChange, onBatchOpen, resultCount }: FilterBarProps & {
  viewMode: 'grouped' | 'all'
  onViewModeChange: (mode: 'grouped' | 'all') => void
  onBatchOpen: () => void
  resultCount: number
}) {
  const [open, setOpen] = useState(false)
  const count = filter.status.size + filter.source.size + (earlyEnabled ? filter.early.size : filter.fit.size)
  const selectClass = 'h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex items-center gap-2"><SlidersHorizontal className="size-4" />Filters & sort{count > 0 && <span className="rounded bg-muted px-2 tabular-nums">{count}</span>}</span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="text-left!">
          <DrawerTitle>Organize jobs</DrawerTitle>
          <DrawerDescription>Choose what to see and how to order it.</DrawerDescription>
        </DrawerHeader>
        <div className="space-y-6 overflow-y-auto overscroll-contain px-4 pb-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-2 text-sm font-medium">View
              <select className={selectClass} value={viewMode} onChange={e => onViewModeChange(e.target.value as 'grouped' | 'all')}>
                <option value="grouped">By status</option><option value="all">All jobs</option>
              </select>
            </label>
            <label className="space-y-2 text-sm font-medium">Sort by
              <select className={selectClass} value={sort.field} onChange={e => onSortChange(selectSortField(sort, e.target.value as SortField))}>
                {sortOptions(earlyEnabled).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
          <label className="block space-y-2 text-sm font-medium">Sort direction
            <select className={selectClass} value={sort.direction} onChange={e => onSortChange({ ...sort, direction: e.target.value as SortDirection })}>
              <option value="desc">{sort.field === 'company' ? 'Z to A' : sort.field === 'earlyScore' || sort.field === 'fitRating' ? 'Highest first' : 'Newest first'}</option>
              <option value="asc">{sort.field === 'company' ? 'A to Z' : sort.field === 'earlyScore' || sort.field === 'fitRating' ? 'Lowest first' : 'Oldest first'}</option>
            </select>
          </label>
          <MobileFilterOptions label="Status" options={STATUS_OPTIONS} selected={filter.status} onChange={status => onFilterChange({ ...filter, status })} />
          <MobileFilterOptions label="Source" options={SOURCE_OPTIONS} selected={filter.source} onChange={source => onFilterChange({ ...filter, source })} />
          {earlyEnabled
            ? <MobileFilterOptions label="Fit" options={EARLY_FILTER_OPTIONS} selected={filter.early} onChange={early => onFilterChange({ ...filter, early })} />
            : <MobileFilterOptions label="Fit" options={FIT_OPTIONS} selected={filter.fit} onChange={fit => onFilterChange({ ...filter, fit })} />}
          <Button variant="outline" className="min-h-11 w-full" onClick={() => { setOpen(false); onBatchOpen() }}><ListPlus className="size-4" />Batch Add jobs</Button>
        </div>
        <DrawerFooter className="border-t border-border pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex gap-3">
            <Button variant="outline" className="min-h-11" disabled={!count} onClick={() => onFilterChange({ status: new Set(), source: new Set(), fit: new Set(), early: new Set() })}>Clear filters</Button>
            <DrawerClose asChild><Button className="min-h-11 flex-1">Show {resultCount} {resultCount === 1 ? 'job' : 'jobs'}</Button></DrawerClose>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

function MobileFilterOptions<T extends string>({ label, options, selected, onChange }: FilterDropdownProps<T>) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        {options.map(option => (
          <label key={option.value} className={cn('flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm', selected.has(option.value) ? 'border-primary bg-primary/10' : 'border-border')}>
            <input type="checkbox" className="size-5 shrink-0 accent-primary" checked={selected.has(option.value)} onChange={() => {
              const next = new Set(selected)
              if (next.has(option.value)) next.delete(option.value)
              else next.add(option.value)
              onChange(next)
            }} />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

type FilterDropdownProps<T extends string> = {
  label: string
  options: { value: T; label: string }[]
  selected: Set<T>
  onChange: (next: Set<T>) => void
}

function FilterDropdown<T extends string>({ label, options, selected, onChange }: FilterDropdownProps<T>) {
  const count = selected.size

  function toggle(value: T) {
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange(next)
  }

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs transition-colors hover:bg-muted",
          count > 0 ? "border-foreground/30 text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {count > 0 && (
          <span className="rounded bg-foreground/10 px-1 font-medium tabular-nums">
            {count}
          </span>
        )}
        <ChevronDown size={11} className="shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-1">
        {options.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted transition-colors"
          >
            <Checkbox
              checked={selected.has(opt.value)}
              onCheckedChange={() => toggle(opt.value)}
              aria-hidden="true"
              tabIndex={-1}
            />
            {opt.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

type SortDropdownProps = {
  sort: SortState
  options: { value: SortField; label: string }[]
  onSortChange: (s: SortState) => void
}

function SortDropdown({ sort, options, onSortChange }: SortDropdownProps) {
  const currentLabel = options.find(o => o.value === sort.field)?.label ?? 'Sort'
  const dirLabel = sort.direction === 'asc' ? '↑' : '↓'

  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
      >
        {currentLabel} {dirLabel}
        <ChevronDown size={11} className="shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-1">
        {options.map(opt => {
          const isActive = sort.field === opt.value
          return (
            <div key={opt.value} className="flex items-center rounded hover:bg-muted transition-colors">
              <button
                type="button"
                onClick={() => onSortChange(selectSortField(sort, opt.value))}
                className={cn(
                  "flex-1 px-2 py-1.5 text-left text-sm",
                  isActive && "font-medium text-foreground",
                )}
              >
                {opt.label}
              </button>
              {isActive && (
                <button
                  type="button"
                  onClick={() => onSortChange({ field: sort.field, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}
                  className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                  aria-label="Toggle sort direction"
                >
                  {dirLabel}
                </button>
              )}
            </div>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
