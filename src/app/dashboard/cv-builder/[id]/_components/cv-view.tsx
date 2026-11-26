'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Copy, Download, Loader2, MessageSquare, Undo2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { usePageContext, useWorkspaceContext } from '@/lib/context/page-context'
import { WritingDeskPreview } from '@/app/components/writing-desk-preview'
import { markCVAccepted, unmarkCVAccepted } from '@/modules/cv/actions'
import { runATSScore } from '@/modules/cv/ats-score-action'
import type { ATSScoreResult } from '@/modules/cv/ats-score-schema'
import { toMarkdown, toText } from '@/modules/cv/export'
import type { CVWithMeta } from '@/modules/cv/types'
import { jobWritingDeskHref } from '@/modules/jobs/workspace-nav'
import { copyCvToWritingDeskAction } from '@/modules/writing-desk/actions'
import { ATSScorePanel } from './ats-score-panel'

/**
 * An old CV Builder CV, read-only (#469). Editing happens in the writing
 * desk: "Copy to writing desk" makes a new document on the CV's job from it,
 * and the old CV stays as it is. Export, the ATS check, the accepted mark
 * and the coach (read-only) stay here.
 */
export function CvView({ cv, markdown, stale = false }: { cv: CVWithMeta; markdown: string; stale?: boolean }) {
  const [status, setStatus] = useState(cv.status)
  const [acceptPending, setAcceptPending] = useState(false)
  const [copying, setCopying] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [atsPanelOpen, setAtsPanelOpen] = useState(false)
  const [atsResult, setAtsResult] = useState<ATSScoreResult | null>(null)
  const [atsRunning, setAtsRunning] = useState(false)
  const isAccepted = status === 'accepted'
  const deskHref = cv.jobApplicationId ? jobWritingDeskHref(cv.jobApplicationId) : null
  const { openPanel } = usePageContext()
  const router = useRouter()
  useWorkspaceContext({ type: 'cv', cvId: cv.id, title: cv.jobTitle ?? 'CV', company: cv.company ?? undefined })

  const displayTitle = cv.jobTitle && cv.company ? `${cv.jobTitle} · ${cv.company}` : cv.jobTitle ?? 'CV'
  const nameSlug = cv.profileName.replace(/\s+/g, '-')
  const fileSlug = cv.jobTitle && cv.company
    ? `${nameSlug}-CV-${cv.jobTitle.replace(/\s+/g, '-')}_${cv.company.replace(/\s+/g, '-')}`
    : `${nameSlug}-CV`

  async function copyToDesk() {
    setCopying(true)
    try {
      const result = await copyCvToWritingDeskAction(cv.id)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success('Copied to the writing desk. This CV is unchanged.')
      router.push(result.href)
    } catch {
      toast.error("Couldn't copy this CV. Try again.")
    } finally {
      setCopying(false)
    }
  }

  async function toggleAccepted() {
    setAcceptPending(true)
    try {
      if (isAccepted) {
        await unmarkCVAccepted(cv.id)
        setStatus('draft')
        toast.success('CV moved back to draft')
      } else {
        await markCVAccepted(cv.id)
        setStatus('accepted')
        toast.success('CV marked as accepted')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the CV')
    } finally {
      setAcceptPending(false)
    }
  }

  async function runAts() {
    setAtsRunning(true)
    try {
      const res = await runATSScore(cv.id)
      if (res.ok) setAtsResult(res.result)
      else toast.error(res.message)
    } catch {
      toast.error('ATS check failed. Please try again.')
    } finally {
      setAtsRunning(false)
    }
  }

  function downloadFile(fileContent: string, filename: string, mime: string) {
    const url = URL.createObjectURL(new Blob([fileContent], { type: mime }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-4 py-2">
        <div className="mr-auto flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold">{displayTitle}</span>
          <Badge variant="outline" className="shrink-0 text-xs capitalize">{status}</Badge>
          <Badge variant="secondary" className="shrink-0 text-xs">Read-only</Badge>
        </div>
        {cv.jobApplicationId && (
          <button
            onClick={() => void copyToDesk()}
            disabled={copying}
            className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-50"
          >
            {copying ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
            Copy to writing desk
          </button>
        )}
        {cv.jobApplicationId && (isAccepted || status === 'draft') && (
          <button
            onClick={() => void toggleAccepted()}
            disabled={acceptPending}
            title={isAccepted ? 'Move this CV back to draft' : 'Mark this as the CV you are sending for this job'}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            {acceptPending ? <Loader2 className="size-3.5 animate-spin" /> : isAccepted ? <Undo2 className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
            {isAccepted ? 'Back to draft' : 'Mark accepted'}
          </button>
        )}
        <div className="relative">
          <button onClick={() => setShowExport(v => !v)} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted">
            <Download className="size-3.5" />
            Export
          </button>
          {showExport && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowExport(false)} />
              <div className="absolute right-0 top-full z-20 w-40 rounded-md border border-border bg-background py-1 shadow-md">
                <button onClick={() => { window.open(`/api/cv/${cv.id}/pdf`, '_blank'); setShowExport(false) }} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted">Download PDF</button>
                <button onClick={() => { downloadFile(toMarkdown(cv.content), `${fileSlug}.md`, 'text/markdown'); setShowExport(false) }} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted">Download Markdown</button>
                <button onClick={() => { downloadFile(toText(cv.content), `${fileSlug}.txt`, 'text/plain'); setShowExport(false) }} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted">Download Text</button>
              </div>
            </>
          )}
        </div>
        <button onClick={() => setAtsPanelOpen(o => !o)} className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted">ATS ▸</button>
        <button onClick={openPanel} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted">
          <MessageSquare className="size-3.5" />
          Discuss
        </button>
      </div>

      <div className="relative flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto bg-secondary p-3 sm:p-5">
          <div className="mx-auto mb-4 max-w-[794px] space-y-3">
            <p role="note" className="rounded-md border bg-background px-4 py-3 text-sm text-muted-foreground">
              This CV is from the old CV Builder and can no longer be edited.{' '}
              {cv.jobApplicationId
                ? 'Copy it to the writing desk to keep working on it; this copy stays as it is.'
                : 'To reuse it, pick it as the starting point when you add a CV document to a job.'}
            </p>
            {stale && deskHref && (
              <p role="note" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                Your master CV changed since this CV was tailored.{' '}
                <Link href={deskHref} className="font-medium underline underline-offset-2">Generate a fresh CV in the writing desk</Link>.
              </p>
            )}
          </div>
          <div className="mx-auto w-full max-w-[794px] rounded-md bg-background p-5 shadow-sm">
            {markdown.trim()
              ? <WritingDeskPreview markdown={markdown} documentType="cv" />
              : <p className="py-16 text-center text-sm text-muted-foreground">This CV has no content.</p>}
          </div>
        </div>
        {atsPanelOpen && (
          <div className="absolute inset-y-0 right-0 z-10 flex w-[42%] min-w-[260px] max-w-[480px] flex-col overflow-y-auto border-l bg-background p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">ATS Score</span>
              <button type="button" onClick={() => setAtsPanelOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close ATS panel">
                <X className="size-4" />
              </button>
            </div>
            <ATSScorePanel
              cvId={cv.id}
              cvTitle={cv.jobTitle ?? 'CV'}
              cvCompany={cv.company}
              hasJobDescription={Boolean(cv.jobApplication?.jobDescription)}
              result={atsResult}
              isPending={atsRunning}
              onRun={() => void runAts()}
            />
          </div>
        )}
      </div>
    </div>
  )
}
