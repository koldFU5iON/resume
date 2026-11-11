"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  acceptDraftAction,
  discardDraftAction,
  saveDraftContentAction,
} from "@/modules/writing-desk/draft-actions"
import type { WritingDeskWithJob } from "@/modules/writing-desk/queries"
import { CONTACT_PLACEHOLDER, hasContactPlaceholder } from "@/modules/profile-map/contact"

type SaveState = "idle" | "saving" | "saved" | "failed" | "conflict"
type PendingDraft = NonNullable<WritingDeskWithJob["draft"]>

const TOOL_LABELS: Record<string, string> = {
  create_draft: "Agent created the draft",
  replace_section: "Agent replaced a section",
  insert_section: "Agent added a section",
  remove_section: "Agent removed a section",
}

const SEVERITY_STYLES: Record<string, string> = {
  error: "bg-destructive/10 text-destructive",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  info: "bg-muted text-muted-foreground",
}

function formatWhen(date: Date): string {
  return new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

export function DraftReview({ desk }: { desk: WritingDeskWithJob }) {
  if (!desk.draft) return null
  return <DraftReviewPanel desk={desk} draft={desk.draft} />
}

function DraftReviewPanel({ desk, draft }: { desk: WritingDeskWithJob; draft: PendingDraft }) {
  const router = useRouter()
  const [content, setContent] = useState(draft.content)
  const [revision, setRevision] = useState(draft.draftRevision)
  const [seenRevision, setSeenRevision] = useState(draft.draftRevision)
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [serverDraft, setServerDraft] = useState<{ content: string; draftRevision: number } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<"accept" | "discard" | null>(null)
  const contentRef = useRef(draft.content)
  const revisionRef = useRef(draft.draftRevision)
  const pendingValueRef = useRef<string | null>(null)
  const savingRef = useRef(false)
  const conflictRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A refresh brought a newer draft (an agent edit). Adopt it only when the
  // owner has nothing unsaved; otherwise their next save reports the conflict.
  if (draft.draftRevision !== seenRevision) {
    setSeenRevision(draft.draftRevision)
    if (draft.draftRevision > revision && !dirty && saveState !== "saving" && saveState !== "conflict") {
      setContent(draft.content)
      setRevision(draft.draftRevision)
    }
  }

  useEffect(() => {
    contentRef.current = content
    revisionRef.current = revision
  }, [content, revision])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  useEffect(() => {
    function warnOnPendingChanges(event: BeforeUnloadEvent) {
      if (pendingValueRef.current === null && !savingRef.current) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warnOnPendingChanges)
    return () => window.removeEventListener("beforeunload", warnOnPendingChanges)
  }, [])

  // The owner often asks the agent for changes in another tab; pick them up on return.
  useEffect(() => {
    function refreshOnReturn() {
      if (document.visibilityState === "visible") router.refresh()
    }
    document.addEventListener("visibilitychange", refreshOnReturn)
    return () => document.removeEventListener("visibilitychange", refreshOnReturn)
  }, [router])

  async function flushSave() {
    if (savingRef.current || pendingValueRef.current === null || conflictRef.current) return
    const value = pendingValueRef.current
    savingRef.current = true
    setSaveState("saving")
    try {
      const result = await saveDraftContentAction(desk.id, value, revisionRef.current)
      if (!result.ok) {
        if (result.reason === "conflict") {
          conflictRef.current = true
          setServerDraft(result.draft ?? null)
          setSaveState("conflict")
          toast.error("This draft changed elsewhere. Your local draft is preserved.")
          router.refresh()
        } else if (result.reason === "no_draft") {
          pendingValueRef.current = null
          setDirty(false)
          toast.error("This draft was accepted or discarded elsewhere.")
          router.refresh()
        } else {
          setSaveState("failed")
          toast.error(result.message)
        }
        return
      }
      revisionRef.current = result.value.draftRevision
      setRevision(result.value.draftRevision)
      if (pendingValueRef.current === value) {
        pendingValueRef.current = null
        setDirty(false)
        setSaveState("saved")
      }
    } catch {
      setSaveState("failed")
    } finally {
      savingRef.current = false
      if (pendingValueRef.current !== null && pendingValueRef.current !== value) void flushSave()
    }
  }

  function handleChange(value: string) {
    setContent(value)
    setDirty(true)
    contentRef.current = value
    pendingValueRef.current = value
    if (conflictRef.current) {
      // The server moved on. Keep the local draft, but don't try to save over it.
      setSaveState("conflict")
      return
    }
    setSaveState("idle")
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void flushSave(), 900)
  }

  function retrySave() {
    if (pendingValueRef.current === null) pendingValueRef.current = contentRef.current
    void flushSave()
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(contentRef.current)
      toast.success("Local draft copied")
    } catch {
      toast.error("Could not copy to the clipboard")
    }
  }

  function adoptServerDraft(next: { content: string; draftRevision: number }) {
    if (timerRef.current) clearTimeout(timerRef.current)
    pendingValueRef.current = null
    conflictRef.current = false
    contentRef.current = next.content
    revisionRef.current = next.draftRevision
    setContent(next.content)
    setRevision(next.draftRevision)
    setDirty(false)
    setServerDraft(null)
    setSaveState("saved")
  }

  // Conflict recovery: "Copy draft" keeps the local text for a manual merge,
  // "Reload server version" discards it in favour of the newer saved draft.
  function reloadFromServer() {
    const fromProps = { content: draft.content, draftRevision: draft.draftRevision }
    adoptServerDraft(serverDraft && serverDraft.draftRevision > fromProps.draftRevision ? serverDraft : fromProps)
  }

  async function accept() {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (pendingValueRef.current !== null) await flushSave()
    if (pendingValueRef.current !== null || conflictRef.current) {
      toast.error("Save the draft before accepting")
      return
    }
    setBusy("accept")
    try {
      const accepted = contentRef.current
      const result = await acceptDraftAction(desk.id, desk.revision, revisionRef.current)
      if (result.ok) {
        window.dispatchEvent(new CustomEvent("writing-desk-updated", {
          detail: { deskId: desk.id, proposedContent: accepted, revision: result.value.revision },
        }))
        toast.success("Draft accepted. It is now your live document.")
        router.refresh()
        return
      }
      if (result.reason === "conflict" && result.draft) adoptServerDraft(result.draft)
      setNotice(result.reason === "conflict"
        ? "The draft changed since you reviewed it. The latest version is shown below; review it before accepting."
        : result.message)
      toast.error(result.message)
      router.refresh()
    } catch {
      toast.error("Could not accept the draft")
    } finally {
      setBusy(null)
    }
  }

  async function discard() {
    if (!window.confirm("Discard this draft? The agent's draft will be permanently removed, including any edits you made to it. Your live document is not affected. This cannot be undone.")) return
    if (timerRef.current) clearTimeout(timerRef.current)
    pendingValueRef.current = null
    setBusy("discard")
    try {
      const result = await discardDraftAction(desk.id)
      if (result.ok) toast.success("Draft discarded")
      else toast.error(result.message)
      router.refresh()
    } catch {
      toast.error("Could not discard the draft")
    } finally {
      setBusy(null)
    }
  }

  const hasLive = desk.content.trim().length > 0
  const saveLabel = saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : saveState === "failed" ? "Save failed" : saveState === "conflict" ? "Conflict - copy your draft or reload" : ""
  const linkButton = "text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {hasLive
            ? "Accepting replaces the live document with this draft. Compare them below."
            : "The live document is empty, so accepting has nothing to replace."}
          {hasContactPlaceholder(content) && (
            <> <code className="text-xs">{CONTACT_PLACEHOLDER}</code> becomes your contact details from your profile when you accept.</>
          )}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="destructive" size="sm" disabled={busy !== null} onClick={() => void discard()}>
            <Trash2 />Discard
          </Button>
          <Button size="sm" disabled={busy !== null} onClick={() => void accept()}>
            <Check />{busy === "accept" ? "Accepting..." : "Accept draft"}
          </Button>
        </div>
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <p className="text-sm text-amber-700 dark:text-amber-400">{notice}</p>
          <button type="button" onClick={() => setNotice(null)} className={linkButton}>Dismiss</button>
        </div>
      )}

      <div className={cn("grid min-w-0 gap-4", hasLive && "lg:grid-cols-2")}>
        {hasLive && (
          <section aria-label="Live document" className="flex min-w-0 flex-col rounded-md bg-background p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-sm font-semibold">Live document</h2>
              <span className="text-xs text-muted-foreground">Read-only · what accepting replaces</span>
            </div>
            <pre className="h-[60vh] min-h-[320px] overflow-y-auto whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-muted-foreground">{desk.content}</pre>
          </section>
        )}
        <section aria-label="Draft" className="flex min-w-0 flex-col rounded-md bg-background p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-sm font-semibold">Draft</h2>
            <span className="text-xs text-muted-foreground" suppressHydrationWarning>Editable · last changed {formatWhen(draft.updatedAt)}</span>
            <span className="flex-1" />
            {saveLabel && <span className={cn("text-xs", saveState === "failed" || saveState === "conflict" ? "text-destructive" : "text-muted-foreground")}>{saveLabel}</span>}
            {saveState === "failed" && <button type="button" onClick={retrySave} className={linkButton}>Retry</button>}
            {saveState === "conflict" && <>
              <button type="button" onClick={() => void copyDraft()} className={linkButton}>Copy draft</button>
              <button type="button" onClick={reloadFromServer} className={linkButton}>Reload server version</button>
            </>}
          </div>
          {saveState === "conflict" && serverDraft && (
            <details className="mb-3 rounded-md border px-3 py-2 text-xs">
              <summary className="cursor-pointer text-muted-foreground">The draft changed while you were editing (an agent may have edited a section). Show the latest saved version</summary>
              <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-mono leading-relaxed">{serverDraft.content}</pre>
            </details>
          )}
          <textarea
            aria-label="Draft Markdown"
            value={content}
            onChange={event => handleChange(event.target.value)}
            className="h-[60vh] min-h-[320px] resize-none bg-transparent font-mono text-sm leading-relaxed outline-none"
          />
        </section>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <section aria-label="Checks" className="min-w-0 rounded-md bg-background p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Checks</h2>
          <p className="mt-1 text-xs text-muted-foreground">Advisory only. You decide what goes live. These reflect the last saved draft.</p>
          <h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">Fact check</h3>
          {draft.warnings.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No mismatches with your profile found.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {draft.warnings.map((warning, index) => (
                <li key={`${warning.kind}-${index}`} className="rounded-md bg-amber-500/10 px-3 py-2 text-sm">
                  <p className="text-amber-700 dark:text-amber-400">{warning.message}</p>
                  {warning.excerpt && <p className="mt-1 break-words font-mono text-xs text-muted-foreground">{warning.excerpt}</p>}
                </li>
              ))}
            </ul>
          )}
          <h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">Structure notes</h3>
          {draft.issues.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No structural notes.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {draft.issues.map((issue, index) => (
                <li key={`${issue.severity}-${index}`} className="flex items-start gap-2 text-sm">
                  <span className={cn("shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] capitalize", SEVERITY_STYLES[issue.severity])}>{issue.severity}</span>
                  <span className="min-w-0 break-words">{issue.message}{issue.line ? <span className="text-muted-foreground"> (line {issue.line})</span> : null}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Change history" className="min-w-0 rounded-md bg-background p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Change history</h2>
          <p className="mt-1 text-xs text-muted-foreground">Recent agent changes, newest first. Your own edits are not listed.</p>
          {draft.events.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No agent changes recorded.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {draft.events.map((event, index) => (
                <li key={`${event.tool}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <span>{TOOL_LABELS[event.tool] ?? event.tool}</span>
                  <time dateTime={new Date(event.createdAt).toISOString()} className="text-xs text-muted-foreground" suppressHydrationWarning>{formatWhen(event.createdAt)}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
