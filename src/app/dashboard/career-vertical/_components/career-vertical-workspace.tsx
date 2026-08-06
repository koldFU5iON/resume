'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronDown, Loader2, Search, Sparkles } from 'lucide-react'
import type { CareerVertical } from '@prisma/client'
import { analyseCareerVertical, generateMasterCV } from '@/modules/career-vertical/actions'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { cn, formatDate } from '@/lib/utils'

type CandidateJob = {
  id: string
  title: string
  company: string | null
  jobDescription: string | null
  status: string
  lastUpdated: Date
}

type MasterCV = {
  id: string
  status: string
  updatedAt: Date
}

const THREAD_GROUPS: {
  key: 'businessProblems' | 'responsibilities' | 'outcomes' | 'competencies'
  title: string
  description: string
}[] = [
  {
    key: 'businessProblems',
    title: 'Business problems',
    description: 'The recurring problems these roles exist to solve.',
  },
  {
    key: 'responsibilities',
    title: 'Responsibilities',
    description: 'The recurring day-to-day work these roles demand.',
  },
  {
    key: 'outcomes',
    title: 'Outcomes',
    description: 'The recurring results these roles are expected to deliver.',
  },
  {
    key: 'competencies',
    title: 'Skills & competencies',
    description: 'The recurring capabilities these roles require.',
  },
]

const STATUS_BADGE: Record<string, { label: string; variant: 'success' | 'info' | 'destructive' | 'secondary' }> = {
  none: { label: 'Not analysed', variant: 'secondary' },
  analysing: { label: 'Analysing…', variant: 'info' },
  ready: { label: 'Ready', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
}

const PAGE_SIZE = 20

export function CareerVerticalWorkspace({
  initialVertical,
  jobs,
  masterCV,
}: {
  initialVertical: CareerVertical | null
  jobs: CandidateJob[]
  masterCV: MasterCV | null
}) {
  const router = useRouter()
  const [vertical, setVertical] = useState<CareerVertical | null>(initialVertical)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialVertical?.sourceJobIds ?? []))
  const [error, setError] = useState<string | null>(null)
  const [isAnalysing, startAnalyse] = useTransition()
  const [isGenerating, startGenerate] = useTransition()
  const [listOpen, setListOpen] = useState(true)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const analysableJobs = useMemo(() => jobs.filter(j => j.jobDescription?.trim()), [jobs])
  const selectedCount = selected.size

  const matchesQuery = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return jobs
    return jobs.filter(j => {
      const title = j.title.toLowerCase()
      const company = j.company?.toLowerCase() ?? ''
      return title.includes(q) || company.includes(q)
    })
  }, [jobs, query])

  const analysableMatches = useMemo(
    () => matchesQuery.filter(j => j.jobDescription?.trim()),
    [matchesQuery],
  )

  const totalPages = Math.max(1, Math.ceil(matchesQuery.length / PAGE_SIZE))
  const pageJobs = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return matchesQuery.slice(start, start + PAGE_SIZE)
  }, [matchesQuery, page])

  const toggleJob = (id: string) => {
    setError(null)
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllMatching = () => {
    setError(null)
    setSelected(prev => {
      const next = new Set(prev)
      for (const job of analysableMatches) next.add(job.id)
      return next
    })
  }

  const clearSelection = () => {
    setError(null)
    setSelected(new Set())
  }

  const handleAnalyse = () => {
    if (selectedCount === 0) return
    setError(null)
    startAnalyse(async () => {
      const res = await analyseCareerVertical([...selected])
      if (!res.ok) {
        setError(res.message)
        return
      }
      setVertical(prev => ({
        ...(prev ?? ({} as CareerVertical)),
        ...res.analysis,
        sourceJobIds: [...selected],
        status: 'ready',
        analysedAt: new Date(),
      }))
      router.refresh()
    })
  }

  const handleGenerateMaster = () => {
    setError(null)
    startGenerate(async () => {
      const res = await generateMasterCV()
      if (!res.ok) {
        setError(res.message)
        return
      }
      router.push(`/dashboard/cv-builder/${res.cvId}`)
    })
  }

  const status = vertical?.status ?? 'none'
  const statusBadge = STATUS_BADGE[status] ?? STATUS_BADGE.none
  const ready = status === 'ready' && Boolean(vertical?.thesis)
  const canAnalyse = analysableJobs.length > 0 && selectedCount > 0 && !isAnalysing

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
        {ready && vertical?.analysedAt && (
          <span className="text-xs text-muted-foreground">
            Analysed {formatDate(vertical.analysedAt)} · {vertical.sourceJobIds.length} target roles
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Step 1 — analyse target roles */}
      <Card>
        <CardHeader>
          <button
            type="button"
            onClick={() => setListOpen(v => !v)}
            className="flex w-full items-start justify-between gap-2 text-left"
            aria-expanded={listOpen}
          >
            <div className="min-w-0">
              <CardTitle>1. Choose your target roles</CardTitle>
              <CardDescription>
                Select the jobs you&apos;re interested in. Currnt analyses their descriptions to surface the hiring pattern behind them. Only jobs with a description can be analysed.
              </CardDescription>
            </div>
            <ChevronDown
              className={cn(
                'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200',
                !listOpen && '-rotate-90',
              )}
            />
          </button>
        </CardHeader>
        {listOpen && (
          <CardContent>
            {jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No job applications yet. Add some from{' '}
                <Link href="/dashboard/job-applications" className="underline underline-offset-2">
                  Applications
                </Link>{' '}
                first — the more target roles you include, the sharper the analysis.
              </p>
            ) : (
              <>
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={e => {
                        setQuery(e.target.value)
                        setPage(1)
                      }}
                      placeholder="Search by title or company — e.g. 'program manager'"
                      className="pl-8"
                      disabled={isAnalysing}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    {analysableMatches.length > 0 && (
                      <Button size="sm" variant="outline" onClick={selectAllMatching} disabled={isAnalysing}>
                        Select all {analysableMatches.length}
                      </Button>
                    )}
                    {selectedCount > 0 && (
                      <Button size="sm" variant="ghost" onClick={clearSelection} disabled={isAnalysing}>
                        Clear
                      </Button>
                    )}
                  </div>
                </div>
                <ul className="divide-y divide-border">
                  {pageJobs.map(job => {
                    const hasDescription = Boolean(job.jobDescription?.trim())
                    return (
                      <li key={job.id} className="flex items-center gap-3 py-2.5">
                        <Checkbox
                          id={`job-${job.id}`}
                          checked={selected.has(job.id)}
                          onCheckedChange={() => hasDescription && toggleJob(job.id)}
                          disabled={!hasDescription || isAnalysing}
                          aria-label={`Select ${job.title}`}
                        />
                        <label
                          htmlFor={`job-${job.id}`}
                          className={cn(
                            'flex min-w-0 flex-1 items-center justify-between gap-2 text-sm',
                            hasDescription ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
                          )}
                        >
                          <span className="truncate font-medium">
                            {job.company ? `${job.title} · ${job.company}` : job.title}
                          </span>
                          {!hasDescription && <span className="shrink-0 text-xs text-muted-foreground">no description</span>}
                        </label>
                      </li>
                    )
                  })}
                </ul>
                {totalPages > 1 && (
                  <div className="mt-3 flex items-center justify-between">
                    <Button size="sm" variant="ghost" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || isAnalysing}>
                      Previous
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Page {page} of {totalPages}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages || isAnalysing}>
                      Next
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        )}
        {jobs.length > 0 && (
          <CardFooter className="justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {selectedCount} of {analysableJobs.length} jobs with descriptions selected
              {query.trim() && ` · ${matchesQuery.length} matching`}
            </span>
            <Button size="sm" onClick={handleAnalyse} disabled={!canAnalyse}>
              {isAnalysing && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              {isAnalysing
                ? 'Analysing…'
                : selectedCount > 0
                  ? `Analyse ${selectedCount} job${selectedCount === 1 ? '' : 's'}`
                  : 'Analyse selected'}
            </Button>
          </CardFooter>
        )}
      </Card>

      {/* Step 2-3 — threads + thesis */}
      {status !== 'none' && !ready && (
        <Card>
          <CardContent className="flex items-center gap-3 py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {status === 'failed'
                ? 'The analysis failed. Select your target roles above and try again.'
                : 'Identifying the common business problems, responsibilities, outcomes and competencies across your target roles…'}
            </p>
          </CardContent>
        </Card>
      )}

      {ready && vertical && (
        <>
          {/* Step 3 — career thesis */}
          <Card className="border-violet-500/30 bg-violet-500/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-violet-500" />
                Career thesis
              </CardTitle>
              <CardDescription>
                The business problems you consistently solve — your professional identity, not your job titles.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed">{vertical.thesis}</p>
            </CardContent>
          </Card>

          {/* Step 2 — common threads */}
          <div className="grid gap-4 md:grid-cols-2">
            {THREAD_GROUPS.map(group => (
              <Card key={group.key} size="sm">
                <CardHeader>
                  <CardTitle>{group.title}</CardTitle>
                  <CardDescription>{group.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="flex flex-wrap gap-1.5">
                    {vertical[group.key].map(item => (
                      <li
                        key={item}
                        className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Step 4 — master CV */}
          <Card>
            <CardHeader>
              <CardTitle>4. Build your master CV</CardTitle>
              <CardDescription>
                A canonical CV organised around your career thesis — the strongest evidence only. Role-specific CVs are then tailored from this identity, keeping your positioning consistent.
              </CardDescription>
            </CardHeader>
            <CardFooter className="justify-between gap-3">
              {masterCV ? (
                <span className="text-xs text-muted-foreground">
                  Master CV {masterCV.status} · last updated {formatDate(masterCV.updatedAt)}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Generating one master CV keeps it as your single source of truth.</span>
              )}
              <div className="flex gap-2">
                {masterCV && (
                  <Link
                    href={`/dashboard/cv-builder/${masterCV.id}`}
                    className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))}
                  >
                    Open master CV
                  </Link>
                )}
                <Button size="sm" onClick={handleGenerateMaster} disabled={isGenerating}>
                  {isGenerating && <Loader2 className="mr-1.5 size-4 animate-spin" />}
                  {isGenerating ? 'Generating…' : masterCV ? 'Regenerate master CV' : 'Generate master CV'}
                </Button>
              </div>
            </CardFooter>
          </Card>
        </>
      )}
    </div>
  )
}
