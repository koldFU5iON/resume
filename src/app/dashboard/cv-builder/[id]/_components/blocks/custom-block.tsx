'use client'

import { Check, X } from 'lucide-react'
import { useBlockEdit } from '../cv-block'
import { MarkdownProse } from '@/components/ui/markdown-prose'
import { SortableItemList } from './sortable-item-list'
import type { CVSection } from '@/modules/cv/schema'

type Props = {
  section: CVSection & { type: 'custom' }
  onUpdate: (section: CVSection) => void
  showHeading?: boolean
}

export function CustomBlock({ section, onUpdate, showHeading = true }: Props) {
  const { editing, setEditing, draft, setDraft } = useBlockEdit(
    section,
    s => ({
      heading: s.data.heading,
      content: s.data.content ?? '',
      items: s.data.items ?? [],
    }),
  )

  function save() {
    onUpdate({
      ...section,
      data: {
        ...section.data,
        heading: draft.heading,
        content: section.data.subtype === 'text' ? draft.content : null,
        items: section.data.subtype === 'list' ? draft.items.filter(Boolean) : null,
      },
    })
    setEditing(false)
  }

  function cancel() {
    setDraft({
      heading: section.data.heading,
      content: section.data.content ?? '',
      items: section.data.items ?? [],
    })
    setEditing(false)
  }

  if (!editing) {
    return (
      <div>
        {showHeading && (
          <div className="mb-2 border-b border-border pb-1">
            <h2 className="cv-section-heading">{section.data.heading}</h2>
          </div>
        )}
        {section.data.subtype === 'text' ? (
          <MarkdownProse content={section.data.content ?? ''} />
        ) : (
          <p className="cv-body">{(section.data.items ?? []).join(' · ')}</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Section Heading</label>
        <input
          value={draft.heading}
          onChange={e => setDraft({ ...draft, heading: e.target.value })}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {section.data.subtype === 'text' ? (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Content</label>
          <textarea
            value={draft.content}
            onChange={e => setDraft({ ...draft, content: e.target.value })}
            rows={6}
            className="w-full resize-y rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      ) : (
        <div className="space-y-2">
          <SortableItemList
            items={draft.items}
            onChange={items => setDraft({ ...draft, items })}
            placeholder="Item"
            addLabel="Add item"
          />
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={save} className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90">
          <Check className="size-3" />Save
        </button>
        <button onClick={cancel} className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted">
          <X className="size-3" />Cancel
        </button>
      </div>
    </div>
  )
}
