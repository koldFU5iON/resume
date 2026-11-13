"use client"

import { useId, useRef, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { renameWritingDeskDocumentAction } from "@/modules/writing-desk/actions"
import { MAX_WRITING_DESK_DOCUMENT_NAME_LENGTH, WritingDeskDocumentNameSchema } from "@/modules/writing-desk/schema"

/**
 * Renames a document (#371). Render only while open, so it starts from the
 * current name each time. Renaming doesn't touch the content or its
 * revision, so it's safe while an edit is saving.
 */
export function RenameDocumentDialog({
  documentId,
  name,
  onOpenChange,
  onRenamed,
}: {
  documentId: string
  name: string
  onOpenChange: (open: boolean) => void
  onRenamed: (name: string) => void
}) {
  const ids = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(name)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = WritingDeskDocumentNameSchema.safeParse(value)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the name")
      inputRef.current?.focus()
      return
    }
    if (parsed.data === name) {
      onOpenChange(false)
      return
    }
    startTransition(async () => {
      try {
        const result = await renameWritingDeskDocumentAction({ documentId, name: parsed.data })
        if (!result.ok) {
          setError(result.message)
          return
        }
        onRenamed(result.name)
        onOpenChange(false)
      } catch {
        setError("Couldn't rename the document. Check your connection and try again.")
      }
    })
  }

  return (
    <Dialog open onOpenChange={next => { if (!pending) onOpenChange(next) }}>
      <DialogContent
        initialFocus={() => {
          inputRef.current?.select()
          return inputRef.current
        }}
        className="sm:max-w-md"
      >
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Rename document</DialogTitle>
            <DialogDescription>The name shows on the document&apos;s tab and in its PDF file name.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label htmlFor={`${ids}-name`} className="text-sm font-medium">Name</label>
            <Input
              ref={inputRef}
              id={`${ids}-name`}
              value={value}
              onChange={event => { setValue(event.target.value); setError(null) }}
              maxLength={MAX_WRITING_DESK_DOCUMENT_NAME_LENGTH}
              autoComplete="off"
              required
              disabled={pending}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${ids}-error` : undefined}
              className="h-9"
            />
            {error && <p id={`${ids}-error`} role="alert" className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter className="mt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Rename"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
