'use client'

import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { useBlockEditTrigger } from '../cv-block'
import { SortableItemList } from './sortable-item-list'
import type { CVSection } from '@/modules/cv/schema'

type Props = {
  section: CVSection & { type: 'skills' }
  onUpdate: (section: CVSection) => void
  showHeading?: boolean
}

export function SkillsBlock({ section, onUpdate, showHeading = true }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(section.data.items)
  const editTrigger = useBlockEditTrigger()

  const [seenTrigger, setSeenTrigger] = useState(editTrigger)
  if (seenTrigger !== editTrigger) {
    setSeenTrigger(editTrigger)
    if (editTrigger > 0) setEditing(true)
  }

  function save() {
    onUpdate({ ...section, data: { items: draft.filter(Boolean) } })
    setEditing(false)
  }

  return (
    <div>
      {showHeading && (
        <div className="mb-2 border-b border-border pb-1">
          <h2 className="cv-section-heading">Skills</h2>
        </div>
      )}
      {editing ? (
        <div className="space-y-2">
          <SortableItemList
            items={draft}
            onChange={setDraft}
            placeholder="Skill"
            addLabel="Add skill"
          />
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
        <p className="cv-body">{section.data.items.join(' · ')}</p>
      )}
    </div>
  )
}
