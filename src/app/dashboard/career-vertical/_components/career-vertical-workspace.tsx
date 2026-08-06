'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Sparkles } from 'lucide-react'
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

  const analysableJobs = useMemo(() => jobs.filter(j => j.jobDescription?.trim()), [jobs])
  const selectedCount = selected.size

  const toggleJob = (id: string) => {
    setError(null)
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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
          <CardTitle>1. Choose your target roles</CardTitle>
          <CardDescription>
            Select the jobs you&apos;re interested in. Currnt analyses their descriptions to surface the hiring pattern behind them. Only jobs with a description can be analysed.
          </CardDescription>
        </CardHeader>
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
            <ul className="divide-y divide-border">
              {jobs.map(job => {
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
          )}
        </CardContent>
        {jobs.length > 0 && (
          <CardFooter className="justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {selectedCount} of {analysableJobs.length} jobs with descriptions selected
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
