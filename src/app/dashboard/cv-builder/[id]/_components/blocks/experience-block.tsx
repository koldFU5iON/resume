'use client'

import { Check, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useBlockEdit } from '../cv-block'
import { SortableItemList } from './sortable-item-list'
import type { CVSection, ExperienceData } from '@/modules/cv/schema'

type Props = {
  section: CVSection & { type: 'experience'; data: ExperienceData }
  onUpdate: (section: CVSection) => void
  showHeading?: boolean
}

export function ExperienceBlock({ section, onUpdate, showHeading = true }: Props) {
  const { editing, setEditing, draft, setDraft } = useBlockEdit(section, s => s.data)
  const { company, titles, subtitle, location, duration, description, outcomes } = section.data

  function save() {
    onUpdate({
      ...section,
      data: {
        ...draft,
        outcomes: draft.outcomes.filter(Boolean),
        titles: draft.titles.filter(Boolean),
      },
    })
    setEditing(false)
  }

  if (!editing) {
    return (
      <div>
        {showHeading && (
          <div className="mb-2 border-b border-border pb-1">
            <h2 className="cv-section-heading">Professional Experience</h2>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-4">
          <p className="cv-item-title">{company}</p>
          <p className="cv-meta shrink-0 text-right">{duration}</p>
        </div>
        <p className="cv-role-title">{[...titles].reverse().join(' → ')}</p>
        {subtitle && <p className="cv-meta italic">{subtitle}</p>}
        <p className="cv-meta">{location}</p>
        <div className="prose prose-sm dark:prose-invert mt-1.5 max-w-none">
          <ReactMarkdown>{description}</ReactMarkdown>
        </div>
        <ul className="mt-2 space-y-1">
          {outcomes.map((o, i) => (
            <li key={i} className="cv-bullet flex gap-2">
              <span className="shrink-0">–</span>
              <ReactMarkdown components={{ p: ({ children }) => <span>{children}</span> }}>
                {o}
              </ReactMarkdown>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="mb-2 border-b border-border pb-1">
        <h2 className="cv-section-heading">Professional Experience</h2>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {(
          [
            ['Company', 'company', draft.company],
            ['Duration', 'duration', draft.duration],
            ['Location', 'location', draft.location],
          ] as const
        ).map(([label, field, value]) => (
          <div key={field} className="space-y-1">
            <label className="text-xs text-muted-foreground">{label}</label>
            <input
              value={value}
              onChange={e => setDraft({ ...draft, [field]: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        ))}
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">
          Titles (one per line — most recent first)
        </label>
        <textarea
          value={draft.titles.join('\n')}
          onChange={e => setDraft({ ...draft, titles: e.target.value.split('\n') })}
          rows={2}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">
          Subtitle (optional — e.g. promoted from X to Y in 2022)
        </label>
        <input
          value={draft.subtitle ?? ''}
          onChange={e => setDraft({ ...draft, subtitle: e.target.value || null })}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Description (Markdown supported)</label>
        <textarea
          value={draft.description}
          onChange={e => setDraft({ ...draft, description: e.target.value })}
          rows={4}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Outcomes — drag to prioritise</label>
        <SortableItemList
          items={draft.outcomes}
          onChange={outcomes => setDraft({ ...draft, outcomes })}
          placeholder="Achievement or outcome"
          addLabel="Add achievement"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={save}
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
        >
          <Check className="size-3" />
          Save
        </button>
        <button
          onClick={() => {
            setDraft(section.data)
            setEditing(false)
          }}
          className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
        >
          <X className="size-3" />
          Cancel
        </button>
      </div>
    </div>
  )
}
