'use client'

import { useState, useRef, useTransition, useCallback } from 'react'
import { Pencil, Eye, Check } from 'lucide-react'
import { MarkdownProse } from '@/components/ui/markdown-prose'
import { updateJobNotes } from '@/modules/jobs/mutations'
import { cn } from '@/lib/utils'

interface Props {
  jobId: string
  notes: string | null | undefined
  notesIncludeInFit: boolean
}

export function JobNotesPane({ jobId, notes, notesIncludeInFit }: Props) {
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [draft, setDraft] = useState(notes ?? '')
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const save = useCallback(() => {
    startTransition(async () => {
      await updateJobNotes(jobId, draft, notesIncludeInFit)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    })
  }, [jobId, draft, notesIncludeInFit])

  const enterEdit = () => {
    setMode('edit')
    // Focus textarea on next tick after render
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const exitEdit = () => {
    setMode('preview')
    save()
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-end gap-2">
        {isPending && (
          <span className="text-xs text-muted-foreground" role="status">Saving…</span>
        )}
        {saved && !isPending && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
            <Check className="size-3" aria-hidden="true" /> Saved
          </span>
        )}
        <button
          type="button"
          onClick={mode === 'preview' ? enterEdit : exitEdit}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {mode === 'preview'
            ? <><Pencil className="size-3.5" aria-hidden="true" /> Edit notes</>
            : <><Eye className="size-3.5" aria-hidden="true" /> Done</>}
        </button>
      </div>

      {mode === 'edit' ? (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={exitEdit}
          aria-label="Job notes (Markdown)"
          placeholder="Add notes in Markdown…"
          className={cn(
            'min-h-48 w-full resize-y rounded-lg border bg-background p-3 text-sm leading-relaxed',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        />
      ) : draft.trim() ? (
        <div className="cursor-text" onClick={enterEdit} title="Click to edit">
          <MarkdownProse content={draft} />
        </div>
      ) : (
        <p className="cursor-text text-sm text-muted-foreground" onClick={enterEdit}>
          No notes yet.
        </p>
      )}
    </div>
  )
}
