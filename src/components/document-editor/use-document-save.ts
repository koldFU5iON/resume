"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useNavigationGuard } from "@/components/job-workspace/navigation-guard"
import { newerSavedVersion, planAcceptedUpdate, type SavedVersion } from "./accepted-update"

/**
 * The save machine behind every long-form editor: debounced autosave against a
 * revision, a recovery copy on this device, conflict handling, an `online`
 * retry, and a save-first navigation guard. Extracted from the Writing Desk so
 * profile notes save the same way (F2, F3). The caller supplies the server
 * call; this hook owns the rest.
 *
 * dirty: edited, save not started yet. failed/conflict keep the edits locally
 * until resolved.
 */
export type SaveState = "idle" | "dirty" | "saving" | "saved" | "failed" | "conflict"

/** What a revision-checked save answers. Structurally the same as WritingDeskSaveResult. */
export type DocumentSaveResult =
  | { ok: true; revision: number }
  | { ok: false; reason: "conflict"; revision: number; content: string }

export type Conflict = SavedVersion
export type ConflictReason = "elsewhere" | "accepted"

export type DocumentSaveOptions = {
  /** localStorage key for unsaved edits; one per document. */
  recoveryKey: string
  initialContent: string
  initialRevision: number
  /** Saves `content` if the saved revision is still `expectedRevision`. Rejects when it can't reach the server. */
  save: (content: string, expectedRevision: number) => Promise<DocumentSaveResult>
  /** The current saved version, to catch a page restored from the router cache that predates later saves. */
  loadLive?: () => Promise<SavedVersion | null>
  /** Used in messages: "This {noun} changed elsewhere." */
  noun?: string
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

export function useDocumentSave({ recoveryKey, initialContent, initialRevision, save, loadLive, noun = "document" }: DocumentSaveOptions) {
  const [content, setContent] = useState(initialContent)
  const [revision, setRevision] = useState(initialRevision)
  const [saveState, setSaveStateValue] = useState<SaveState>("idle")
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)
  /** Why the open conflict happened: a save refused, or a draft accepted over unsaved edits. */
  const [conflictReason, setConflictReason] = useState<ConflictReason>("elsewhere")
  const [leaveRequest, setLeaveRequest] = useState<((leave: boolean) => void) | null>(null)
  const contentRef = useRef(initialContent)
  const revisionRef = useRef(initialRevision)
  const pendingValueRef = useRef<string | null>(null)
  const inflightRef = useRef<Promise<void> | null>(null)
  const conflictRef = useRef(false)
  /** The conflict state, readable from event handlers without waiting for a render. */
  const conflictValueRef = useRef<Conflict | null>(null)
  const saveStateRef = useRef<SaveState>("idle")
  /** Set while this document is being deleted: no saves start, and leaving drops its edits. */
  const deletingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The callbacks change every render; the long-lived effects below read the latest through refs.
  const saveRef = useRef(save)
  const loadLiveRef = useRef(loadLive)
  useEffect(() => {
    saveRef.current = save
    loadLiveRef.current = loadLive
  })

  useEffect(() => { conflictValueRef.current = conflict }, [conflict])

  function setSaveState(state: SaveState) {
    saveStateRef.current = state
    setSaveStateValue(state)
  }

  function setRevisionBoth(next: number) {
    revisionRef.current = next
    setRevision(next)
  }

  function enterConflict(result: Extract<DocumentSaveResult, { ok: false }>) {
    conflictRef.current = true
    setConflict({ revision: result.revision, content: result.content })
    setConflictReason("elsewhere")
    setSaveState("conflict")
  }

  // Once per document: restore unsaved local edits, and check the copy shown is
  // current (a page restored from the client router cache, e.g. via Back, can
  // predate later saves).
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
    })

    loadLiveRef.current?.()
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
        setContent(live.content)
        setRevisionBoth(live.revision)
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
        void saveRef.current(pending, revisionRef.current)
          .then(result => { if (result.ok) clearRecovery(recoveryKey) })
          .catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mounted document
  }, [])

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
        const result = await saveRef.current(value, revisionRef.current)
        if (!result.ok) {
          enterConflict(result)
          toast.error(`This ${noun} changed elsewhere. Your edits are kept here.`)
          return
        }
        setRevisionBoth(result.revision)
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

  /** The user edited the text. */
  function onChange(value: string) {
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

  /** Settles the save in flight, then saves what's pending. */
  async function settle() {
    if (inflightRef.current) await inflightRef.current
    if (pendingValueRef.current !== null) await flushSave()
  }

  function retry() {
    if (pendingValueRef.current === null) pendingValueRef.current = contentRef.current
    void flushSave()
  }

  /** Conflict: save the local text over the newer saved version. */
  async function keepMine() {
    if (!conflict) return
    const value = contentRef.current
    try {
      const result = await saveRef.current(value, conflict.revision)
      if (!result.ok) {
        setConflict({ revision: result.revision, content: result.content })
        toast.error("It changed again. Compare the versions once more.")
        return
      }
      conflictRef.current = false
      setConflict(null)
      setConflictOpen(false)
      setRevisionBoth(result.revision)
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
    setContent(conflict.content)
    setRevisionBoth(conflict.revision)
    setConflict(null)
    setConflictOpen(false)
    setSaveState("saved")
    clearRecovery(recoveryKey)
  }

  /**
   * A newer version was saved from elsewhere in this page (a draft accepted
   * from the Coach card or the review, #378). Settles the save in flight
   * first. Unsaved edits are never overwritten: they stay here, with their
   * recovery copy, and the user compares them with the saved text.
   */
  async function applyExternalVersion(saved: SavedVersion): Promise<"ignored" | "conflict" | "applied"> {
    if (timerRef.current) clearTimeout(timerRef.current)
    // A save that finishes may start another with newer text; let those land too.
    for (let attempt = 0; attempt < 3 && inflightRef.current; attempt++) await inflightRef.current

    const plan = planAcceptedUpdate({
      content: contentRef.current,
      revision: revisionRef.current,
      pending: pendingValueRef.current,
      conflict: conflictRef.current ? conflictValueRef.current : null,
    }, saved)

    if (plan.kind === "ignore") {
      // Edits typed on a newer revision: carry on saving them.
      if (pendingValueRef.current !== null && !conflictRef.current) void flushSave()
      return "ignored"
    }
    if (plan.kind === "conflict") {
      conflictRef.current = true
      setConflict(prev => newerSavedVersion(prev, plan.compareWith))
      setConflictReason("accepted")
      setSaveState("conflict")
      setConflictOpen(true)
      return "conflict"
    }
    pendingValueRef.current = null
    conflictRef.current = false
    setConflict(null)
    contentRef.current = saved.content
    setContent(saved.content)
    setRevisionBoth(saved.revision)
    setSaveState("saved")
    clearRecovery(recoveryKey)
    return "applied"
  }

  /** Stops the autosave timer and waits for a save in flight, without saving what's pending. */
  async function quiesce() {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (inflightRef.current) await inflightRef.current
  }

  /** A save made outside this hook (a changed type, a replaced source) refused: show the conflict. */
  function reportConflict(result: Extract<DocumentSaveResult, { ok: false }>) {
    enterConflict(result)
    setConflictOpen(true)
  }

  /** Drops the local copy once the server holds the text a reload is about to show. */
  function discardLocalEdits() {
    clearRecovery(recoveryKey)
    pendingValueRef.current = null
    setSaveState("saved")
  }

  /** Deleting: no saves start from here until `cancelDelete`, and unmounting drops the edits. */
  async function beginDelete() {
    deletingRef.current = true
    await quiesce()
  }

  /** The delete didn't happen: saving carries on. */
  function cancelDelete() {
    deletingRef.current = false
    if (pendingValueRef.current !== null && !conflictRef.current) void flushSave()
  }

  /** The document is already gone: stop saving to it and drop its recovery copy. */
  function abandon() {
    pendingValueRef.current = null
    clearRecovery(recoveryKey)
  }

  return {
    content,
    revision,
    saveState,
    conflict,
    conflictOpen,
    setConflictOpen,
    conflictReason,
    leaveRequest,
    answerLeave,
    onChange,
    retry,
    keepMine,
    adoptSavedVersion,
    settle,
    isDirty,
    getContent: () => contentRef.current,
    getRevision: () => revisionRef.current,
    isConflicted: () => conflictRef.current,
    setRevision: setRevisionBoth,
    applyExternalVersion,
    quiesce,
    reportConflict,
    discardLocalEdits,
    beginDelete,
    cancelDelete,
    abandon,
  }
}

export type DocumentSave = ReturnType<typeof useDocumentSave>
