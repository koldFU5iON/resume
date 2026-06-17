# Salary Estimate — Design Spec
_Date: 2026-06-17 | Issue: #175_

## Goal

Surface a salary range on every job application — either extracted from the JD if one is stated, or AI-estimated if not — as a reusable component that can be placed on the job row card (list view) and in the job sidebar (detail view).

---

## Context

- **Issue #192 (closed):** Salary band expectation already exists in `SearchProfile.salaryBand` and is already injected into job-fit scoring in `job-fit.ts`. No work needed there.
- **Issue #175 (this spec):** Show a salary range on the job itself — sourced from the JD when available, AI-estimated when not. Reusable across list and detail views.

---

## Data Model

Two new fields on `JobApplication` in `prisma/schema/jobs.prisma`:

```prisma
salaryEstimate    Json?      // SalaryEstimate object (see schema below)
salaryEstimatedAt DateTime?
```

The existing `salaryBand String?` field on `JobApplication` is a plain-text field for the user's manually entered salary info. The new `salaryEstimate Json?` is separate — it holds the structured AI output and must not conflict with it.

---

## Zod Schema

Lives in `src/modules/jobs/schema.ts` alongside `JobFitSchema`:

```typescript
export const SalaryEstimateSchema = z.object({
  min:        z.number().nullable(),
  max:        z.number().nullable(),
  currency:   z.string(),
  source:     z.enum(['extracted', 'estimated']),
  confidence: z.enum(['low', 'medium', 'high']).optional(), // only when source=estimated
  reasoning:  z.string().optional(),                        // only when source=estimated, ≤80 words
})

export type SalaryEstimate = z.infer<typeof SalaryEstimateSchema>
```

`min` and `max` are both nullable to handle:
- JD states only a ceiling: `{ min: null, max: 90000, currency: 'GBP', source: 'extracted' }`
- JD states only a floor: `{ min: 70000, max: null, currency: 'GBP', source: 'extracted' }`
- Full range stated or estimated: `{ min: 70000, max: 90000, ... }`

---

## Server Action

New file: `src/modules/jobs/salary-estimate.ts`

```
type EstimateSalaryResult =
  | { ok: true; estimate: SalaryEstimate }
  | { ok: false; error: 'no_description' | 'not_found' | LLMErrorKind; message: string }
```

**Single LLM call — sweep then estimate:**

The prompt instructs the model to:
1. Scan the JD for any stated salary figure or range (e.g. `$120k–$150k`, `up to £80,000`, `€90,000 base`).
2. If found → extract it, set `source: 'extracted'`, omit `confidence` and `reasoning`.
3. If the JD uses vague language (`competitive`, `DOE`, `dependent on experience`, `market rate`) or states no salary → estimate based on job title, seniority level, company, location, and industry context. Set `source: 'estimated'`, include `confidence` and a 1–2 sentence `reasoning`.

**Currency rule:** Always infer currency from the job's country/location in the JD (UK → GBP, US → USD, Germany → EUR, etc.). The user's `searchProfile.salaryBand.currency` is provided as a secondary hint only and must not override the JD location.

**Persists** the result to `JobApplication.salaryEstimate` and `salaryEstimatedAt`. Calls `revalidatePath` for the job list and detail view. Feature label: `'salary-estimate'` (add to `FEATURE_LABELS` in the usage log).

---

## Component Contract

New file: `src/app/dashboard/job-applications/_components/salary-estimate.tsx`

```tsx
type SalaryEstimateProps = {
  jobId:           string
  initialEstimate: SalaryEstimate | null
  hasJD:           boolean   // disables generation if no JD
  hasLLMKey:       boolean
  compact?:        boolean   // default false
}
```

**This is a `'use client'` component** that manages its own generate state via `useTransition`, matching the pattern of `job-fit.tsx`.

### States

| State | Render |
|-------|--------|
| No estimate, no JD | Disabled "Estimate salary" button with tooltip "Add a job description first" |
| No estimate, has JD, no LLM key | Link "Set up AI" pointing to `/dashboard/settings/llm` |
| No estimate, ready | "Estimate salary" button |
| Generating | Spinner (same style as JobFit loading state) |
| `source: 'extracted'` | `£70k–£90k` labeled **"Salary"** (no hedge marker) |
| `source: 'estimated'` | `~£70k–£90k` labeled **"Salary estimate"** + info icon tooltip: `"AI-estimated range — not stated in the job listing"` |
| Error | `toast.error(message)` + retry button |

### compact=true (job list row)

- Shows only the range value: `£70k–£90k` or `~£70k–£90k`
- If no estimate: a small ghost "Est." button (icon only, text hidden)
- No reasoning visible; tooltip on the `~` prefix explains the hedge

### compact=false (job sidebar)

- Label row: `"Salary"` or `"Salary estimate"` + info icon
- Range value: `£70k–£90k` or `~£70k–£90k`
- When `source: 'estimated'`: confidence badge (`low`/`medium`/`high`) + expandable reasoning (collapsed by default, click to expand)

---

## Type Updates

`src/app/types/job-application.ts` — add `SalaryEstimate` type and extend `Job`:

```typescript
export type SalaryEstimate = {
  min:        number | null
  max:        number | null
  currency:   string
  source:     'extracted' | 'estimated'
  confidence?: 'low' | 'medium' | 'high'
  reasoning?:  string
}

export type Job = Omit<JobApplication, "status" | "progress" | "jobFit" | "applicationSource"> & {
  // ... existing fields ...
  salaryEstimate?: SalaryEstimate | null
}
```

---

## Placement

### Job sidebar (desktop + mobile Details drawer)

In `job-sidebar.tsx`, add a new Card after the Fit Score card:

```tsx
<Card>
  <CardContent className="flex flex-col gap-2 pt-4">
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Salary</p>
    <SalaryEstimate
      jobId={job.id}
      initialEstimate={job.salaryEstimate ?? null}
      hasJD={!!job.jobDescription?.trim()}
      hasLLMKey={hasLLMKey}
    />
  </CardContent>
</Card>
```

The `JobMobileView` Details drawer renders the sidebar content — placing it in `job-sidebar.tsx` covers mobile automatically.

### Job list row card (compact)

In `job-row-card.tsx`, add the compact variant in the metadata row alongside the existing fit badge area:

```tsx
<SalaryEstimate
  jobId={id}
  initialEstimate={job.salaryEstimate ?? null}
  hasJD={!!jobDescription?.trim()}
  hasLLMKey={hasLLMKey}
  compact
/>
```

---

## Query Updates

No query code changes needed. Both `getActiveJobs` and `getJobApplicationById` in `src/modules/jobs/queries.ts` use Prisma `include` (which returns all scalar fields from the base model). Once the migration runs and `prisma generate` regenerates the client, `salaryEstimate` and `salaryEstimatedAt` will appear automatically in query results.

The only change required is adding `salaryEstimate?: SalaryEstimate | null` to the `Job` type so TypeScript knows about the field.

**Component — usage notification:** After a successful `estimateSalary` call, the component should call `notifyUsageUpdated()` from `@/lib/usage-events` (same as `job-fit.tsx`) so the usage dashboard reflects the LLM spend.

---

## Files to Change

| File | Change |
|------|--------|
| `prisma/schema/jobs.prisma` | Add `salaryEstimate Json?`, `salaryEstimatedAt DateTime?` |
| `prisma/migrations/` | New migration via `npm run db:migrate` |
| `src/modules/jobs/schema.ts` | Add `SalaryEstimateSchema` + `SalaryEstimate` type |
| `src/modules/jobs/salary-estimate.ts` | **New** — server action |
| `src/app/types/job-application.ts` | Add `SalaryEstimate` type, extend `Job` |
| `src/modules/jobs/queries.ts` | Include `salaryEstimate`, `salaryEstimatedAt` in selects |
| `src/app/dashboard/job-applications/_components/salary-estimate.tsx` | **New** — reusable component |
| `src/app/dashboard/job-applications/view/[id]/_components/job-sidebar.tsx` | Add Salary card |
| `src/app/dashboard/job-applications/_components/job-row-card.tsx` | Add compact variant |
| `src/app/dashboard/settings/usage/_components/usage-log.tsx` | Add `'salary-estimate'` to `FEATURE_LABELS` |

---

## Non-Goals

- No changes to the existing `salaryBand String?` field (user's manually entered salary)
- No auto-generation on page load (always on-demand)
- No salary data from external APIs or market databases — purely LLM inference from JD + profile context
- No salary trend charts or history

---

## UI Distinction Reference

| Scenario | Label | Display | Tooltip |
|----------|-------|---------|---------|
| Range stated in JD | "Salary" | `£70k–£90k` | — |
| AI-estimated | "Salary estimate" | `~£70k–£90k` | "AI-estimated range — not stated in the job listing" |
| Only max stated | "Salary" | `up to £90k` | — |
| Only min stated | "Salary" | `£70k+` | — |
