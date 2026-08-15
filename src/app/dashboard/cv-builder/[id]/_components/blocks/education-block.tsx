'use client'

import { Check, X } from 'lucide-react'
import { useBlockEdit } from '../cv-block'
import type { CVSection, EducationData } from '@/modules/cv/schema'

type Props = {
  section: CVSection & { type: 'education'; data: EducationData }
  onUpdate: (section: CVSection) => void
  showHeading?: boolean
}

export function EducationBlock({ section, onUpdate, showHeading = true }: Props) {
  const { editing, setEditing, draft, setDraft } = useBlockEdit(section, s => s.data)
  const { institution, qualification, field, duration, grade } = section.data

  function save() {
    onUpdate({ ...section, data: draft })
    setEditing(false)
  }

  return (
    <div>
      {showHeading && (
        <div className="mb-2 border-b border-border pb-1">
          <h2 className="cv-section-heading">Education</h2>
        </div>
      )}
      {editing ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['Institution', 'institution', draft.institution, false],
                ['Qualification', 'qualification', draft.qualification, false],
                ['Field (optional)', 'field', draft.field ?? '', true],
                ['Duration', 'duration', draft.duration, false],
                ['Grade (optional)', 'grade', draft.grade ?? '', true],
              ] as const
            ).map(([label, key, value, optional]) => (
              <div key={key} className="space-y-1">
                <label className="text-xs text-muted-foreground">{label}</label>
                <input
                  value={value}
                  onChange={e => {
                    const val = e.target.value
                    if (optional) {
                      setDraft({ ...draft, [key]: val || undefined })
                    } else {
                      setDraft({ ...draft, [key]: val })
                    }
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            ))}
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
      ) : (
        <div>
          <p className="cv-item-title">{institution}</p>
          <p className="cv-body">
            {qualification}
            {field ? ` · ${field}` : ''}
          </p>
          <p className="cv-meta">
            {duration}
            {grade ? ` · ${grade}` : ''}
          </p>
        </div>
      )}
    </div>
  )
}
