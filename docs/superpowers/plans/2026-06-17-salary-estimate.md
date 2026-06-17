# Salary Estimate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable `<SalaryEstimate>` component that extracts or AI-estimates a salary range from a job description, persists the result, and renders in both the job sidebar and the job list row card.

**Architecture:** A single LLM call sweeps the JD for an explicit salary first, then estimates if nothing is found — returning a structured `SalaryEstimate` object with a `source` field (`'extracted'` | `'estimated'`) that drives distinct UI treatment. The result is persisted to `JobApplication.salaryEstimate` (JSON column) so re-renders are instant; the component manages local state for immediate post-generation feedback.

**Tech Stack:** Next.js 16 App Router, Prisma 7, Zod, shadcn/ui (Tooltip, Button), Tailwind v4, Vitest

---

## File Map

| File | Role |
|------|------|
| `prisma/schema/jobs.prisma` | Add `salaryEstimate Json?` + `salaryEstimatedAt DateTime?` |
| `prisma/migrations/` | Migration created by `npm run db:migrate` |
| `src/modules/jobs/schema.ts` | Add `SalaryEstimateSchema` + `SalaryEstimate` type |
| `src/modules/jobs/schema.test.ts` | Tests for `SalaryEstimateSchema` |
| `src/app/types/job-application.ts` | Add `SalaryEstimate` type + extend `Job` |
| `src/modules/jobs/salary-estimate.ts` | **New** — `'use server'` action |
| `src/app/dashboard/job-applications/_components/salary-estimate.tsx` | **New** — reusable client component |
| `src/app/dashboard/job-applications/view/[id]/_components/job-sidebar.tsx` | Add Salary card between Fit Score and Application Assets |
| `src/app/dashboard/job-applications/_components/job-row-card.tsx` | Add compact `<SalaryEstimate>` in metadata chips row |
| `src/app/dashboard/settings/usage/_components/usage-log.tsx` | Add `'salary-estimate'` to `FEATURE_LABELS` |

---

## Task 1: Prisma schema + migration

**Files:**
- Modify: `prisma/schema/jobs.prisma` (after `jobAnalysedAt DateTime?` on line ~22)

- [ ] **Step 1: Add two fields to the Prisma schema**

In `prisma/schema/jobs.prisma`, add the two new fields immediately after `jobAnalysedAt DateTime?`:

```prisma
  jobAnalysedAt       DateTime?
  salaryEstimate      Json?
  salaryEstimatedAt   DateTime?
```

- [ ] **Step 2: Create and apply the migration**

```bash
npm run db:migrate -- --name add_salary_estimate
```

Expected output: `✔ Generated Prisma Client` and a new timestamped folder under `prisma/migrations/`.

- [ ] **Step 3: Verify the migration applied**

```bash
npm run db:studio
```

Open Prisma Studio, navigate to `JobApplication`, and confirm `salaryEstimate` and `salaryEstimatedAt` columns are present. Close Studio when done.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema/jobs.prisma prisma/migrations/
git commit -m "feat: add salaryEstimate + salaryEstimatedAt to JobApplication"
```

---

## Task 2: Zod schema + TypeScript types

**Files:**
- Modify: `src/modules/jobs/schema.ts`
- Modify: `src/modules/jobs/schema.test.ts`
- Modify: `src/app/types/job-application.ts`

- [ ] **Step 1: Write failing schema tests**

Add to `src/modules/jobs/schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { JobFitSchema, SalaryEstimateSchema } from "./schema"

// ... existing JobFitSchema tests ...

describe("SalaryEstimateSchema", () => {
  const extracted = {
    min: 70000,
    max: 90000,
    currency: "GBP",
    source: "extracted",
  }

  const estimated = {
    min: 60000,
    max: 80000,
    currency: "USD",
    source: "estimated",
    confidence: "medium",
    reasoning: "Based on the seniority level and London market rates.",
  }

  it("accepts a fully stated extracted range", () => {
    expect(SalaryEstimateSchema.safeParse(extracted).success).toBe(true)
  })

  it("accepts null min (only ceiling stated)", () => {
    expect(
      SalaryEstimateSchema.safeParse({ ...extracted, min: null }).success
    ).toBe(true)
  })

  it("accepts null max (only floor stated)", () => {
    expect(
      SalaryEstimateSchema.safeParse({ ...extracted, max: null }).success
    ).toBe(true)
  })

  it("accepts a full estimated range with reasoning", () => {
    expect(SalaryEstimateSchema.safeParse(estimated).success).toBe(true)
  })

  it("accepts estimated without reasoning (optional)", () => {
    const { reasoning, ...noReasoning } = estimated
    expect(SalaryEstimateSchema.safeParse(noReasoning).success).toBe(true)
  })

  it("rejects unknown source values", () => {
    expect(
      SalaryEstimateSchema.safeParse({ ...extracted, source: "guessed" }).success
    ).toBe(false)
  })

  it("rejects unknown confidence values", () => {
    expect(
      SalaryEstimateSchema.safeParse({ ...estimated, confidence: "very-high" }).success
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npm test -- --reporter=verbose src/modules/jobs/schema.test.ts
```

Expected: `SalaryEstimateSchema` tests fail with `SalaryEstimateSchema is not exported`.

- [ ] **Step 3: Add `SalaryEstimateSchema` to schema.ts**

In `src/modules/jobs/schema.ts`, add after `export type JobAnalysis = z.infer<typeof JobAnalysisSchema>` and before `export const SOURCE_OPTIONS`:

```typescript
export const SalaryEstimateSchema = z.object({
  min:        z.number().nullable(),
  max:        z.number().nullable(),
  currency:   z.string(),
  source:     z.enum(['extracted', 'estimated']),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
  reasoning:  z.string().optional(),
})

export type SalaryEstimate = z.infer<typeof SalaryEstimateSchema>
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npm test -- --reporter=verbose src/modules/jobs/schema.test.ts
```

Expected: all `SalaryEstimateSchema` tests pass.

- [ ] **Step 5: Add `SalaryEstimate` type and extend `Job` in `job-application.ts`**

In `src/app/types/job-application.ts`, add `SalaryEstimate` after the existing `JobFit` type (line ~81), and extend `Job` to include the new field:

```typescript
export type SalaryEstimate = {
  min:         number | null
  max:         number | null
  currency:    string
  source:      'extracted' | 'estimated'
  confidence?: 'low' | 'medium' | 'high'
  reasoning?:  string
}
```

Then update the `Job` type union to include the new field:

```typescript
export type Job = Omit<JobApplication, "status" | "progress" | "jobFit" | "applicationSource"> & {
  status: ApplicationStatusType
  progress: ApplicationProgressType
  jobFit?: JobFit | null
  applicationSource: ApplicationSourceType
  cvDocumentId?: string | null
  coverLetterDocumentId?: string | null
  interviewPrepSessionId?: string | null
  salaryEstimate?: SalaryEstimate | null
}
```

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/jobs/schema.ts src/modules/jobs/schema.test.ts src/app/types/job-application.ts
git commit -m "feat: add SalaryEstimateSchema and SalaryEstimate types"
```

---

## Task 3: Server action

**Files:**
- Create: `src/modules/jobs/salary-estimate.ts`

- [ ] **Step 1: Create the server action file**

Create `src/modules/jobs/salary-estimate.ts` with this complete content:

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { completeStructured } from '@/modules/llm/client'
import { LLMError, type LLMErrorKind } from '@/modules/llm/errors'
import { normalizeSearchProfile } from '@/modules/search-profile/schema'
import { SalaryEstimateSchema, type SalaryEstimate } from './schema'

type EstimateSalaryResult =
  | { ok: true; estimate: SalaryEstimate }
  | { ok: false; error: 'no_description' | 'not_found' | LLMErrorKind; message: string }

export async function estimateSalary(jobId: string): Promise<EstimateSalaryResult> {
  const { profile } = await requireProfile()

  const job = await prisma.jobApplication.findFirst({
    where: { id: jobId, profileId: profile.id },
    select: { id: true, title: true, company: true, countries: true, jobDescription: true },
  })

  if (!job) return { ok: false, error: 'not_found', message: 'Job not found' }
  if (!job.jobDescription?.trim()) {
    return {
      ok: false,
      error: 'no_description',
      message: 'Add a job description first — salary estimation needs it.',
    }
  }

  const settings = await prisma.userSettings.findUnique({
    where: { profileId: profile.id },
    select: { searchProfile: true },
  })
  const searchProfile = normalizeSearchProfile(settings?.searchProfile)
  const userCurrency = searchProfile.salaryBand?.currency ?? 'GBP'

  const locationContext = job.countries?.join(', ') ?? ''

  const prompt = `You are a compensation analyst. Analyse this job description to determine the salary range.

**Step 1 — Scan for explicit salary information:**
Look for any stated salary, compensation, pay, or total cash (e.g. "$120,000–$150,000", "up to £80,000", "€90k base", "salary from 100k", etc.).

If found → return:
- source: "extracted"
- min and max from the stated range (use null if only one bound is given)
- currency from the stated symbol or code
- Omit confidence and reasoning

**Step 2 — If no salary is stated (or only vague language: "competitive", "market rate", "DOE", "TBC", "negotiable"):**
Estimate based on job title, seniority, company, location, and required skills. Return:
- source: "estimated"
- min and max as annual base salary in whole numbers
- currency inferred from the job's country/region (UK→GBP, US→USD, Canada→CAD, Germany/France/EU→EUR, Australia→AUD). The user's preferred currency (${userCurrency}) is a secondary hint only — if the job is clearly in a different market, use that market's currency.
- confidence: "high" (clear signals: well-known company, common role, explicit seniority), "medium" (reasonable inference), "low" (limited context)
- reasoning: 1–2 sentences explaining your estimate (≤80 words)
${locationContext ? `\n**Location context:** ${locationContext}` : ''}

**Job description:**
${job.jobDescription.slice(0, 4000)}`

  let estimate: SalaryEstimate
  try {
    const result = await completeStructured(profile.id, prompt, SalaryEstimateSchema, {
      maxOutputTokens: 300,
      temperature: 0.1,
      feature: 'salary-estimate',
    })
    estimate = result.object
  } catch (err) {
    if (err instanceof LLMError) {
      return { ok: false, error: err.kind, message: err.message }
    }
    throw err
  }

  await prisma.jobApplication.update({
    where: { id: jobId },
    data: { salaryEstimate: estimate, salaryEstimatedAt: new Date() },
  })

  revalidatePath('/dashboard/job-applications')
  revalidatePath(`/dashboard/job-applications/view/${jobId}`)

  return { ok: true, estimate }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/jobs/salary-estimate.ts
git commit -m "feat: add estimateSalary server action"
```

---

## Task 4: SalaryEstimate component

**Files:**
- Create: `src/app/dashboard/job-applications/_components/salary-estimate.tsx`

- [ ] **Step 1: Create the component**

Create `src/app/dashboard/job-applications/_components/salary-estimate.tsx` with this complete content:

```typescript
'use client'

import { useState, useTransition } from 'react'
import { Loader2, Info, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { estimateSalary } from '@/modules/jobs/salary-estimate'
import { notifyUsageUpdated } from '@/lib/usage-events'
import type { SalaryEstimate as SalaryEstimateType } from '@/app/types/job-application'

type Props = {
  jobId: string
  initialEstimate: SalaryEstimateType | null
  hasJD: boolean
  hasLLMKey: boolean
  compact?: boolean
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$',
}

function formatRange(estimate: SalaryEstimateType): string {
  const sym = CURRENCY_SYMBOLS[estimate.currency] ?? estimate.currency
  const fmt = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
  const prefix = estimate.source === 'estimated' ? '~' : ''
  if (estimate.min !== null && estimate.max !== null) {
    return `${prefix}${sym}${fmt(estimate.min)}–${sym}${fmt(estimate.max)}`
  }
  if (estimate.min !== null) return `${prefix}${sym}${fmt(estimate.min)}+`
  if (estimate.max !== null) return `${prefix}up to ${sym}${fmt(estimate.max)}`
  return `${prefix}${sym}?`
}

export function SalaryEstimate({ jobId, initialEstimate, hasJD, hasLLMKey, compact = false }: Props) {
  const [estimate, setEstimate] = useState<SalaryEstimateType | null>(initialEstimate)
  const [isPending, startTransition] = useTransition()
  const [expanded, setExpanded] = useState(false)

  function handleEstimate() {
    if (isPending) return
    startTransition(async () => {
      const result = await estimateSalary(jobId)
      if (result.ok) {
        setEstimate(result.estimate)
        notifyUsageUpdated()
      } else {
        toast.error(result.message, {
          action: result.error === 'not_configured'
            ? { label: 'Set up', onClick: () => { window.location.href = '/dashboard/settings/llm' } }
            : undefined,
        })
      }
    })
  }

  if (isPending) {
    return (
      <div className={cn(
        "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
        compact ? "h-5" : "h-6 px-1",
      )}>
        <Loader2 className="size-3 animate-spin" />
        {!compact && 'Estimating...'}
      </div>
    )
  }

  if (estimate) {
    const rangeText = formatRange(estimate)
    const isEstimated = estimate.source === 'estimated'

    if (compact) {
      return (
        <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
          {rangeText}
          {isEstimated && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info size={10} className="cursor-help text-muted-foreground/60" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-56 text-xs">
                AI-estimated range — not stated in the job listing
              </TooltipContent>
            </Tooltip>
          )}
        </span>
      )
    }

    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{rangeText}</span>
          {isEstimated && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info size={12} className="cursor-help text-muted-foreground/60" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-64 text-xs">
                AI-estimated range — not stated in the job listing
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {isEstimated && estimate.confidence && (
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-xs capitalize",
              estimate.confidence === 'high'   ? 'text-green-600 dark:text-green-400' :
              estimate.confidence === 'medium' ? 'text-amber-600 dark:text-amber-400' :
              'text-muted-foreground',
            )}>
              {estimate.confidence} confidence
            </span>
            {estimate.reasoning && (
              <button
                type="button"
                onClick={() => setExpanded(e => !e)}
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                {expanded ? 'less' : 'why?'}
              </button>
            )}
          </div>
        )}
        {expanded && estimate.reasoning && (
          <p className="text-xs leading-relaxed text-muted-foreground">{estimate.reasoning}</p>
        )}
      </div>
    )
  }

  // No estimate yet
  if (!hasLLMKey) {
    if (compact) return null
    return (
      <Link
        href="/dashboard/settings/llm"
        className="text-xs text-muted-foreground underline hover:text-foreground"
      >
        Set up AI to estimate
      </Link>
    )
  }

  if (!hasJD) {
    if (compact) return null
    return (
      <button
        type="button"
        disabled
        title="Add a job description first"
        className="inline-flex h-6 cursor-not-allowed items-center gap-1.5 rounded-md bg-muted px-2 text-xs text-muted-foreground opacity-40"
      >
        <TrendingUp size={11} />
        estimate salary
      </button>
    )
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleEstimate}
        title="Estimate salary"
        className="text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
      >
        est. salary
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={handleEstimate}
      className="inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-2 text-xs text-primary-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <TrendingUp size={11} />
      estimate salary
    </button>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/job-applications/_components/salary-estimate.tsx
git commit -m "feat: add SalaryEstimate component"
```

---

## Task 5: Wire into job sidebar

**Files:**
- Modify: `src/app/dashboard/job-applications/view/[id]/_components/job-sidebar.tsx`

- [ ] **Step 1: Add the Salary card to the sidebar**

In `src/app/dashboard/job-applications/view/[id]/_components/job-sidebar.tsx`:

Add the import at the top alongside existing imports:

```typescript
import { SalaryEstimate } from '@/app/dashboard/job-applications/_components/salary-estimate'
```

Then add a new Card between the Fit Score card (ending at line ~64) and the Application Assets section (starting at line ~66). Insert it so the order is: Stats → Fit Score → **Salary** → Application Assets:

```tsx
{/* Salary card */}
<Card>
  <CardContent className="flex flex-col gap-2 pt-4">
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {job.salaryEstimate?.source === 'estimated' ? 'Salary estimate' : 'Salary'}
    </p>
    <SalaryEstimate
      jobId={job.id}
      initialEstimate={job.salaryEstimate ?? null}
      hasJD={!!job.jobDescription?.trim()}
      hasLLMKey={hasLLMKey}
    />
  </CardContent>
</Card>
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. If TypeScript complains about `job.salaryEstimate`, confirm `salaryEstimate?: SalaryEstimate | null` was added to the `Job` type in Task 2 Step 5.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/job-applications/view/[id]/_components/job-sidebar.tsx
git commit -m "feat: add salary estimate card to job sidebar"
```

---

## Task 6: Wire into job row card (compact)

**Files:**
- Modify: `src/app/dashboard/job-applications/_components/job-row-card.tsx`

- [ ] **Step 1: Add the compact SalaryEstimate to the row card**

In `src/app/dashboard/job-applications/_components/job-row-card.tsx`:

Add the import at the top:

```typescript
import { SalaryEstimate } from './salary-estimate'
```

Update the destructured fields (currently line ~38) to include `salaryEstimate`:

```typescript
const {
  id, jobNumber, title, company, countries, url,
  dateApplied, datePublished, lastUpdated, status, progress,
  jobFit, notes, notesIncludeInFit, applicationSource,
  jobDescription, salaryBand, salaryEstimate,
} = job
```

In the metadata chips row (Row 3, currently line ~144–160), add the compact `<SalaryEstimate>` immediately after `<JobFit>`:

```tsx
{/* Row 3: metadata chips */}
<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 items-center">
  {salaryBand && (
    <span className="text-xs text-muted-foreground">{salaryBand}</span>
  )}
  <JobFit
    jobId={id}
    jobFit={jobFit ?? null}
    canAssess={!!jobDescription?.trim()}
    hasLLMKey={hasLLMKey}
    company={company ?? undefined}
    jdSnippet={jobDescription ? jobDescription.slice(0, 800) : undefined}
  />
  <SalaryEstimate
    jobId={id}
    initialEstimate={salaryEstimate ?? null}
    hasJD={!!jobDescription?.trim()}
    hasLLMKey={hasLLMKey}
    compact
  />
  {dateApplied && (
    <span className="text-xs text-muted-foreground">{formatShortDate(dateApplied)}</span>
  )}
  <PostingAge
    datePublished={datePublished ?? null}
    dateApplied={dateApplied ?? null}
    status={status}
  />
  <FreshnessChip lastUpdated={lastUpdated} status={status} />
  <JobNotes jobId={id} initialNotes={notes ?? null} initialIncludeInFit={notesIncludeInFit} />
</div>
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/job-applications/_components/job-row-card.tsx
git commit -m "feat: add compact salary estimate to job row card"
```

---

## Task 7: Usage label + final checks

**Files:**
- Modify: `src/app/dashboard/settings/usage/_components/usage-log.tsx`

- [ ] **Step 1: Register the feature label**

In `src/app/dashboard/settings/usage/_components/usage-log.tsx`, add `'salary-estimate'` to the `FEATURE_LABELS` map (currently starting at line 14). Add it after `'job-fit'`:

```typescript
const FEATURE_LABELS: Record<string, string> = {
  'job-fit': 'Job fit',
  'salary-estimate': 'Salary estimate',
  // ... rest of existing labels ...
}
```

- [ ] **Step 2: Run full typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests pass, including the new `SalaryEstimateSchema` tests.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/settings/usage/_components/usage-log.tsx
git commit -m "feat: register salary-estimate in usage feature labels"
```

---

## Manual smoke test

Start the dev server and verify end-to-end:

```bash
npm run dev
```

1. Open a job with a job description at `/dashboard/job-applications/view/<id>`
2. In the sidebar, find the new **Salary** / **Salary estimate** card between Fit Score and Application Assets
3. Click **estimate salary** — confirm the spinner appears then the range renders
4. If the JD contained a salary, confirm `source: 'extracted'` renders without `~` prefix or tooltip
5. If AI-estimated, confirm `~` prefix, info icon tooltip, confidence label, and "why?" expand work
6. Navigate to `/dashboard/job-applications` — confirm the compact estimate appears in the metadata chip row after the fit score chip
7. On a job with no JD: confirm the button is disabled in sidebar and nothing renders in compact mode
8. Open `/dashboard/settings/usage` — confirm `Salary estimate` appears for any LLM calls made
