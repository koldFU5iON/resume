"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

/**
 * Confirms deleting a document (#377), naming it. Render only while open.
 * `onConfirm` deletes and moves on to the next document; it resolves with an
 * error message when the document is still there.
 */
export function DeleteDocumentDialog({
  name,
  hasDraft,
  onOpenChange,
  onConfirm,
}: {
  name: string
  hasDraft: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<string | null>
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setPending(true)
    setError(null)
    const message = await onConfirm()
    // On success the page moves to another document; stay busy until it does.
    if (message !== null) {
      setError(message)
      setPending(false)
    }
  }

  return (
    <AlertDialog open onOpenChange={next => { if (!pending) onOpenChange(next) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">Delete &ldquo;{name}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the document{hasDraft ? ", the agent draft waiting for review" : ""} and its draft
            history. The job&apos;s other documents and any CV it started from aren&apos;t affected. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={() => void confirm()} disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {pending ? "Deleting…" : "Delete document"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
