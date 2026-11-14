'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Menu, Pencil, Trash2 } from 'lucide-react'
import { updateExperienceDetails } from '@/modules/profile/actions'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ExperienceWithActivities } from '@/app/types/profile'

type Props = {
  experience: ExperienceWithActivities
  projectName?: string
  onBack?: () => void
  onEditClick?: () => void
  onDeleteClick?: () => void
  onFieldSaved?: (field: keyof ReturnType<typeof getDetailsFields>, value: string | boolean) => void
}

const fmtDate = (d: Date) =>
  new Date(d).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

function getDetailsFields(exp: ExperienceWithActivities) {
  return {
    company: exp.company,
    role: exp.role,
    location: exp.location ?? undefined,
    remote: exp.remote,
    startDate: new Date(exp.startDate),
    endDate: exp.endDate ? new Date(exp.endDate) : undefined,
  }
}

export function ExperienceFrontmatter({
  experience,
  projectName,
  onBack,
  onEditClick,
  onDeleteClick,
  onFieldSaved,
}: Props) {
  const router = useRouter()

  if (projectName !== undefined) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs">
        <button
          type="button"
          onClick={onBack}
          className="text-primary hover:underline"
        >
          ← {experience.company}
        </button>
        <span className="text-muted-foreground">›</span>
        <span className="font-semibold">{projectName}</span>
        <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
          Project
        </span>
      </div>
    )
  }

  async function saveField(
    field: keyof ReturnType<typeof getDetailsFields>,
    value: string | boolean,
  ) {
    const current = getDetailsFields(experience)
    await updateExperienceDetails(experience.id, { ...current, [field]: value })
    onFieldSaved?.(field, value)
    router.refresh()
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/30 px-3 py-2 text-xs">
      {/* Options dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger
          className="rounded px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Experience options"
        >
          <Menu size={15} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={onEditClick}>
            <Pencil size={13} className="mr-2" /> Edit details
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={onDeleteClick}
          >
            <Trash2 size={13} className="mr-2" /> Delete experience
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <InlineField
        label="Company"
        value={experience.company}
        onSave={v => saveField('company', v)}
      />
      <InlineField
        label="Role"
        value={experience.role}
        onSave={v => saveField('role', v)}
      />
      <span className="text-muted-foreground">
        {fmtDate(experience.startDate)} –{' '}
        {experience.endDate ? fmtDate(experience.endDate) : 'Present'}
      </span>
      {experience.location && (
        <span className="text-muted-foreground">
          {experience.location}
          {experience.remote && ' · Remote'}
        </span>
      )}
    </div>
  )
}

function InlineField({
  label,
  value,
  onSave,
}: {
  label: string
  value: string
  onSave: (v: string) => Promise<unknown>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [prevValue, setPrevValue] = useState(value)

  if (value !== prevValue) {
    setPrevValue(value)
    if (!editing) setDraft(value)
  }

  async function handleBlur() {
    setEditing(false)
    if (draft.trim() && draft !== value) await onSave(draft.trim())
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') { setDraft(value); setEditing(false) }
          }}
          className="border-b border-primary bg-transparent text-xs font-semibold outline-none"
        />
      </div>
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Edit ${label}`}
      className="group flex cursor-pointer flex-col gap-0.5"
      onClick={() => setEditing(true)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setEditing(true)
        }
      }}
    >
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="border-b border-dashed border-muted-foreground/40 font-semibold transition-colors group-hover:border-foreground/60">
        {draft}
      </span>
    </div>
  )
}
