"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Check, Download, FileCheck2, Loader2, Pencil, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
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
import { cn } from "@/lib/utils"
import { usePageContext, useWorkspaceContext } from "@/lib/context/page-context"
import { useNavigationGuard } from "@/components/job-workspace/navigation-guard"
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
import type { WritingDeskDocumentType, WritingDeskSaveResult } from "@/modules/writing-desk/schema"
import type { WritingDeskSourceOption, WritingDeskWithJob } from "@/modules/writing-desk/queries"
import { WritingDeskPreview } from "@/app/components/writing-desk-preview"
import { planAcceptedUpdate, newerSavedVersion } from "./accepted-update"
import { AvailableBlocks } from "./available-blocks"
import { CopyButton, type CopyFormat } from "./copy-button"
import { DeleteDocumentDialog } from "./delete-document-dialog"
import { DraftReview } from "./draft-review"
import { RenameDocumentDialog } from "./rename-document-dialog"
import { ReplaceWithCvPicker } from "./replace-with-cv-picker"
import { SaveConflictDialog } from "./save-conflict-dialog"

/** dirty: edited, save not started yet. failed/conflict keep the edits locally until resolved. */
type SaveState = "idle" | "dirty" | "saving" | "saved" | "failed" | "conflict"

type Conflict = { revision: number; content: string }

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

/**
 * Unsaved edits kept on this device until they save. Stored with the
 * revision they were based on, so a recovered copy only saves itself when the
 * document hasn't moved on since; otherwise it opens as a conflict.
 */
type Recovery = { content: string; revision: number | null }

function readRecovery(key: string): Recovery | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === "object" && typeof (parsed as Recovery).content === "string") {
        const revision = (parsed as Recovery).revision
        return { content: (parsed as Recovery).content, revision: typeof revision === "number" ? revision : null }
      }
    } catch {}
    // Written before the revision was stored: its base is unknown.
    return { content: raw, revision: null }
  } catch {
    return null
  }
}

function writeRecovery(key: string, recovery: Recovery) {
  try { localStorage.setItem(key, JSON.stringify(recovery)) } catch {}
}

function clearRecovery(key: string) {
  try { localStorage.removeItem(key) } catch {}
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
  const [content, setContent] = useState(desk.content)
  const [revision, setRevision] = useState(desk.revision)
  const [sourceLabel] = useState(desk.sourceLabel)
  const [saveState, setSaveStateValue] = useState<SaveState>("idle")
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)
  /** Why the open conflict happened: a save refused, or a draft accepted over unsaved edits. */
  const [conflictReason, setConflictReason] = useState<"elsewhere" | "accepted">("elsewhere")
  const [leaveRequest, setLeaveRequest] = useState<((leave: boolean) => void) | null>(null)
  const [mode, setMode] = useState<"markdown" | "preview">("markdown")
  const [blocksOpen, setBlocksOpen] = useState(false)
  const [reviewing, setReviewing] = useState(true)
  const contentRef = useRef(desk.content)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const revisionRef = useRef(desk.revision)
  const pendingValueRef = useRef<string | null>(null)
  const inflightRef = useRef<Promise<void> | null>(null)
  const conflictRef = useRef(false)
  /** The conflict state, readable from event handlers without waiting for a render. */
  const conflictValueRef = useRef<Conflict | null>(null)
  const saveStateRef = useRef<SaveState>("idle")
  /** Set while this document is being deleted: no saves start, and leaving drops its edits. */
  const deletingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { openPanel } = usePageContext()
  const router = useRouter()

  useEffect(() => { conflictValueRef.current = conflict }, [conflict])

  function setSaveState(state: SaveState) {
    saveStateRef.current = state
    setSaveStateValue(state)
  }

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

  function enterConflict(result: Extract<WritingDeskSaveResult, { ok: false }>) {
    conflictRef.current = true
    setConflict({ revision: result.revision, content: result.content })
    setConflictReason("elsewhere")
    setSaveState("conflict")
  }

  // Once per document: restore unsaved local edits, focus a just-created
  // document, and check the copy shown is current (a page restored from the
  // client router cache, e.g. via Back, can predate later saves).
  useEffect(() => {
    let cancelled = false
    const frame = window.requestAnimationFrame(() => {
      const recovered = readRecovery(recoveryKey)
      if (recovered && recovered.content !== contentRef.current) {
        const serverContent = contentRef.current
        setContent(recovered.content)
        contentRef.current = recovered.content
        pendingValueRef.current = recovered.content
        if (recovered.revision === revisionRef.current) {
          setSaveState("dirty")
          toast.info("Restored edits from this device that hadn't saved yet.")
          void flushSave()
        } else {
          // The document changed since these edits: let the user choose.
          conflictRef.current = true
          setConflict({ revision: revisionRef.current, content: serverContent })
          setSaveState("conflict")
          setConflictOpen(true)
        }
      } else if (recovered) {
        clearRecovery(recoveryKey)
      }
      try {
        if (sessionStorage.getItem(FOCUS_NEW_DOCUMENT_KEY) === desk.id) {
          sessionStorage.removeItem(FOCUS_NEW_DOCUMENT_KEY)
          textareaRef.current?.focus()
        }
      } catch {}
    })

    getWritingDeskLiveStateAction(desk.id)
      .then(live => {
        if (cancelled || !live || live.revision <= revisionRef.current) return
        if (conflictRef.current) {
          // The page may be a stale router-cache copy: compare against the real saved version.
          setConflict(prev => (prev && live.revision > prev.revision ? { revision: live.revision, content: live.content } : prev))
          return
        }
        // With local edits pending, the next save surfaces this as a conflict instead.
        if (pendingValueRef.current !== null || inflightRef.current || conflictRef.current) return
        contentRef.current = live.content
        revisionRef.current = live.revision
        setContent(live.content)
        setRevision(live.revision)
      })
      .catch(() => {})

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      if (timerRef.current) clearTimeout(timerRef.current)
      // Deleted (#377): its edits went with it, and there's nothing left to save to.
      if (deletingRef.current) {
        clearRecovery(recoveryKey)
        return
      }
      // Leaving by a route the navigation guard can't hold (Back/Forward): send
      // the pending text anyway. Server Actions finish after unmount; an
      // in-flight save already retries with any newer text itself.
      const pending = pendingValueRef.current
      if (pending !== null && !conflictRef.current && !inflightRef.current) {
        void updateWritingDeskContent(desk.id, pending, revisionRef.current)
          .then(result => { if (result.ok) clearRecovery(recoveryKey) })
          .catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mounted document
  }, [])

  // A draft for this document was accepted (Coach card or draft review): the
  // server already holds it as the new saved version (#378). Settle the save
  // in flight first. Unsaved edits are never overwritten: they stay here, with
  // their recovery copy, and the user compares them with the accepted text.
  useEffect(() => {
    async function handleWritingDeskUpdated(event: Event) {
      const detail = (event as CustomEvent<WritingDeskUpdatedDetail>).detail
      if (detail.deskId !== desk.id) return
      if (timerRef.current) clearTimeout(timerRef.current)
      // A save that finishes may start another with newer text; let those land too.
      for (let attempt = 0; attempt < 3 && inflightRef.current; attempt++) await inflightRef.current

      const accepted = { content: detail.proposedContent, revision: detail.revision }
      const plan = planAcceptedUpdate({
        content: contentRef.current,
        revision: revisionRef.current,
        pending: pendingValueRef.current,
        conflict: conflictRef.current ? conflictValueRef.current : null,
      }, accepted)

      if (plan.kind === "ignore") {
        // Edits typed on a newer revision: carry on saving them.
        if (pendingValueRef.current !== null && !conflictRef.current) void flushSave()
        return
      }
      if (plan.kind === "conflict") {
        conflictRef.current = true
        setConflict(prev => newerSavedVersion(prev, plan.compareWith))
        setConflictReason("accepted")
        setSaveState("conflict")
        setConflictOpen(true)
        toast.info("Draft accepted. Your unsaved edits are kept here: compare the two versions.")
        return
      }
      pendingValueRef.current = null
      conflictRef.current = false
      setConflict(null)
      contentRef.current = accepted.content
      revisionRef.current = accepted.revision
      setContent(accepted.content)
      setRevision(accepted.revision)
      setSaveState("saved")
      clearRecovery(recoveryKey)
    }
    window.addEventListener("writing-desk-updated", handleWritingDeskUpdated)
    return () => window.removeEventListener("writing-desk-updated", handleWritingDeskUpdated)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads refs; flushSave only reads refs too
  }, [desk.id, recoveryKey])

  function isDirty() {
    return pendingValueRef.current !== null || inflightRef.current !== null || conflictRef.current
  }

  useEffect(() => {
    function warnOnPendingChanges(event: BeforeUnloadEvent) {
      if (!isDirty()) return
      event.preventDefault()
      event.returnValue = ""
    }
    // A save that failed while offline goes through once the connection is back.
    function retryWhenOnline() {
      if (saveStateRef.current === "failed") void flushSave()
    }
    window.addEventListener("beforeunload", warnOnPendingChanges)
    window.addEventListener("online", retryWhenOnline)
    return () => {
      window.removeEventListener("beforeunload", warnOnPendingChanges)
      window.removeEventListener("online", retryWhenOnline)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads refs only
  }, [])

  useNavigationGuard({ isDirty, settle: settleBeforeLeaving })

  function flushSave(): Promise<void> {
    if (inflightRef.current) return inflightRef.current
    if (pendingValueRef.current === null || conflictRef.current || deletingRef.current) return Promise.resolve()
    if (timerRef.current) clearTimeout(timerRef.current)
    const value = pendingValueRef.current
    setSaveState("saving")
    const run = (async () => {
      let retry = false
      try {
        const result = await updateWritingDeskContent(desk.id, value, revisionRef.current)
        if (!result.ok) {
          enterConflict(result)
          toast.error("This document changed elsewhere. Your edits are kept here.")
          return
        }
        revisionRef.current = result.revision
        setRevision(result.revision)
        if (pendingValueRef.current === value) {
          pendingValueRef.current = null
          setSaveState("saved")
          clearRecovery(recoveryKey)
        } else if (pendingValueRef.current !== null) {
          // Typed more while saving: the newer text builds on the revision just saved.
          writeRecovery(recoveryKey, { content: pendingValueRef.current, revision: result.revision })
          retry = true
        }
      } catch {
        setSaveState("failed")
        retry = pendingValueRef.current !== null && pendingValueRef.current !== value
      } finally {
        inflightRef.current = null
      }
      if (retry) void flushSave()
    })()
    inflightRef.current = run
    return run
  }

  /** For the navigation guard: save what's pending; if that isn't possible, ask. */
  async function settleBeforeLeaving(): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (inflightRef.current) await inflightRef.current
      if (pendingValueRef.current === null || conflictRef.current || saveStateRef.current === "failed") break
      await flushSave()
    }
    if (!isDirty()) return true
    return new Promise<boolean>(resolve => setLeaveRequest(() => resolve))
  }

  function answerLeave(leave: boolean) {
    leaveRequest?.(leave)
    setLeaveRequest(null)
  }

  function handleChange(value: string) {
    setContent(value)
    contentRef.current = value
    pendingValueRef.current = value
    writeRecovery(recoveryKey, { content: value, revision: revisionRef.current })
    if (conflictRef.current) {
      // The server moved on. Keep the local edits, but don't try to save over it.
      setSaveState("conflict")
      return
    }
    setSaveState("dirty")
    if (deletingRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void flushSave(), 900)
  }

  function insertSnippet(snippet: string) {
    const element = textareaRef.current
    const start = element?.selectionStart ?? contentRef.current.length
    const end = element?.selectionEnd ?? start
    const before = contentRef.current.slice(0, start)
    const after = contentRef.current.slice(end)
    const leading =
      before.length > 0 ? (before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n") : ""
    const trailing =
      after.length > 0 ? (after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n") : ""
    const next = `${before}${leading}${snippet}${trailing}${after}`
    handleChange(next)
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
      await settleSaves()
      if (conflictRef.current) return
      await applyType(type)
    } finally {
      setTypePending(false)
    }
  }

  async function applyType(type: WritingDeskDocumentType) {
    try {
      const result = await setWritingDeskDocumentType(desk.id, type, revisionRef.current)
      if (!result.ok) {
        enterConflict(result)
        setConflictOpen(true)
        return
      }
      revisionRef.current = result.revision
      setRevision(result.revision)
      setDocumentType(type)
    } catch {
      toast.error("Couldn't change the document type. Try again.")
    }
  }

  async function chooseSource(cvId: string) {
    const source = sourceCVs.find(item => item.id === cvId)
    if (!source) return
    if (contentRef.current.trim() && !window.confirm(`Replace everything in "${name}" with "${source.label}"? Your current text will be lost. The CV itself won't change.`)) return
    if (timerRef.current) clearTimeout(timerRef.current)
    if (inflightRef.current) await inflightRef.current
    try {
      const result = await setWritingDeskSource(desk.id, cvId, revisionRef.current)
      if (!result.ok) {
        enterConflict(result)
        setConflictOpen(true)
        return
      }
    } catch {
      toast.error("Couldn't copy that CV. Your document is unchanged.")
      return
    }
    // The server is the source of truth for the Markdown snapshot; reload after selection.
    // Drop the local copy first, or recovery would restore it over the new source.
    clearRecovery(recoveryKey)
    pendingValueRef.current = null
    setSaveState("saved")
    window.location.reload()
  }

  function copyDocument(format: CopyFormat) {
    if (format === "text") void copyText(writingDeskMarkdownToText(contentRef.current), "Plain text")
    else void copyText(contentRef.current, "Markdown")
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
    if (pendingValueRef.current !== null || inflightRef.current) await settleSaves()
    if (isDirty()) {
      toast.error("Save the document before exporting")
      return
    }
    window.open(writingDeskPdfHref(desk.jobApplication.id, desk.id), "_blank")
  }

  async function settleSaves() {
    if (inflightRef.current) await inflightRef.current
    if (pendingValueRef.current !== null) await flushSave()
  }

  function retrySave() {
    if (pendingValueRef.current === null) pendingValueRef.current = contentRef.current
    void flushSave()
  }

  /** Conflict: save the local text over the newer saved version. */
  async function keepMine() {
    if (!conflict) return
    const value = contentRef.current
    try {
      const result = await updateWritingDeskContent(desk.id, value, conflict.revision)
      if (!result.ok) {
        setConflict({ revision: result.revision, content: result.content })
        toast.error("It changed again. Compare the versions once more.")
        return
      }
      conflictRef.current = false
      setConflict(null)
      setConflictOpen(false)
      revisionRef.current = result.revision
      setRevision(result.revision)
      if (pendingValueRef.current === value || pendingValueRef.current === null) {
        pendingValueRef.current = null
        setSaveState("saved")
        clearRecovery(recoveryKey)
      } else {
        void flushSave()
      }
      toast.success("Saved your version")
    } catch {
      toast.error("Couldn't save. Check your connection and try again.")
    }
  }

  /** Conflict: drop the local text for the newer saved version. */
  function adoptSavedVersion() {
    if (!conflict) return
    if (timerRef.current) clearTimeout(timerRef.current)
    conflictRef.current = false
    pendingValueRef.current = null
    contentRef.current = conflict.content
    revisionRef.current = conflict.revision
    setContent(conflict.content)
    setRevision(conflict.revision)
    setConflict(null)
    setConflictOpen(false)
    setSaveState("saved")
    clearRecovery(recoveryKey)
  }

  /**
   * Deletes this document (#377). Saving stops first, so no autosave races
   * the delete; on success the server replaces this page with the next
   * document (or Job Description) and the unmount drops this one's edits and
   * recovery copy. Resolves with a message when the document is still there.
   */
  async function deleteDocument(): Promise<string | null> {
    deletingRef.current = true
    if (timerRef.current) clearTimeout(timerRef.current)
    if (inflightRef.current) await inflightRef.current
    try {
      const result = await deleteWritingDeskDocumentAction({ jobId: desk.jobApplication.id, documentId: desk.id }, { openNext: true })
      if (result.ok) return null
      if (result.reason === "not_found") {
        // Already gone (another tab): stop saving to a document that no longer
        // exists, drop its recovery copy, and reload to the not-found state.
        pendingValueRef.current = null
        clearRecovery(recoveryKey)
        router.refresh()
        return result.message
      }
      deletingRef.current = false
      resumeSaving()
      return result.message
    } catch (error) {
      if (isRedirectError(error)) {
        toast.success(`Deleted "${name}"`)
        return null
      }
      deletingRef.current = false
      resumeSaving()
      return "Couldn't delete the document. Check your connection and try again."
    }
  }

  function resumeSaving() {
    if (pendingValueRef.current !== null && !conflictRef.current) void flushSave()
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
        <SaveStatus state={saveState} onRetry={retrySave} onResolve={() => setConflictOpen(true)} />
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
            ? <textarea ref={textareaRef} aria-label={`${name}, Markdown`} value={content} onChange={event => handleChange(event.target.value)} className="min-h-[500px] flex-1 resize-none bg-transparent font-mono text-sm leading-relaxed outline-none" placeholder="Start writing..." />
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
      <SaveConflictDialog
        open={conflictOpen && conflict !== null}
        reason={conflictReason}
        onOpenChange={setConflictOpen}
        mine={content}
        saved={conflict?.content ?? ""}
        onKeepMine={keepMine}
        onUseSaved={adoptSavedVersion}
        onCopy={(value, label) => void copyText(value, label)}
      />
      <AlertDialog open={leaveRequest !== null} onOpenChange={open => { if (!open) answerLeave(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Your latest edits aren&apos;t saved</AlertDialogTitle>
            <AlertDialogDescription>
              {saveState === "conflict"
                ? `"${name}" changed elsewhere, so your edits weren't saved.`
                : `Saving "${name}" failed.`}{" "}
              Your edits stay on this device and come back when you reopen this document.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => answerLeave(true)}>Leave anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SaveStatus({ state, onRetry, onResolve }: { state: SaveState; onRetry: () => void; onResolve: () => void }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-7 items-center gap-1.5 text-xs">
      {state === "dirty" && <span className="text-muted-foreground">Unsaved changes</span>}
      {state === "saving" && <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="size-3 animate-spin" aria-hidden="true" />Saving…</span>}
      {state === "saved" && <span className="flex items-center gap-1 text-muted-foreground"><Check className="size-3" aria-hidden="true" />Saved</span>}
      {state === "failed" && <>
        <span className="flex items-center gap-1 text-destructive" title="Your edits are kept on this device until they save"><AlertTriangle className="size-3" aria-hidden="true" />Couldn&apos;t save</span>
        <button type="button" onClick={onRetry} className="text-muted-foreground underline underline-offset-2 hover:text-foreground">Retry</button>
      </>}
      {state === "conflict" && <>
        <span className="flex items-center gap-1 text-destructive"><AlertTriangle className="size-3" aria-hidden="true" />Changed elsewhere</span>
        <button type="button" onClick={onResolve} className="text-muted-foreground underline underline-offset-2 hover:text-foreground">Resolve…</button>
      </>}
    </div>
  )
}
