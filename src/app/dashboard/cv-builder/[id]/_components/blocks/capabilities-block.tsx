'use client'

import { Check, X } from 'lucide-react'
import { useBlockEdit } from '../cv-block'
import { SortableItemList } from './sortable-item-list'
import type { CVSection } from '@/modules/cv/schema'

type Props = {
  section: CVSection & { type: 'capabilities' }
  onUpdate: (section: CVSection) => void
  showHeading?: boolean
}

export function CapabilitiesBlock({ section, onUpdate, showHeading = true }: Props) {
  const { editing, setEditing, draft, setDraft } = useBlockEdit(section, s => s.data.items)

  function save() {
    onUpdate({ ...section, data: { items: draft.filter(Boolean) } })
    setEditing(false)
  }

  return (
    <div>
      {showHeading && (
        <div className="mb-2 border-b border-border pb-1">
          <h2 className="cv-section-heading">Capabilities</h2>
        </div>
      )}
      {editing ? (
        <div className="space-y-2">
          <SortableItemList
            items={draft}
            onChange={setDraft}
            placeholder="Capability"
            addLabel="Add capability"
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
        <div className="grid grid-cols-3 gap-x-4 gap-y-1">
          {section.data.items.map((item, i) => (
            <p key={i} className="cv-body">• {item}</p>
          ))}
        </div>
      )}
    </div>
  )
}
