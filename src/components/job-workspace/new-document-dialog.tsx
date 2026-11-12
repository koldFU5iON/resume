"use client"

import { useEffect, useId, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { writingDeskDocumentHref } from "@/modules/jobs/workspace-nav"
import { createWritingDeskDocumentAction, listWritingDeskSourceCVsAction } from "@/modules/writing-desk/actions"
import type { WritingDeskSourceOption } from "@/modules/writing-desk/queries"
import {
  MAX_WRITING_DESK_DOCUMENT_NAME_LENGTH,
  WritingDeskDocumentNameSchema,
  suggestWritingDeskDocumentName,
  type WritingDeskDocumentType,
} from "@/modules/writing-desk/schema"
import { guardedNavigate } from "./navigation-guard"

/** The editor focuses its text area when it opens a document it was just asked to (see WritingDesk). */
export const FOCUS_NEW_DOCUMENT_KEY = "writing-desk-focus-new"

const TYPE_OPTIONS: Array<{ value: WritingDeskDocumentType; label: string }> = [
  { value: "cv", label: "CV" },
  { value: "cover-letter", label: "Cover letter" },
  { value: "interview-prep", label: "Interview prep" },
  { value: "other", label: "Other (notes, anything else)" },
]

export const nativeSelectClass =
  "h-9 w-full min-w-0 appearance-none truncate rounded-lg border border-input bg-background pr-8 pl-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"

type SourcesState = { status: "loading" | "failed" } | { status: "ready"; sources: WritingDeskSourceOption[] }

/**
 * Render only while open, so each opening starts fresh.
 *
 * "+" → type, name, start from → Create (#371). Creates a separate Writing
 * Desk document on the job and opens it in its own tab. No LLM involved, so
 * it works without an API key. Starting from a CV copies that CV's text; the
 * CV itself is never changed.
 */
export function NewDocumentDialog({
  jobId,
  existingNames,
  open,
  onOpenChange,
}: {
  jobId: string
  existingNames: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const ids = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const [documentType, setDocumentType] = useState<WritingDeskDocumentType>("cv")
  const [name, setName] = useState(() => suggestWritingDeskDocumentName("cv", existingNames))
  const [nameEdited, setNameEdited] = useState(false)
  const [sourceCvId, setSourceCvId] = useState("")
  const [sources, setSources] = useState<SourcesState>({ status: "loading" })
  const [error, setError] = useState<{ field: "name" | "form"; message: string } | null>(null)
  const [pending, startTransition] = useTransition()

  function fetchSources() {
    listWritingDeskSourceCVsAction()
      .then(list => setSources({ status: "ready", sources: list }))
      .catch(() => setSources({ status: "failed" }))
  }

  // Mounted fresh for each opening (the nav renders it only while open).
  useEffect(fetchSources, [])

  function retrySources() {
    setSources({ status: "loading" })
    fetchSources()
  }

  function handleOpenChange(next: boolean) {
    if (pending && !next) return
    onOpenChange(next)
  }

  function changeType(type: WritingDeskDocumentType) {
    setDocumentType(type)
    // Follow the type until the user has typed a name of their own.
    if (!nameEdited) setName(suggestWritingDeskDocumentName(type, existingNames))
    if (type !== "cv") setSourceCvId("")
    setError(null)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = WritingDeskDocumentNameSchema.safeParse(name)
    if (!parsed.success) {
      setError({ field: "name", message: parsed.error.issues[0]?.message ?? "Check the name" })
      nameRef.current?.focus()
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const result = await createWritingDeskDocumentAction({
          jobId,
          name: parsed.data,
          documentType,
          sourceCvId: documentType === "cv" && sourceCvId ? sourceCvId : null,
        })
        if (!result.ok) {
          setError({ field: result.reason === "invalid" ? "name" : "form", message: result.message })
          return
        }
        try { sessionStorage.setItem(FOCUS_NEW_DOCUMENT_KEY, result.id) } catch {}
        onOpenChange(false)
        // The document exists either way; leaving the current one still saves (or asks) first.
        await guardedNavigate(() => router.push(writingDeskDocumentHref(jobId, result.id)))
      } catch {
        setError({ field: "form", message: "Couldn't create the document. Check your connection and try again." })
      }
    })
  }

  const nameError = error?.field === "name" ? error.message : null
  const formError = error?.field === "form" ? error.message : null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent initialFocus={nameRef} className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>New document</DialogTitle>
            <DialogDescription>A separate document for this application. It opens in its own tab; your other documents stay as they are.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <label htmlFor={`${ids}-type`} className="text-sm font-medium">Document type</label>
            <div className="relative">
              <select
                id={`${ids}-type`}
                value={documentType}
                onChange={event => changeType(event.target.value as WritingDeskDocumentType)}
                disabled={pending}
                className={nativeSelectClass}
              >
                {TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            </div>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor={`${ids}-name`} className="text-sm font-medium">Name</label>
            <Input
              ref={nameRef}
              id={`${ids}-name`}
              value={name}
              onChange={event => { setName(event.target.value); setNameEdited(true); if (nameError) setError(null) }}
              maxLength={MAX_WRITING_DESK_DOCUMENT_NAME_LENGTH}
              autoComplete="off"
              required
              disabled={pending}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? `${ids}-name-error` : `${ids}-name-hint`}
              className="h-9"
            />
            {nameError
              ? <p id={`${ids}-name-error`} className="text-xs text-destructive">{nameError}</p>
              : <p id={`${ids}-name-hint`} className="text-xs text-muted-foreground">Shown on the tab and used for the PDF file name. You can rename it later.</p>}
          </div>

          {documentType === "cv" && (
            <div className="grid gap-1.5">
              <label htmlFor={`${ids}-source`} className="text-sm font-medium">Start from</label>
              <div className="relative">
                <select
                  id={`${ids}-source`}
                  value={sourceCvId}
                  onChange={event => setSourceCvId(event.target.value)}
                  disabled={pending}
                  aria-describedby={`${ids}-source-hint`}
                  className={nativeSelectClass}
                >
                  <option value="">Blank document</option>
                  {sources.status === "ready" && sources.sources.map(source => (
                    <option key={source.id} value={source.id}>{source.label}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              </div>
              <p id={`${ids}-source-hint`} className="text-xs text-muted-foreground" aria-live="polite">
                {sources.status === "loading" ? "Loading your CVs…"
                  : sources.status === "failed" ? <>Couldn&apos;t load your CVs. <button type="button" onClick={retrySources} className="underline underline-offset-2 hover:text-foreground">Try again</button></>
                  : sources.status === "ready" && sources.sources.length === 0 ? "You have no saved CVs yet, so this starts blank."
                  : "Copies the CV's text into this document. The CV itself isn't changed."}
              </p>
            </div>
          )}

          {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}

          <DialogFooter className="mt-1">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending} className={cn(pending && "gap-2")}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {pending ? "Creating…" : "Create document"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
