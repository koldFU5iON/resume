'use client'

import { useRef, useState, useEffect } from 'react'
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
  placeholder?: string
  className?: string
}

/**
 * A role's or project's note: click to edit, rendered as Markdown otherwise.
 * Saving is the shared document editor's: autosave against a revision,
 * recovery after a reload, a conflict dialog when the note changed elsewhere.
 */
export function NoteEditor({
  recoveryKey,
  name,
  initialContent,
  initialRevision,
  onSave,
  placeholder = 'Click to start writing…',
  className,
}: Props) {
  const save = useDocumentSave({ recoveryKey, initialContent, initialRevision, save: onSave, noun: 'note' })
  const { content } = save
  const [isEditing, setIsEditing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const viewRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isEditing) textareaRef.current?.focus()
  }, [isEditing])

  function handleBlur() {
    setIsEditing(false)
    void save.settle()
    setTimeout(() => viewRef.current?.focus(), 0)
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`)
    } catch {
      toast.error('Could not copy to the clipboard')
    }
  }

  return (
    <div className={cn('flex flex-1 flex-col overflow-hidden', className)}>
      {save.saveState !== 'idle' && (
        <div className="flex shrink-0 justify-end px-4 pt-2">
          <SaveStatus state={save.saveState} onRetry={save.retry} onResolve={() => save.setConflictOpen(true)} />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        {isEditing ? (
          <textarea
            ref={textareaRef}
            aria-label={`${name}, note`}
            value={content}
            onChange={e => save.onChange(e.target.value)}
            onBlur={handleBlur}
            className="h-full w-full resize-none bg-transparent p-4 font-mono text-sm leading-relaxed outline-none placeholder:text-muted-foreground/40"
            placeholder={placeholder}
          />
        ) : (
          <div
            ref={viewRef}
            role="button"
            tabIndex={0}
            onClick={() => setIsEditing(true)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setIsEditing(true)
              }
            }}
            className="h-full cursor-text overflow-y-auto p-4"
            aria-label="Edit note"
          >
            {content ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm italic text-muted-foreground/50">{placeholder}</p>
            )}
          </div>
        )}
      </div>
      <DocumentSaveDialogs save={save} name={name} noun="note" onCopy={(value, label) => void copyText(value, label)} />
    </div>
  )
}
