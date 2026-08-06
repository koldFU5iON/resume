'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'

type Props = {
  onAdd: (heading: string, subtype: 'text' | 'list') => Promise<void>
}

export function SectionGap({ onAdd }: Props) {
  const [open, setOpen] = useState(false)
  const [heading, setHeading] = useState('')
  const [subtype, setSubtype] = useState<'text' | 'list'>('text')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    if (!heading.trim()) return
    setSubmitting(true)
    try {
      await onAdd(heading.trim(), subtype)
      setHeading('')
      setSubtype('text')
      setOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  if (open) {
    return (
      <div className="mx-[15mm] my-2 flex flex-col gap-1.5 rounded-md border border-border bg-background p-2 print:hidden">
        <input
          autoFocus
          value={heading}
          onChange={e => setHeading(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') setOpen(false) }}
          placeholder="Section name"
          className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex gap-1">
          {(['text', 'list'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setSubtype(t)}
              className={`flex-1 rounded px-2 py-0.5 text-xs capitalize transition-colors ${subtype === t ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={handleSubmit} disabled={submitting} className="flex-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            Add
          </button>
          <button type="button" onClick={() => setOpen(false)} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
            <X className="size-3" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="group/gap relative h-0 print:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute inset-x-[15mm] -top-2.5 flex h-5 items-center justify-center gap-1 rounded text-[10px] text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover/gap:opacity-100"
      >
        <Plus className="size-3" />
        Add section
      </button>
    </div>
  )
}
