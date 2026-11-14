"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Download, FileCheck2, Pencil, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { usePageContext, useWorkspaceContext } from "@/lib/context/page-context"
import { useDocumentSave } from "@/components/document-editor/use-document-save"
import { SaveStatus } from "@/components/document-editor/save-status"
import { DocumentSaveDialogs } from "@/components/document-editor/document-save-dialogs"
import { FOCUS_NEW_DOCUMENT_KEY } from "@/components/job-workspace/new-document-dialog"
import {
  deleteWritingDeskDocumentAction,
  getWritingDeskLiveStateAction,
  setWritingDeskDocumentType,
  setWritingDeskSource,
  updateWritingDeskContent,
} from "@/modules/writing-desk/actions"
import { writingDeskPdfHref } from "@/modules/jobs/workspace-nav"
import { writingDeskMarkdownToText } from "@/modules/writing-desk/markdown"
import type { WritingDeskDocumentType } from "@/modules/writing-desk/schema"
import type { WritingDeskSourceOption, WritingDeskWithJob } from "@/modules/writing-desk/queries"
import { WritingDeskPreview } from "@/app/components/writing-desk-preview"
import { AvailableBlocks } from "./available-blocks"
import { CopyButton, type CopyFormat } from "./copy-button"
import { DeleteDocumentDialog } from "./delete-document-dialog"
import { DraftReview } from "./draft-review"
import { RenameDocumentDialog } from "./rename-document-dialog"
import { ReplaceWithCvPicker } from "./replace-with-cv-picker"

/** The editor dispatches nothing; the Coach card and draft review dispatch this after an accept has saved. */
type WritingDeskUpdatedDetail = { deskId: string; proposedContent: string; revision: number }

/** A Server Action that redirected rejects with Next's redirect error; the navigation itself goes ahead. */
function isRedirectError(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")
}

const DOCUMENT_TYPES: Array<{ value: WritingDeskDocumentType; label: string }> = [
  { value: "cv", label: "CV" },
  { value: "cover-letter", label: "Cover Letter" },
  { value: "interview-prep", label: "Interview Prep" },
  { value: "other", label: "Other" },
]

function documentTypeLabel(type: WritingDeskDocumentType): string {
  return DOCUMENT_TYPES.find(item => item.value === type)?.label ?? type
}

/** The editor for one Writing Desk document (#370, #371). Keyed by document id, so switching documents remounts it. */
export function WritingDesk({
  desk,
  sourceCVs,
}: {
  desk: WritingDeskWithJob
  sourceCVs: WritingDeskSourceOption[]
}) {
  const recoveryKey = `writing-desk-recovery-${desk.id}`
  const [name, setName] = useState(desk.name)
  const [renaming, setRenaming] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [documentType, setDocumentType] = useState(desk.documentType)
  const [typePending, setTypePending] = useState(false)
  const [sourceLabel] = useState(desk.sourceLabel)
  const [mode, setMode] = useState<"markdown" | "preview">("markdown")
  const [blocksOpen, setBlocksOpen] = useState(false)
  const [reviewing, setReviewing] = useState(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { openPanel } = usePageContext()
  const router = useRouter()
  // Save, recovery, conflict and navigation guard are the shared document editor's.
  const save = useDocumentSave({
    recoveryKey,
    initialContent: desk.content,
    initialRevision: desk.revision,
    save: (value, expectedRevision) => updateWritingDeskContent(desk.id, value, expectedRevision),
    loadLive: () => getWritingDeskLiveStateAction(desk.id),
  })
  const { content, revision, saveState } = save
  const saveRef = useRef(save)
  useEffect(() => { saveRef.current = save })

  useWorkspaceContext(documentType ? {
    type: "writing_desk",
    deskId: desk.id,
    jobId: desk.jobApplication.id,
    title: desk.jobApplication.title,
    company: desk.jobApplication.company ?? undefined,
    documentType,
    revision,
    sourceCvDocumentId: desk.sourceCvDocumentId ?? undefined,
  } : null)

  // A just-created document takes focus.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        if (sessionStorage.getItem(FOCUS_NEW_DOCUMENT_KEY) === desk.id) {
          sessionStorage.removeItem(FOCUS_NEW_DOCUMENT_KEY)
          textareaRef.current?.focus()
        }
      } catch {}
    })
    return () => window.cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mounted document
  }, [])

  // A draft for this document was accepted (Coach card or draft review): the
  // server already holds it as the new saved version (#378). The editor settles
  // the save in flight and keeps unsaved edits for the user to compare.
  useEffect(() => {
    async function handleWritingDeskUpdated(event: Event) {
      const detail = (event as CustomEvent<WritingDeskUpdatedDetail>).detail
      if (detail.deskId !== desk.id) return
      const outcome = await saveRef.current.applyExternalVersion({ content: detail.proposedContent, revision: detail.revision })
      if (outcome === "conflict") toast.info("Draft accepted. Your unsaved edits are kept here: compare the two versions.")
    }
    window.addEventListener("writing-desk-updated", handleWritingDeskUpdated)
    return () => window.removeEventListener("writing-desk-updated", handleWritingDeskUpdated)
  }, [desk.id])

  function insertSnippet(snippet: string) {
    const element = textareaRef.current
    const current = save.getContent()
    const start = element?.selectionStart ?? current.length
    const end = element?.selectionEnd ?? start
    const before = current.slice(0, start)
    const after = current.slice(end)
    const leading =
      before.length > 0 ? (before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n") : ""
    const trailing =
      after.length > 0 ? (after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n") : ""
    const next = `${before}${leading}${snippet}${trailing}${after}`
    save.onChange(next)
    setMode("markdown")
    setReviewing(false)
    window.requestAnimationFrame(() => {
      const target = textareaRef.current
      if (!target) return
      const position = (before + leading + snippet).length
      target.focus()
      target.setSelectionRange(position, position)
    })
  }

  /**
   * Sets the type of a legacy document that has none (#383). The type is
   * otherwise chosen once, in the "+" dialog, so typed documents can't change it.
   */
  async function chooseType(type: WritingDeskDocumentType) {
    if (documentType || typePending) return
    setTypePending(true)
    try {
      await save.settle()
      if (save.isConflicted()) return
      await applyType(type)
    } finally {
      setTypePending(false)
    }
  }

  async function applyType(type: WritingDeskDocumentType) {
    try {
      const result = await setWritingDeskDocumentType(desk.id, type, save.getRevision())
      if (!result.ok) {
        save.reportConflict(result)
        return
      }
      save.setRevision(result.revision)
      setDocumentType(type)
    } catch {
      toast.error("Couldn't change the document type. Try again.")
    }
  }

  async function chooseSource(cvId: string) {
    const source = sourceCVs.find(item => item.id === cvId)
    if (!source) return
    if (save.getContent().trim() && !window.confirm(`Replace everything in "${name}" with "${source.label}"? Your current text will be lost. The CV itself won't change.`)) return
    await save.quiesce()
    try {
      const result = await setWritingDeskSource(desk.id, cvId, save.getRevision())
      if (!result.ok) {
        save.reportConflict(result)
        return
      }
    } catch {
      toast.error("Couldn't copy that CV. Your document is unchanged.")
      return
    }
    // The server is the source of truth for the Markdown snapshot; reload after selection.
    // Drop the local copy first, or recovery would restore it over the new source.
    save.discardLocalEdits()
    window.location.reload()
  }

  function copyDocument(format: CopyFormat) {
    if (format === "text") void copyText(writingDeskMarkdownToText(save.getContent()), "Plain text")
    else void copyText(save.getContent(), "Markdown")
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`)
    } catch {
      toast.error("Could not copy to the clipboard")
    }
  }

  async function exportPdf() {
    await save.settle()
    if (save.isDirty()) {
      toast.error("Save the document before exporting")
      return
    }
    window.open(writingDeskPdfHref(desk.jobApplication.id, desk.id), "_blank")
  }

  /**
   * Deletes this document (#377). Saving stops first, so no autosave races
   * the delete; on success the server replaces this page with the next
   * document (or Job Description) and the unmount drops this one's edits and
   * recovery copy. Resolves with a message when the document is still there.
   */
  async function deleteDocument(): Promise<string | null> {
    await save.beginDelete()
    try {
      const result = await deleteWritingDeskDocumentAction({ jobId: desk.jobApplication.id, documentId: desk.id }, { openNext: true })
      if (result.ok) return null
      if (result.reason === "not_found") {
        // Already gone (another tab): stop saving to a document that no longer
        // exists, drop its recovery copy, and reload to the not-found state.
        save.abandon()
        router.refresh()
        return result.message
      }
      save.cancelDelete()
      return result.message
    } catch (error) {
      if (isRedirectError(error)) {
        toast.success(`Deleted "${name}"`)
        return null
      }
      save.cancelDelete()
      return "Couldn't delete the document. Check your connection and try again."
    }
  }

  // Returning to the review re-reads the server so the live side of the
  // comparison (and the revision Accept is checked against) includes any
  // edits just made in the live editor.
  function toggleReview() {
    if (!reviewing) router.refresh()
    setReviewing(value => !value)
  }

  const showReview = desk.draft !== null && reviewing

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2">
        <div className="flex w-48 min-w-0 flex-1 basis-48 items-center gap-1">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold" title={name}>{name}</h2>
            {documentType ? (
              <p className="truncate text-xs text-muted-foreground">{documentTypeLabel(documentType)}{sourceLabel ? ` · ${sourceLabel}` : ""}</p>
            ) : (
              // Legacy documents made before types existed: the only place left to set one.
              <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <select
                  aria-label="Document type (not set yet)"
                  value=""
                  disabled={typePending}
                  onChange={event => { if (event.target.value) void chooseType(event.target.value as WritingDeskDocumentType) }}
                  className="h-5 max-w-32 shrink-0 cursor-pointer rounded border border-dashed bg-background px-1 text-xs text-foreground"
                >
                  <option value="" disabled>Set a type…</option>
                  {DOCUMENT_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
                {sourceLabel && <span className="truncate">· {sourceLabel}</span>}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground"
            aria-label={`Rename "${name}"`}
            title="Rename"
            onClick={() => setRenaming(true)}
          >
            <Pencil className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
            aria-label={`Delete "${name}"`}
            title="Delete document"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
        <ReplaceWithCvPicker sources={sourceCVs} onChoose={cvId => void chooseSource(cvId)} />
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setBlocksOpen(true)}>Blocks</Button>
        <div className="flex overflow-hidden rounded-md border text-xs" role="group" aria-label="Editor view">
          <button type="button" aria-pressed={!showReview && mode === "markdown"} onClick={() => { setMode("markdown"); setReviewing(false) }} className={cn("px-3 py-1.5", !showReview && mode === "markdown" ? "bg-foreground text-background" : "text-muted-foreground")}>Markdown</button>
          <button type="button" aria-pressed={!showReview && mode === "preview"} onClick={() => { setMode("preview"); setReviewing(false) }} className={cn("px-3 py-1.5", !showReview && mode === "preview" ? "bg-foreground text-background" : "text-muted-foreground")}>Preview</button>
        </div>
        <SaveStatus state={saveState} onRetry={save.retry} onResolve={() => save.setConflictOpen(true)} />
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => void exportPdf()} title="Download as PDF">
            <Download className="size-3" aria-hidden="true" />
            Export
            <span className="sr-only">as PDF</span>
          </Button>
          <CopyButton onCopy={copyDocument} />
        </div>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={openPanel}><Sparkles className="size-3.5" />Ask coach</Button>
      </div>
      {desk.draft && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <FileCheck2 className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Draft ready for review</p>
              <p className="text-xs text-amber-700/80 dark:text-amber-400/80">An agent prepared a draft for this document. Your live document stays unchanged until you accept it.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={toggleReview}>
            {reviewing ? "Open live editor" : "Back to review"}
          </Button>
        </div>
      )}
      {desk.draft && (
        <div className={cn("flex-1 overflow-y-auto bg-secondary p-5", !showReview && "hidden")}>
          <DraftReview desk={desk} />
        </div>
      )}
      <div className={cn("flex flex-1 overflow-hidden bg-secondary p-3 sm:p-5", showReview && "hidden")}>
        <div className="mx-auto flex w-full max-w-[794px] flex-1 flex-col overflow-y-auto rounded-md bg-background p-5 shadow-sm">
          {mode === "markdown"
            ? <textarea ref={textareaRef} aria-label={`${name}, Markdown`} value={content} onChange={event => save.onChange(event.target.value)} className="min-h-[500px] flex-1 resize-none bg-transparent font-mono text-sm leading-relaxed outline-none" placeholder="Start writing..." />
            : <WritingDeskPreview markdown={content} documentType={documentType} />}
        </div>
      </div>
      <AvailableBlocks open={blocksOpen} onOpenChange={setBlocksOpen} onInsert={insertSnippet} />
      {renaming && (
        <RenameDocumentDialog
          documentId={desk.id}
          name={name}
          onOpenChange={setRenaming}
          onRenamed={next => { setName(next); toast.success("Document renamed") }}
        />
      )}
      {confirmingDelete && (
        <DeleteDocumentDialog
          name={name}
          hasDraft={desk.draft !== null}
          onOpenChange={setConfirmingDelete}
          onConfirm={deleteDocument}
        />
      )}
      <DocumentSaveDialogs save={save} name={name} onCopy={(value, label) => void copyText(value, label)} />
    </div>
  )
}
