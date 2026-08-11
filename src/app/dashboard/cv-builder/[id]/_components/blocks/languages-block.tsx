'use client'

import { Check, X, Plus, Trash2 } from 'lucide-react'
import { useBlockEdit } from '../cv-block'
import type { CVSection, LanguagesData } from '@/modules/cv/schema'

type Props = {
  section: CVSection & { type: 'languages'; data: LanguagesData }
  onUpdate: (section: CVSection) => void
  showHeading?: boolean
}

export function LanguagesBlock({ section, onUpdate, showHeading = true }: Props) {
  const { editing, setEditing, draft, setDraft } = useBlockEdit(section, s => s.data.items)

  function save() {
    onUpdate({ ...section, data: { items: draft.filter(i => Boolean(i.name)) } })
    setEditing(false)
  }

  return (
    <div>
      {showHeading && (
        <div className="mb-2 border-b border-border pb-1">
          <h2 className="cv-section-heading">Languages</h2>
        </div>
      )}
      {editing ? (
        <div className="space-y-2">
          {draft.map((item, i) => (
            <div key={i} className="flex gap-2">
              <div className="flex flex-1 gap-2">
                <div className="flex-1 space-y-1">
                  <label className="text-xs text-muted-foreground">Language</label>
                  <input
                    value={item.name}
                    onChange={e => setDraft(draft.map((d, j) => j === i ? { ...d, name: e.target.value } : d))}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-xs text-muted-foreground">Proficiency</label>
                  <input
                    value={item.proficiency}
                    onChange={e => setDraft(draft.map((d, j) => j === i ? { ...d, proficiency: e.target.value } : d))}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
              <button onClick={() => setDraft(draft.filter((_, j) => j !== i))} className="self-end rounded p-1.5 text-muted-foreground hover:bg-muted">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          <button onClick={() => setDraft([...draft, { name: '', proficiency: '' }])} className="flex items-center gap-1 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted">
            <Plus className="size-3" />Add
          </button>
          <div className="flex gap-2">
            <button onClick={save} className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90">
              <Check className="size-3" />Save
            </button>
            <button onClick={() => { setDraft(section.data.items); setEditing(false) }} className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted">
              <X className="size-3" />Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="cv-body">
          {section.data.items.map(l => `${l.name} (${l.proficiency})`).join(' · ')}
        </p>
      )}
    </div>
  )
}
