"use client"

import { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Download, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { usePageContext, useWorkspaceContext } from "@/lib/context/page-context"
import {
  setWritingDeskDocumentType,
  setWritingDeskSource,
  updateWritingDeskContent,
} from "@/modules/writing-desk/actions"
import { writingDeskMarkdownToText } from "@/modules/writing-desk/markdown"
import type { WritingDeskDocumentType } from "@/modules/writing-desk/schema"
import type { WritingDeskSourceOption, WritingDeskWithJob } from "@/modules/writing-desk/queries"

type SaveState = "idle" | "saving" | "saved" | "failed" | "conflict"

const DOCUMENT_TYPES: Array<{ value: WritingDeskDocumentType; label: string; description: string }> = [
  { value: "cv", label: "CV", description: "A tailored resume or CV" },
  { value: "cover-letter", label: "Cover Letter", description: "A role-specific letter" },
  { value: "interview-prep", label: "Interview Prep", description: "Notes, stories, and preparation" },
  { value: "other", label: "Other", description: "Any other application writing" },
]

function documentTypeLabel(type: WritingDeskDocumentType): string {
  return DOCUMENT_TYPES.find(item => item.value === type)?.label ?? "Writing"
}

export function WritingDesk({
  desk,
  sourceCVs,
}: {
  desk: WritingDeskWithJob
  sourceCVs: WritingDeskSourceOption[]
}) {
  const recoveryKey = `writing-desk-recovery-${desk.id}`
  const [documentType, setDocumentType] = useState(desk.documentType)
  const [content, setContent] = useState(desk.content)
  const [revision, setRevision] = useState(desk.revision)
  const [sourceLabel] = useState(desk.sourceLabel)
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [mode, setMode] = useState<"markdown" | "preview">("markdown")
  const [showExport, setShowExport] = useState(false)
  const contentRef = useRef(desk.content)
  const revisionRef = useRef(desk.revision)
  const pendingValueRef = useRef<string | null>(null)
  const savingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { openPanel } = usePageContext()

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

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const recovered = localStorage.getItem(recoveryKey)
        if (recovered && recovered !== desk.content) {
          setContent(recovered)
          contentRef.current = recovered
          pendingValueRef.current = recovered
          setSaveState("failed")
        }
      } catch {}
    })
    return () => {
      window.cancelAnimationFrame(frame)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [desk.content, recoveryKey])

  useEffect(() => {
    function handleWritingDeskUpdated(event: Event) {
      const detail = (event as CustomEvent<{ deskId: string; proposedContent: string; revision: number }>).detail
      if (detail.deskId !== desk.id) return
      if (timerRef.current) clearTimeout(timerRef.current)
      pendingValueRef.current = null
      contentRef.current = detail.proposedContent
      revisionRef.current = detail.revision
      setContent(detail.proposedContent)
      setRevision(detail.revision)
      setSaveState("saved")
      try { localStorage.removeItem(recoveryKey) } catch {}
    }
    window.addEventListener("writing-desk-updated", handleWritingDeskUpdated)
    return () => window.removeEventListener("writing-desk-updated", handleWritingDeskUpdated)
  }, [desk.id, recoveryKey])

  async function flushSave() {
    if (savingRef.current || pendingValueRef.current === null || saveState === "conflict") return
    const value = pendingValueRef.current
    savingRef.current = true
    setSaveState("saving")
    try {
      const result = await updateWritingDeskContent(desk.id, value, revisionRef.current)
      if (!result.ok) {
        setSaveState("conflict")
        toast.error("This desk changed elsewhere. Your local draft is preserved.")
        return
      }
      revisionRef.current = result.revision
      setRevision(result.revision)
      if (pendingValueRef.current === value) {
        pendingValueRef.current = null
        setSaveState("saved")
        try { localStorage.removeItem(recoveryKey) } catch {}
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
    contentRef.current = value
    pendingValueRef.current = value
    setSaveState("idle")
    try { localStorage.setItem(recoveryKey, value) } catch {}
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void flushSave(), 900)
  }

  async function chooseType(type: WritingDeskDocumentType) {
    if (documentType && documentType !== type && contentRef.current.trim() && !window.confirm("Change the document type? Your Markdown will stay unchanged.")) return
    const result = await setWritingDeskDocumentType(desk.id, type, revisionRef.current)
    if (!result.ok) {
      setSaveState("conflict")
      return
    }
    revisionRef.current = result.revision
    setRevision(result.revision)
    setDocumentType(type)
  }

  async function chooseSource(cvId: string) {
    if (!sourceCVs.some(source => source.id === cvId)) return
    if (contentRef.current.trim() && !window.confirm("Replace the current document with this CV? This cannot be undone.")) return
    const result = await setWritingDeskSource(desk.id, cvId, revisionRef.current)
    if (!result.ok) {
      setSaveState("conflict")
      return
    }
    // The server is the source of truth for the Markdown snapshot; refresh after selection.
    window.location.reload()
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
    if (pendingValueRef.current !== null) {
      await flushSave()
    }
    if (pendingValueRef.current !== null || saveState === "conflict") {
      toast.error("Save the document before exporting")
      return
    }
    window.open(`/api/writing-desk/${desk.jobApplication.id}/pdf`, "_blank")
  }

  function retrySave() {
    if (pendingValueRef.current === null) pendingValueRef.current = contentRef.current
    void flushSave()
  }

  if (!documentType) {
    return (
      <div className="flex flex-1 items-center justify-center bg-secondary p-6">
        <Card className="w-full max-w-2xl">
          <CardHeader>
            <CardTitle>What are you writing?</CardTitle>
            <CardDescription>Choose a document type before starting. Your document remains free-form Markdown.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {DOCUMENT_TYPES.map(type => (
              <button
                key={type.value}
                type="button"
                onClick={() => void chooseType(type.value)}
                className="rounded-lg border p-4 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p className="font-medium">{type.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">{type.description}</p>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  const saveLabel = saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : saveState === "failed" ? "Save failed" : saveState === "conflict" ? "Conflict - reload to continue" : ""

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{desk.jobApplication.title}{desk.jobApplication.company ? ` · ${desk.jobApplication.company}` : ""}</p>
          <p className="text-xs text-muted-foreground">{documentTypeLabel(documentType)}{sourceLabel ? ` · ${sourceLabel}` : ""}</p>
        </div>
        <select
          aria-label="Document type"
          value={documentType}
          onChange={event => void chooseType(event.target.value as WritingDeskDocumentType)}
          className="h-7 rounded-md border bg-background px-2 text-xs"
        >
          {DOCUMENT_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
        </select>
        <select
          aria-label="Source CV"
          value=""
          onChange={event => { if (event.target.value) void chooseSource(event.target.value) }}
          className="h-7 max-w-52 rounded-md border bg-background px-2 text-xs"
        >
          <option value="">Use a previous CV...</option>
          {sourceCVs.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}
        </select>
        <div className="flex overflow-hidden rounded-md border text-xs">
          <button type="button" onClick={() => setMode("markdown")} className={cn("px-3 py-1.5", mode === "markdown" ? "bg-foreground text-background" : "text-muted-foreground")}>Markdown</button>
          <button type="button" onClick={() => setMode("preview")} className={cn("px-3 py-1.5", mode === "preview" ? "bg-foreground text-background" : "text-muted-foreground")}>Preview</button>
        </div>
        {saveLabel && <span className={cn("text-xs", saveState === "failed" || saveState === "conflict" ? "text-destructive" : "text-muted-foreground")}>{saveLabel}</span>}
        {saveState === "failed" && <button type="button" onClick={retrySave} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">Retry</button>}
        <div className="relative">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowExport(value => !value)}><Download className="mr-1 size-3" />Export</Button>
          {showExport && <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border bg-background py-1 shadow-md">
            <button onClick={() => { void exportPdf(); setShowExport(false) }} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted">Download PDF</button>
            <button onClick={() => { void copyText(content, "Markdown"); setShowExport(false) }} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted">Copy Markdown</button>
            <button onClick={() => { void copyText(writingDeskMarkdownToText(content), "Plain text"); setShowExport(false) }} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted">Copy plain text</button>
          </div>}
        </div>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={openPanel}><Sparkles className="size-3.5" />Ask coach</Button>
      </div>
      <div className="flex flex-1 overflow-hidden bg-secondary p-5">
        <div className="mx-auto flex w-full max-w-[794px] flex-1 flex-col overflow-y-auto rounded-md bg-background p-5 shadow-sm">
          {mode === "markdown" ? <textarea value={content} onChange={event => handleChange(event.target.value)} className="min-h-[500px] flex-1 resize-none bg-transparent font-mono text-sm leading-relaxed outline-none" placeholder="Start writing..." /> : <div className="prose prose-sm dark:prose-invert max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content || "*No content yet.*"}</ReactMarkdown></div>}
        </div>
      </div>
    </div>
  )
}
