"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { SaveConflictDialog } from "./save-conflict-dialog"
import type { DocumentSave } from "./use-document-save"

/**
 * The two dialogs a document editor's save can raise: compare versions after a
 * conflict, and "Your latest edits aren't saved" when leaving with a save that
 * can't go through. Both read the state `useDocumentSave` returns.
 */
export function DocumentSaveDialogs({
  save,
  name,
  noun = "document",
  onCopy,
}: {
  save: DocumentSave
  /** The document's name, quoted in the leave prompt. */
  name: string
  noun?: string
  onCopy: (value: string, label: string) => void
}) {
  return (
    <>
      <SaveConflictDialog
        open={save.conflictOpen && save.conflict !== null}
        reason={save.conflictReason}
        noun={noun}
        onOpenChange={save.setConflictOpen}
        mine={save.content}
        saved={save.conflict?.content ?? ""}
        onKeepMine={save.keepMine}
        onUseSaved={save.adoptSavedVersion}
        onCopy={onCopy}
      />
      <AlertDialog open={save.leaveRequest !== null} onOpenChange={open => { if (!open) save.answerLeave(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Your latest edits aren&apos;t saved</AlertDialogTitle>
            <AlertDialogDescription>
              {save.saveState === "conflict"
                ? `"${name}" changed elsewhere, so your edits weren't saved.`
                : `Saving "${name}" failed.`}{" "}
              Your edits stay on this device and come back when you reopen this {noun}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => save.answerLeave(true)}>Leave anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
