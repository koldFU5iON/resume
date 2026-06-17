'use client'

import { useState, useTransition, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, ClipboardList, FileText, Mail, StickyNote } from 'lucide-react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { StatusDropdown } from '@/app/dashboard/job-applications/_components/status-dropdown'
import { JobFit } from '@/app/dashboard/job-applications/_components/job-fit'
import { MarkdownProse } from '@/components/ui/markdown-prose'
import { updateJobNotes } from '@/modules/jobs/mutations'
import { EditJobDialog } from '@/app/dashboard/job-applications/_components/edit-job-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn, formatDate } from '@/lib/utils'
import type { Job } from '@/app/types/job-application'

interface Props {
  job: Job
  hasLLMKey: boolean
}

export function JobMobileView({ job, hasLLMKey }: Props) {
  const [notesOpen, setNotesOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [draft, setDraft] = useState(job.notes ?? '')
  const [includeInFit, setIncludeInFit] = useState(job.notesIncludeInFit)
  const [, startTransition] = useTransition()

  const saveNotes = useCallback(() => {
    startTransition(async () => {
      await updateJobNotes(job.id, draft, includeInFit)
    })
  }, [job.id, draft, includeInFit])

  const handleNotesOpenChange = (open: boolean) => {
    if (!open) saveNotes()
    setNotesOpen(open)
  }

  const cvHref = job.cvDocumentId
    ? `/dashboard/cv-builder/${job.cvDocumentId}`
    : `/dashboard/cv-builder/new?jobId=${job.id}`
  const letterHref = job.coverLetterDocumentId
    ? `/dashboard/cover-letters/${job.coverLetterDocumentId}`
    : `/dashboard/cover-letters/new?jobId=${job.id}`
  const prepHref = job.interviewPrepSessionId
    ? `/dashboard/interview-prep/${job.interviewPrepSessionId}`
    : `/dashboard/interview-prep/new?jobId=${job.id}`

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="shrink-0 border-b bg-background px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <Link
            href="/dashboard/job-applications"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={14} />
            Back
          </Link>
          <button
            onClick={() => setDetailsOpen(true)}
            className="text-sm text-primary hover:underline"
          >
            Details ↑
          </button>
        </div>
        <h1 className="truncate text-base font-semibold leading-tight">{job.title}</h1>
        <p className="truncate text-sm text-muted-foreground">{job.company}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusDropdown jobId={job.id} status={job.status} />
          <JobFit
            jobId={job.id}
            jobFit={job.jobFit ?? null}
            canAssess={!!job.jobDescription?.trim()}
            hasLLMKey={hasLLMKey}
            company={job.company ?? undefined}
            jdSnippet={job.jobDescription ? job.jobDescription.slice(0, 800) : undefined}
          />
        </div>
      </div>

      {/* ── JD — primary scrollable content ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {job.jobDescription?.trim() ? (
          <MarkdownProse content={job.jobDescription} />
        ) : (
          <p className="text-sm text-muted-foreground">No job description added yet.</p>
        )}
      </div>

      {/* ── Bottom action bar ── */}
      <div className="shrink-0 border-t bg-background pb-safe">
        <div className="flex justify-around px-2 py-2">
          <button
            onClick={() => setNotesOpen(true)}
            className="flex flex-col items-center gap-1 rounded-md px-3 py-2 hover:bg-muted"
          >
            <StickyNote size={18} className="text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">Notes</span>
          </button>
          <Link href={cvHref} className="flex flex-col items-center gap-1 rounded-md px-3 py-2 hover:bg-muted">
            <FileText size={18} className="text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">CV</span>
          </Link>
          <Link href={letterHref} className="flex flex-col items-center gap-1 rounded-md px-3 py-2 hover:bg-muted">
            <Mail size={18} className="text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">Letter</span>
          </Link>
          <Link href={prepHref} className="flex flex-col items-center gap-1 rounded-md px-3 py-2 hover:bg-muted">
            <ClipboardList size={18} className="text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">Prep</span>
          </Link>
        </div>
      </div>

      {/* ── Notes drawer ── */}
      {/* max-h-[45dvh]: stays above keyboard when soft keyboard opens */}
      <Drawer open={notesOpen} onOpenChange={handleNotesOpenChange}>
        <DrawerContent className="flex max-h-[45dvh] flex-col">
          <DrawerHeader className="shrink-0 flex items-center justify-between border-b px-4 py-2">
            <DrawerTitle className="text-sm">Notes</DrawerTitle>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeInFit}
                onChange={e => setIncludeInFit(e.target.checked)}
                className="size-3"
              />
              Include in fit
            </label>
          </DrawerHeader>
          {/* flex-1 min-h-0: textarea compresses when keyboard opens */}
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Add notes in Markdown…"
            className="flex-1 min-h-0 resize-none bg-background px-4 py-3 text-sm leading-relaxed focus:outline-none"
          />
        </DrawerContent>
      </Drawer>

      {/* ── Details drawer ── */}
      <Drawer open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DrawerContent className="flex max-h-[70dvh] flex-col">
          <DrawerHeader className="shrink-0 border-b px-4 py-2">
            <DrawerTitle className="truncate text-sm">{job.title}</DrawerTitle>
          </DrawerHeader>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</p>
              <StatusDropdown jobId={job.id} status={job.status} />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Progress</p>
              <p className="text-sm font-medium capitalize">{job.progress}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Applied</p>
              <p className="text-sm font-medium">{formatDate(job.dateApplied, 'Not recorded')}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last updated</p>
              <p className="text-sm font-medium">{formatDate(job.lastUpdated, '—')}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fit Score</p>
              <JobFit
                jobId={job.id}
                jobFit={job.jobFit ?? null}
                canAssess={!!job.jobDescription?.trim()}
                hasLLMKey={hasLLMKey}
                company={job.company ?? undefined}
                jdSnippet={job.jobDescription ? job.jobDescription.slice(0, 800) : undefined}
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Assets</p>
              <Link href={cvHref} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'flex w-full gap-1.5')}>
                <FileText size={13} />
                {job.cvDocumentId ? 'Open CV' : 'Create CV'}
              </Link>
              <Link href={letterHref} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'flex w-full gap-1.5')}>
                <Mail size={13} />
                {job.coverLetterDocumentId ? 'Open cover letter' : 'Create cover letter'}
              </Link>
              <Link href={prepHref} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'flex w-full gap-1.5')}>
                <ClipboardList size={13} />
                {job.interviewPrepSessionId ? 'Open prep' : 'Start prep'}
              </Link>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => { setDetailsOpen(false); setEditOpen(true) }}
            >
              Edit job details
            </Button>
          </div>
        </DrawerContent>
      </Drawer>

      <EditJobDialog job={job} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  )
}
