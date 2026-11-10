'use client'

import { useEffect, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { type Job } from "@/app/types/job-application"
import { JobRow } from "./job-row"
import { JobRowCard } from "./job-row-card"

const COLLAPSE_KEY = 'jobs-group-collapsed'

function readCollapseMap(): Record<string, boolean> {
  try {
    return JSON.parse(window.localStorage.getItem(COLLAPSE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function writeCollapseMap(map: Record<string, boolean>) {
  window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(map))
}

type JobGroupProps = {
  label: string | null
  groupKey: string
  jobs: Job[]
  selected: Set<string>
  busyRows: Map<string, string>
  onToggleSelect: (id: string) => void
  onEdit: (job: Job) => void
  onArchive: (id: string) => void
  onGenerateCV: (id: string) => void
  onCreateCoverLetter: (id: string) => void
  defaultCollapsed?: boolean
  hasLLMKey: boolean
  earlyEnabled: boolean
  isMobile?: boolean
}

export function JobGroup({
  label,
  groupKey,
  jobs,
  selected,
  busyRows,
  onToggleSelect,
  onEdit,
  onArchive,
  onGenerateCV,
  onCreateCoverLetter,
  defaultCollapsed = false,
  hasLLMKey,
  earlyEnabled,
  isMobile = false,
}: JobGroupProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  // Hydrate from localStorage after mount (SSR-safe — avoids hydration mismatch)
  useEffect(() => {
    const map = readCollapseMap()
    if (groupKey in map) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(map[groupKey])
    }
  }, [groupKey])

  function handleToggle() {
    setCollapsed(c => {
      const next = !c
      const map = readCollapseMap()
      map[groupKey] = next
      writeCollapseMap(map)
      return next
    })
  }

  if (jobs.length === 0) return null

  const isCollapsible = label !== null

  return (
    <div className={isMobile ? undefined : "col-span-full grid grid-cols-subgrid"}>
      {label !== null && (
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={!collapsed}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors border-b border-border/30 cursor-pointer w-full",
            !isMobile && "col-span-full",
          )}
        >
          {isCollapsible && (collapsed
            ? <ChevronRight size={12} className="shrink-0" />
            : <ChevronDown size={12} className="shrink-0" />)}
          <span>{label}</span>
          <span className="text-muted-foreground/70 font-normal normal-case">· {jobs.length}</span>
        </button>
      )}

      {!collapsed && jobs.map(job => isMobile ? (
        <JobRowCard
          key={job.id}
          job={job}
          selected={selected.has(job.id)}
          busyLabel={busyRows.get(job.id)}
          onToggleSelect={onToggleSelect}
          onEdit={onEdit}
          onArchive={onArchive}
          onGenerateCV={onGenerateCV}
          onCreateCoverLetter={onCreateCoverLetter}
          hasLLMKey={hasLLMKey}
          earlyEnabled={earlyEnabled}
        />
      ) : (
        <JobRow
          key={job.id}
          job={job}
          selected={selected.has(job.id)}
          busyLabel={busyRows.get(job.id)}
          onToggleSelect={onToggleSelect}
          onEdit={onEdit}
          onArchive={onArchive}
          onGenerateCV={onGenerateCV}
          onCreateCoverLetter={onCreateCoverLetter}
          hasLLMKey={hasLLMKey}
          earlyEnabled={earlyEnabled}
        />
      ))}
    </div>
  )
}
