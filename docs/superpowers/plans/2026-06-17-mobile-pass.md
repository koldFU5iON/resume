# Mobile Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make three pages mobile-usable: CV builder control bar (#90), job applications list (#27), and job view page (#233).

**Architecture:** CV builder and job list are targeted CSS fixes. Job view gets a new `JobMobileView` client component rendered at `md:hidden`; the existing desktop three-column layout is untouched behind `hidden md:flex`.

**Tech Stack:** Next.js 16 App Router, Tailwind CSS v4, shadcn/ui Drawer (Vaul), TypeScript strict.

---

## File Map

| File | Action |
|------|--------|
| `src/app/layout.tsx` | Add `viewport` export with `viewport-fit=cover` |
| `src/app/globals.css` | Add `@utility pb-safe` for `env(safe-area-inset-bottom)` |
| `src/app/dashboard/cv-builder/[id]/_components/cv-editor.tsx` | Wrap button text labels in `hidden sm:inline` |
| `src/app/dashboard/job-applications/_components/filter-bar.tsx` | Verify/fix 375px rendering (likely CSS-only) |
| `src/app/dashboard/job-applications/view/[id]/_components/job-mobile-view.tsx` | **New** — full mobile job view (header, JD, bottom bar, two drawers) |
| `src/app/dashboard/job-applications/view/[id]/page.tsx` | Branch on mobile/desktop with `md:hidden` / `hidden md:flex` |

---

## Task 1: Prerequisites — viewport-fit + pb-safe utility

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`

- [ ] **Add viewport export to layout.tsx**

In `src/app/layout.tsx`, add a `viewport` export above `metadata`:

```tsx
import type { Metadata, Viewport } from 'next'
// ... existing imports

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  // ... unchanged
}
```

- [ ] **Add pb-safe utility to globals.css**

In `src/app/globals.css`, after the existing `@import` lines add:

```css
@utility pb-safe {
  padding-bottom: env(safe-area-inset-bottom);
}
```

- [ ] **Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Commit**

```bash
git add src/app/layout.tsx src/app/globals.css
git commit -m "feat(mobile): add viewport-fit=cover and pb-safe utility"
```

---

## Task 2: CV Builder — icon-only buttons on mobile (#90)

**Files:**
- Modify: `src/app/dashboard/cv-builder/[id]/_components/cv-editor.tsx`

The toolbar has five buttons with text labels. On mobile the title already moves to its own row (`sm:hidden` is in place) but the buttons overflow because each label adds ~60–80px. Fix: wrap every text label in `<span className="hidden sm:inline">`.

- [ ] **Update the Regenerate button** (around line 237)

Find:
```tsx
{isPending
  ? <Loader2 className="size-3.5 animate-spin" />
  : <RotateCcw className="size-3.5" />
}
{isPending ? 'Generating…' : 'Regenerate'}
```

Replace with:
```tsx
{isPending
  ? <Loader2 className="size-3.5 animate-spin" />
  : <RotateCcw className="size-3.5" />
}
<span className="hidden sm:inline">{isPending ? 'Generating…' : 'Regenerate'}</span>
```

- [ ] **Update the Export button** (around line 248)

Find:
```tsx
<Download className="size-3.5" />
Export
```

Replace with:
```tsx
<Download className="size-3.5" />
<span className="hidden sm:inline">Export</span>
```

- [ ] **Update the Discuss button** (around line 276)

Find:
```tsx
<MessageSquare className="size-3.5" />
Discuss
```

Replace with:
```tsx
<MessageSquare className="size-3.5" />
<span className="hidden sm:inline">Discuss</span>
```

- [ ] **Update the Job panel button** (around line 283, conditional render)

Find:
```tsx
Job ▸
```

Replace with:
```tsx
<span className="hidden sm:inline">Job</span> ▸
```

- [ ] **Update the ATS button** (around line 290)

Find:
```tsx
ATS ▸
```

Replace with:
```tsx
<span className="hidden sm:inline">ATS</span> ▸
```

- [ ] **Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Commit**

```bash
git add src/app/dashboard/cv-builder/\[id\]/_components/cv-editor.tsx
git commit -m "fix(mobile): icon-only CV builder toolbar on small screens (#90)"
```

---

## Task 3: Job List — filter bar audit (#27)

**Files:**
- Modify if needed: `src/app/dashboard/job-applications/_components/filter-bar.tsx`

The card/table split is already in place (`md:hidden` / `hidden md:grid`). The filter bar uses `flex flex-wrap items-center gap-2` (line 81) which should wrap. Verify at 375px and fix any overflow.

- [ ] **Start dev server**

```bash
npm run dev
```

- [ ] **Open job applications at 375px width**

Open `http://localhost:3000/dashboard/job-applications` in browser DevTools at 375×812 (iPhone SE). Sign in as `test@example.com` / `password` if needed.

Check:
1. Filter bar wraps cleanly — no horizontal overflow
2. Search input is full width and tappable
3. "Add job" / batch buttons are visible and tappable
4. Card rows render without overflow

- [ ] **Fix any overflow found**

If filter buttons overflow, add `shrink-0` to prevent them collapsing, or add `min-w-0` to the search input wrapper. Common fix if needed:

In `filter-bar.tsx` around line 81, if the search input doesn't fill remaining space:
```tsx
// Change:
<div className="flex flex-wrap items-center gap-2">
// To:
<div className="flex flex-wrap items-center gap-2 min-w-0">
```

And ensure the search `InputGroup` has `className="flex-1 min-w-[140px]"` so it expands but has a floor width.

- [ ] **Commit (only if changes were made)**

```bash
git add src/app/dashboard/job-applications/_components/filter-bar.tsx
git commit -m "fix(mobile): filter bar overflow at 375px (#27)"
```

If no changes are needed, skip the commit and close #27 as already working.

---

## Task 4: Job View — JobMobileView component (#233)

**Files:**
- Create: `src/app/dashboard/job-applications/view/[id]/_components/job-mobile-view.tsx`

This is the main new component. It renders the full mobile experience: header, scrollable JD, sticky bottom action bar, Notes drawer, and Details drawer.

- [ ] **Create job-mobile-view.tsx**

```tsx
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
      {/* max-h-[45dvh]: shrinks to fit above keyboard when it opens (~50% of screen) */}
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
          {/* flex-1 min-h-0: textarea compresses instead of overflowing when keyboard opens */}
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
              <p className="text-sm font-medium">{formatDate(job.dateApplied) ?? 'Not recorded'}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last updated</p>
              <p className="text-sm font-medium">{formatDate(job.lastUpdated) ?? '—'}</p>
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
```

- [ ] **Typecheck**

```bash
npm run typecheck
```

Expected: no errors. If `formatDate` doesn't accept `Date | null | undefined`, check the signature in `src/lib/utils.ts` and adjust the call accordingly.

- [ ] **Commit**

```bash
git add "src/app/dashboard/job-applications/view/[id]/_components/job-mobile-view.tsx"
git commit -m "feat(mobile): add JobMobileView component with JD primary layout and drawers"
```

---

## Task 5: Job View — wire page.tsx (#233)

**Files:**
- Modify: `src/app/dashboard/job-applications/view/[id]/page.tsx`

Replace the current single layout with a mobile/desktop branch. Desktop layout is unchanged.

- [ ] **Update page.tsx**

Replace the entire file content with:

```tsx
import { notFound } from "next/navigation"
import { getJobApplicationById } from "@/modules/jobs/queries"
import { requireProfile } from "@/lib/session"
import { getLLMConfigStatus } from "@/modules/llm/client"
import { JobDetailHeader } from "./_components/job-detail-header"
import { JobSidebar } from "./_components/job-sidebar"
import { JobDescriptionPane } from "./_components/job-description-pane"
import { JobNotesPane } from "./_components/job-notes-pane"
import { JobPageContext } from "./_components/job-page-context"
import { JobMobileView } from "./_components/job-mobile-view"

export default async function ViewJobPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [job, { profile }] = await Promise.all([
    getJobApplicationById(id),
    requireProfile(),
  ])

  if (!job) {
    notFound()
  }

  const { configured: hasLLMKey } = await getLLMConfigStatus(profile.id)

  return (
    <>
      <JobPageContext jobId={job.id} title={job.title} company={job.company} status={job.status} />

      {/* Mobile layout — hidden at md and above */}
      <div className="md:hidden">
        <JobMobileView job={job} hasLLMKey={hasLLMKey} />
      </div>

      {/* Desktop layout — hidden below md, unchanged */}
      <div className="hidden md:flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden">
        <JobDetailHeader job={job} />
        <div className="grid flex-1 grid-cols-[200px_1fr_1fr] overflow-hidden">
          <JobSidebar job={job} hasLLMKey={hasLLMKey} />
          <JobDescriptionPane jobDescription={job.jobDescription} />
          <JobNotesPane jobId={job.id} notes={job.notes} notesIncludeInFit={job.notesIncludeInFit} />
        </div>
      </div>
    </>
  )
}
```

- [ ] **Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Smoke test in browser at 375px**

Open `http://localhost:3000/dashboard/job-applications/view/<any-job-id>` in DevTools at 375×812.

Check:
1. Mobile layout shows (not the three-column desktop layout)
2. JD is readable and scrollable
3. Tap "Notes" → drawer slides up, textarea is editable
4. Focus textarea → keyboard opens, drawer text area stays visible above keyboard
5. Close drawer → notes save (check Network tab for the server action call)
6. Tap "Details ↑" → drawer slides up with status, fit, dates, asset links
7. Switch to full desktop width — three-column layout returns

- [ ] **Commit**

```bash
git add "src/app/dashboard/job-applications/view/[id]/page.tsx"
git commit -m "feat(mobile): responsive job view — JD primary + drawers on mobile (#233)"
```

---

## Task 6: Close issues

- [ ] **Close resolved issues**

```bash
gh issue close 233 --comment "$(cat <<'EOF'
Closing — implemented.

**What shipped:** Mobile layout at `md:hidden` — JD fills the screen as primary content. Header shows title, company, status dropdown, and fit score. "Details ↑" opens a sidebar drawer (status, progress, dates, fit, asset links). Bottom action bar for Notes (editable drawer, keyboard-aware with `max-h-[45dvh]`), CV, Cover Letter, and Interview Prep. Desktop three-column layout unchanged.
EOF
)"

gh issue close 90 --comment "$(cat <<'EOF'
Closing — implemented.

**What shipped:** CV builder toolbar buttons are icon-only on mobile. Text labels wrapped in `hidden sm:inline` — Regenerate, Export, Discuss, Job, ATS buttons all show only their icon below `sm:` breakpoint. Desktop unchanged.
EOF
)"
```

- [ ] **Close or note #27**

If no filter bar changes were needed:
```bash
gh issue close 27 --comment "$(cat <<'EOF'
Closing — the mobile card layout was already in place (JobRowCard via isMobile in job-group.tsx, md:hidden/hidden md:grid in job-list.tsx). Verified filter bar renders cleanly at 375px with no overflow. No structural changes needed.
EOF
)"
```

If filter bar changes were made, the commit message will reference #27 and you can close it with the above.
