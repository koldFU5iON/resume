'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useDocumentSave, type DocumentSaveResult } from '@/components/document-editor/use-document-save'
import { SaveStatus } from '@/components/document-editor/save-status'
import { DocumentSaveDialogs } from '@/components/document-editor/document-save-dialogs'

type Props = {
  /** localStorage key for unsaved edits; one per note. */
  recoveryKey: string
  /** What the note is called in prompts, e.g. "Engineer at Acme". */
  name: string
  initialContent: string
  initialRevision: number
  /** Saves if the saved revision is still `expectedRevision`; see updateExperienceNotes. */
  onSave: (content: string, expectedRevision: number) => Promise<DocumentSaveResult>
  /** The note's current saved version, to catch a page restored from the router cache. */
  loadLive?: () => Promise<{ content: string; revision: number } | null>
  placeholder?: string
}

/**
 * A role's or project's note: Markdown to write, Preview to read, the same
 * switch as the Writing Desk. Saving is the shared document editor's:
 * autosave against a revision, recovery after a reload, a conflict dialog when
 * the note changed elsewhere. The text is capped at a readable measure and the
 * page around it scrolls, so there is no second scroll bar inside the note.
 */
export function NoteEditor({
  recoveryKey,
  name,
  initialContent,
  initialRevision,
  onSave,
  loadLive,
  placeholder = 'Start writing…',
}: Props) {
  const save = useDocumentSave({ recoveryKey, initialContent, initialRevision, save: onSave, loadLive, noun: 'note' })
  const { content } = save
  const [mode, setMode] = useState<'markdown' | 'preview'>('markdown')

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`)
    } catch {
      toast.error('Could not copy to the clipboard')
    }
  }

  // 52ch (Geist's "0" is wide) of 16px text is about 70 characters a line; the 3rem is the side padding.
  return (
    <div className="mx-auto w-full max-w-[calc(52ch+3rem)] px-4 pb-16 sm:px-6">
      <div className="sticky top-0 z-10 flex min-h-10 items-center justify-between gap-3 bg-background/95 py-2 backdrop-blur">
        <div role="group" aria-label="Note view" className="flex overflow-hidden rounded-md border text-xs">
          {(['markdown', 'preview'] as const).map(value => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={cn('px-3 py-1.5', mode === value ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}
            >
              {value === 'markdown' ? 'Markdown' : 'Preview'}
            </button>
          ))}
        </div>
        <SaveStatus state={save.saveState} onRetry={save.retry} onResolve={() => save.setConflictOpen(true)} />
      </div>

      {mode === 'markdown' ? (
        <textarea
          aria-label={`${name}, note`}
          value={content}
          onChange={e => save.onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck
          className="field-sizing-content block min-h-[50vh] w-full resize-none bg-transparent font-sans text-base leading-7 outline-none placeholder:text-muted-foreground/50"
        />
      ) : content ? (
        <div className="prose max-w-none leading-7 dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm italic text-muted-foreground/60">Nothing written yet.</p>
      )}

      <DocumentSaveDialogs save={save} name={name} noun="note" onCopy={(value, label) => void copyText(value, label)} />
    </div>
  )
}
