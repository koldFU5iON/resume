'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Download, Loader2, RefreshCw, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePageContext, useWorkspaceContext } from '@/lib/context/page-context'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { updateCoverLetterContent } from '@/modules/cover-letters/actions'
import { reviewLetter } from '@/modules/writing-guide/actions'
import { JobAnalysisSchema } from '@/modules/jobs/schema'
import type { CoverLetterWithJob } from '@/modules/cover-letters/queries'
import type { ReviewOutput } from '@/modules/writing-guide/schema'
import { ReviewResults } from '@/app/dashboard/cover-letters/[id]/review/_components/review-results'
import { MarkdownProse } from '@/components/ui/markdown-prose'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type ReviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; review: ReviewOutput }
  | { status: 'error'; message: string }

export function CoverLetterWorkspace({ letter }: { letter: CoverLetterWithJob }) {
  const BRAINDUMP_KEY = `cover-letter-braindump-${letter.id}`
  const [content, setContent] = useState(letter.content)
  const [mode, setMode] = useState<'markdown' | 'preview'>('markdown')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [panelOpen, setPanelOpen] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false)
  const [reviewState, setReviewState] = useState<ReviewState>({ status: 'idle' })
  const [showEditor, setShowEditor] = useState(letter.content !== '')
  const [braindump, setBraindump] = useState(() => {
    try { return localStorage.getItem(BRAINDUMP_KEY) ?? '' } catch { return '' }
  })
  const [showBraindump, setShowBraindump] = useState(() => {
    try { return !!localStorage.getItem(BRAINDUMP_KEY) } catch { return false }
  })
  const isMobile = useIsMobile()
  const router = useRouter()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const braindumpDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedBraindump, setDebouncedBraindump] = useState(braindump)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    return () => {
      mountedRef.current = false
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (braindumpDebounceRef.current) clearTimeout(braindumpDebounceRef.current)
    }
  }, [])

  useEffect(() => {
    function handleCoverLetterUpdated(e: Event) {
      const detail = (e as CustomEvent<{ letterId: string; proposedContent: string }>).detail
      if (detail.letterId !== letter.id) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      setContent(detail.proposedContent)
      setSaveState('saved')
      if (detail.proposedContent.trim()) setShowEditor(true)
    }
    window.addEventListener('cover-letter-updated', handleCoverLetterUpdated)
    return () => window.removeEventListener('cover-letter-updated', handleCoverLetterUpdated)
  }, [letter.id])

  useEffect(() => {
    function handleSectionUpdated(e: Event) {
      const detail = (e as CustomEvent<{ letterId: string; sectionId: string; proposedContent: string; newContent: string }>).detail
      if (detail.letterId !== letter.id) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      setContent(detail.newContent)
      router.refresh()
      setSaveState('saved')
    }
    window.addEventListener('cover-letter-section-updated', handleSectionUpdated)
    return () => window.removeEventListener('cover-letter-section-updated', handleSectionUpdated)
  }, [letter.id, router])

  const save = useCallback(async (value: string) => {
    setSaveState('saving')
    try {
      await updateCoverLetterContent(letter.id, value)
      if (mountedRef.current) setSaveState('saved')
    } catch {
      if (mountedRef.current) setSaveState('error')
    }
  }, [letter.id])

  useEffect(() => {
    if (showEditor && content === '') textareaRef.current?.focus()
  }, [showEditor]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleChange(value: string) {
    setContent(value)
    setSaveState('idle')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => save(value), 1500)
  }

  function handleStartWriting() {
    setShowEditor(true)
  }

  function handleBraindumpChange(value: string) {
    setBraindump(value)
    try { localStorage.setItem(BRAINDUMP_KEY, value) } catch {}
    if (braindumpDebounceRef.current) clearTimeout(braindumpDebounceRef.current)
    braindumpDebounceRef.current = setTimeout(() => setDebouncedBraindump(value), 1500)
  }

  const job = letter.jobApplication
  const analysis = job?.jobAnalysis
    ? JobAnalysisSchema.safeParse(job.jobAnalysis).data ?? null
    : null
  const title = letter.jobTitle ?? job?.title ?? null
  const company = letter.company ?? job?.company ?? null

  const { openPanel } = usePageContext()
  useWorkspaceContext({
    type: 'cover_letter',
    letterId: letter.id,
    company: company ?? undefined,
    braindump: debouncedBraindump.trim() || undefined,
  })

  const saveLabel =
    saveState === 'saving' ? 'Saving…' :
    saveState === 'saved' ? 'Saved' :
    saveState === 'error' ? 'Save failed' :
    ''

  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-')
  const fileSlug = title && company
    ? `Cover-Letter-${safe(title)}_${safe(company)}`
    : title
      ? `Cover-Letter-${safe(title)}`
      : 'Cover-Letter'

  function downloadMarkdown() {
    const blob = new Blob([content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileSlug}.md`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  async function runReview() {
    setReviewState({ status: 'loading' })
    const result = await reviewLetter(letter.id)
    if (result.ok) {
      setReviewState({ status: 'done', review: result.review })
    } else {
      setReviewState({ status: 'error', message: result.message })
    }
  }

  function openReview() {
    setReviewPanelOpen(true)
    if (reviewState.status === 'idle') runReview()
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-4 border-b px-4 py-2">
        {/* Left */}
        <div className="min-w-0 flex-1">
          {title ? (
            <>
              <p className="truncate text-sm font-semibold">
                {title}{company ? ` · ${company}` : ''}
              </p>
              <p className="text-xs text-muted-foreground">Cover Letter</p>
            </>
          ) : (
            <p className="text-sm font-semibold">Cover Letter</p>
          )}
        </div>

        {/* Centre: mode toggle */}
        <div className="flex shrink-0 overflow-hidden rounded-md border text-xs">
          <button
            type="button"
            onClick={() => setMode('markdown')}
            className={cn(
              'px-3 py-1.5 transition-colors',
              mode === 'markdown'
                ? 'bg-foreground font-semibold text-background'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Markdown
          </button>
          <button
            type="button"
            onClick={() => setMode('preview')}
            className={cn(
              'px-3 py-1.5 transition-colors',
              mode === 'preview'
                ? 'bg-foreground font-semibold text-background'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Preview
          </button>
        </div>

        {/* Right */}
        <div className="flex shrink-0 items-center gap-2">
          {saveLabel && (
            <span className={cn(
              'text-xs',
              saveState === 'error' ? 'text-destructive' : 'text-muted-foreground'
            )}>
              {saveLabel}
            </span>
          )}
          <Link
            href={`/dashboard/cover-letters/${letter.id}/guide`}
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ✦ Writing Guide
          </Link>
          <button
            disabled={!content.trim()}
            title={!content.trim() ? 'Write something first' : undefined}
            onClick={() => reviewPanelOpen ? setReviewPanelOpen(false) : openReview()}
            className={cn(
              'flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs',
              content.trim()
                ? reviewPanelOpen
                  ? 'bg-foreground text-background border-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                : 'opacity-40 cursor-not-allowed'
            )}
          >
            ✦ Review
          </button>
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowExport(v => !v)}
            >
              <Download className="size-3 mr-1" />
              Export
            </Button>
            {showExport && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowExport(false)} />
                <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-md border border-border bg-background py-1 shadow-md">
                  <button
                    onClick={() => { window.open(`/api/cover-letters/${letter.id}/pdf`, '_blank'); setShowExport(false) }}
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    Download PDF
                  </button>
                  <button
                    onClick={() => { downloadMarkdown(); setShowExport(false) }}
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    Download Markdown
                  </button>
                  <button
                    onClick={() => { navigator.clipboard.writeText(content).catch(() => {}); setShowExport(false) }}
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    Copy to clipboard
                  </button>
                </div>
              </>
            )}
          </div>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={openPanel}>
            <Sparkles className="size-3.5" />
            Ask coach
          </Button>
          {letter.jobApplicationId && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setPanelOpen(o => !o)}
            >
              Job ▸
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Editor / preview area */}
        <div
          className={cn(
            'flex flex-1 min-w-0 flex-col items-center overflow-y-auto bg-secondary p-5 transition-opacity',
            panelOpen && 'opacity-50'
          )}
        >
          {(() => {
            const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
            const wordCountColor =
              wordCount === 0 ? 'text-muted-foreground' :
              wordCount < 400 ? 'text-destructive' :
              wordCount <= 600 ? 'text-emerald-600 dark:text-emerald-400' :
              'text-amber-500'
            return wordCount > 0 && (
              <p className={`mb-2 text-right text-xs ${wordCountColor}`}>
                {wordCount} words {wordCount < 400 ? '· aim for 400–600' : wordCount > 600 ? '· consider trimming' : '· good length'}
              </p>
            )
          })()}
          <div className="flex w-full max-w-[794px] flex-1 flex-col gap-4">
            <div className="flex flex-1 flex-col rounded-md bg-background p-5 shadow-sm">
            {!showEditor && content === '' ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center">
                <p className="text-sm font-semibold">No cover letter yet</p>
                <p className="max-w-[280px] text-xs text-muted-foreground">
                  Start writing your cover letter for this role, or open the writing guide to help prepare a draft.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleStartWriting}>
                    Start writing
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled
                    title="Coming soon — requires AI to be configured"
                  >
                    Writing guide
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground opacity-50">
                  Writing guide requires AI to be configured
                </p>
              </div>
            ) : mode === 'markdown' ? (
              <textarea
                ref={textareaRef}
                value={content}
                onChange={e => handleChange(e.target.value)}
                className="min-h-[400px] flex-1 w-full resize-none bg-transparent font-mono text-sm leading-relaxed outline-none placeholder:text-muted-foreground/50"
                placeholder="Start writing…"
                autoFocus={showEditor && content === ''}
              />
            ) : (
              <div className="page-break-guides page-break-guides-content prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {content || '*No content yet.*'}
                </ReactMarkdown>
              </div>
            )}
            </div>

            {/* Brain dump — persistent raw notes the AI uses as context */}
            <div className="rounded-md border border-dashed border-border bg-background shadow-sm">
              <button
                type="button"
                onClick={() => setShowBraindump(v => !v)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs text-muted-foreground hover:text-foreground"
              >
                <span className="font-medium">✦ Brain dump</span>
                <span className="text-muted-foreground/60">— raw notes for the AI coach</span>
                <span className="ml-auto">{showBraindump ? '▲' : '▼'}</span>
              </button>
              {showBraindump && (
                <div className="border-t border-border/50 px-4 pb-4 pt-3">
                  <textarea
                    value={braindump}
                    onChange={e => handleBraindumpChange(e.target.value)}
                    rows={5}
                    className="w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground/40"
                    placeholder={
                      "Jot down anything on your mind — why this role caught your eye, a story that proves your fit, " +
                      "what resonates about the company, salary expectations, concerns, questions… " +
                      "The AI coach will use this as context when you ask for help drafting or refining. " +
                      "It won't appear in the letter itself."
                    }
                  />
                  {braindump.trim() && (
                    <p className="mt-1 text-[10px] text-muted-foreground/50">
                      Saved locally · visible to AI coach only
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Review panel — desktop inline column */}
        {reviewPanelOpen && !isMobile && (
          <div className="flex w-[440px] shrink-0 flex-col border-l bg-background overflow-hidden">
            <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
              <span className="text-sm font-semibold">✦ Review</span>
              <button
                type="button"
                onClick={() => setReviewPanelOpen(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close review panel"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {reviewState.status === 'loading' && (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Reviewing…
                </div>
              )}
              {reviewState.status === 'error' && (
                <p className="px-4 py-8 text-sm text-destructive">{reviewState.message}</p>
              )}
              {reviewState.status === 'done' && (
                <ReviewResults review={reviewState.review} />
              )}
            </div>

            <div className="shrink-0 border-t px-4 py-3">
              <button
                onClick={runReview}
                disabled={reviewState.status === 'loading'}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <RefreshCw className="size-3" />
                Re-review
              </button>
            </div>
          </div>
        )}

        {/* Job context panel */}
        {panelOpen && job && (
          <div className="absolute inset-y-0 right-0 z-10 flex w-[42%] min-w-[240px] flex-col border-l bg-background p-4 overflow-y-auto">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">Job Context</span>
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close job context panel"
              >
                <X className="size-4" />
              </button>
            </div>

            <p className="text-sm font-medium">{job.title}</p>
            {job.company && (
              <p className="text-xs text-muted-foreground">{job.company}</p>
            )}
            <p className="mb-3 text-xs text-muted-foreground capitalize">{job.status}</p>

            {analysis ? (
              <>
                {analysis.mustHave.length > 0 && (
                  <div className="mb-3">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      Must-haves
                    </p>
                    {analysis.mustHave.map((item) => (
                      <p key={item} className="text-xs text-muted-foreground">• {item}</p>
                    ))}
                  </div>
                )}
                {analysis.niceToHave.length > 0 && (
                  <div className="mb-3">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      Nice-to-haves
                    </p>
                    {analysis.niceToHave.map((item) => (
                      <p key={item} className="text-xs text-muted-foreground">• {item}</p>
                    ))}
                  </div>
                )}
                {job.jobDescription && (
                  <div className="mb-3">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      Full description
                    </p>
                    <MarkdownProse content={job.jobDescription} />
                  </div>
                )}
              </>
            ) : job.jobDescription ? (
              <div className="mb-3">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  Job Description
                </p>
                <MarkdownProse content={job.jobDescription} />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No job description available.
              </p>
            )}

            <div className="mt-auto border-t pt-3">
              <Link
                href={`/dashboard/job-applications/view/${job.id}`}
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
              >
                View job →
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Mobile review drawer — persistent state, re-review button at bottom */}
      {isMobile && (
        <Drawer open={reviewPanelOpen} onOpenChange={setReviewPanelOpen}>
          <DrawerContent className="flex max-h-[85vh] flex-col">
            <DrawerHeader className="shrink-0">
              <DrawerTitle>✦ Review</DrawerTitle>
            </DrawerHeader>

            <div className="flex-1 overflow-y-auto px-4 pb-2">
              {reviewState.status === 'loading' && (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Reviewing…
                </div>
              )}
              {reviewState.status === 'idle' && (
                <p className="py-8 text-center text-sm text-muted-foreground">No review yet.</p>
              )}
              {reviewState.status === 'error' && (
                <p className="py-8 text-center text-sm text-destructive">{reviewState.message}</p>
              )}
              {reviewState.status === 'done' && (
                <ReviewResults review={reviewState.review} />
              )}
            </div>

            <div className="shrink-0 border-t px-4 py-3">
              <button
                onClick={runReview}
                disabled={reviewState.status === 'loading'}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border py-2 text-sm text-muted-foreground hover:bg-muted disabled:opacity-40"
              >
                <RefreshCw className="size-3.5" />
                {reviewState.status === 'loading' ? 'Reviewing…' : 'Re-review'}
              </button>
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </div>
  )
}
