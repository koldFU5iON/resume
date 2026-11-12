# Building AI Features

How to land a new LLM-driven product feature on this codebase. Read this once
before writing the next AI feature; you should not need to re-derive the
pattern from scratch.

> The plumbing is in `src/modules/llm/` and `src/modules/profile/snapshot.ts`.
> The worked example below is **job-fit** (`assessJobFit`), retired in #363 when
> the job deep dive replaced it; read `src/modules/jobs/job-fit.ts` in git history
> (before #363) or use `src/modules/cv/analyse-job.ts` as a live example of the shape.

> **Streaming / conversational features** use a different pattern — see [`docs/chat-assistant.md`](./chat-assistant.md). The five-step pipeline below applies to batch features (job-fit, CV generation, cover letters) that generate output once and persist it.

---

## The five-step pipeline

Every AI feature on this codebase fits the same shape:

```
1. Gather    Pull the inputs the model needs from Prisma
                ↓
2. Prompt    Build the system + user messages from typed snapshots
                ↓
3. Call      completeStructured(profileId, prompt, zodSchema, opts)
                ↓
4. Persist   Write the validated result to the row it belongs to
                ↓
5. Return    Discriminated union so the UI handles ok/error without try/catch
```

The LLM layer is generic — it has no idea what a profile or a job is. The
domain module owns the orchestration: which data to fetch, how to format it,
what schema to validate against, where to persist the result. This is why
adding a new AI feature should *never* require editing `src/modules/llm/`.

---

## Step 1 — Define your output schema

Always use a zod schema. Use `completeStructured` (typed JSON) over `complete`
(free text) for anything that lands in the database or drives UI logic.

```ts
import { z } from 'zod'

export const CoverLetterSchema = z.object({
  greeting: z.string(),
  paragraphs: z.array(z.string()).min(3).max(5),
  signOff: z.string(),
})

export type CoverLetter = z.infer<typeof CoverLetterSchema>
```

**Use `.describe()` on each field.** It's not just documentation — the AI SDK
serializes descriptions into the schema sent to the model, which materially
improves the quality of structured output.

```ts
rating: z.number().min(0).max(10).describe('0 = no match, 10 = perfect match.')
```

Place the schema in a plain module (not in your `'use server'` action file).
Action files marked `'use server'` can **only export async functions** — any
non-function export (including a zod schema) will pass `tsc` and dev-mode
Turbopack but blow up the production build at first invocation with
`A "use server" file can only export async functions, found object`.

The canonical layout: `src/modules/jobs/schema.ts` owns the `JobFitSchema` +
inferred `JobFit` type; `src/modules/jobs/job-fit.ts` is `'use server'` and
only exports `assessJobFit`.

---

## Step 2 — Reuse the profile snapshot

Don't query Prisma yourself for the candidate's data. Use:

```ts
import { buildProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'

const snapshot = await buildProfileSnapshot(profile.id)
const profileMarkdown = serializeProfileForLLM(snapshot)
```

`buildProfileSnapshot()` returns a typed object with all profile ingredients
(experience, skills, education, certifications, competencies, languages) in a
shape designed for LLM consumption. `serializeProfileForLLM()` formats it as
markdown ready to drop into a prompt.

If your feature needs other domain snapshots later (e.g. `buildJobSnapshot` for
a job history overview, `buildCVDocumentSnapshot` for an existing CV), add them
under the same convention: `src/modules/<domain>/snapshot.ts`, takes an id,
returns typed data + a `serialize…ForLLM()` formatter.

---

## Step 3 — Build the prompt

Two messages: **system** sets the role and grading rubric, **user** holds the
data. This split is well-supported across providers and gives you cleaner
attention behavior than stuffing everything into one giant prompt.

```ts
const system = `You are an experienced career coach assessing a candidate's fit
for a role.

Be honest and concrete. Calibrate the rating:
- 0–2 (poor): missing core requirements
- 3–4 (ok): partial overlap
- 5–6 (stretch): meets most requirements but a meaningful gap
- 7–8 (good): strong baseline match
- 9–10 (excellent): unusually well-aligned

Ground your justification in specific evidence from both sides.`

const prompt = `# Candidate
${profileMarkdown}

# Role
**${job.title}** at ${job.company}

${job.jobDescription}`
```

**Markdown headers are load-bearing.** Models attend better to clearly-marked
sections than to walls of text. Use `#`, `##`, `###` to delineate inputs.

**Avoid "be creative" framing** for evaluative tasks. Calibration rubrics, like
the 0–10 scale above, produce more reliable structured outputs than vibes.

---

## Step 4 — Call the LLM

```ts
import { completeStructured } from '@/modules/llm/client'
import { LLMError, type LLMErrorKind } from '@/modules/llm/errors'

try {
  const result = await completeStructured(profile.id, prompt, JobFitSchema, {
    system,
    maxOutputTokens: 600,
    temperature: 0.2,
  })
  // result.object is typed as z.infer<typeof JobFitSchema>
} catch (err) {
  if (err instanceof LLMError) { /* return discriminated error */ }
  throw err
}
```

| Option | Default | When to override |
|---|---|---|
| `system` | none | Always set for evaluative tasks; lets you swap rubric without retraining the user-message format |
| `maxOutputTokens` | provider default (large) | Always cap. Most structured outputs need <800. |
| `temperature` | provider default | 0–0.3 for evaluative/factual tasks; 0.5–0.8 for creative drafts (cover letters) |
| `model` | the user's saved model | Only override when a specific call needs a specifically-different model |

**Costs scale with input size.** Profile + JD + system is often 3–5k input
tokens. Output is 200–800. At Anthropic Sonnet 4.6 rates (~$3/M in, $15/M out)
each call lands well under a cent. For BYO setups the user pays, but it still
pays to be lean — prefer fewer well-shaped calls over many small ones.

---

## Step 5 — Persist and return

```ts
await prisma.jobApplication.update({
  where: { id: jobId },
  data: { jobFit: result.object, jobFitAssessedAt: new Date() },
})

revalidatePath('/dashboard/job-applications')
revalidatePath(`/dashboard/job-applications/view/${jobId}`)

return { ok: true, fit: result.object }
```

**Add a `xAssessedAt` timestamp** when persisting AI-derived data. It lets you
later add staleness UX ("assessed 3 days ago, re-run?") and de-duplicate calls
when nothing has meaningfully changed.

**Return a discriminated union, not throw.** The caller (a server action or
API route) can pattern-match on the error kind without wrapping every call in
try/catch. The LLM layer's `LLMError.kind` is the standard set of buckets.

```ts
export type AssessJobFitResult =
  | { ok: true; fit: JobFit }
  | { ok: false; error: 'no_description'; message: string }   // domain-specific
  | { ok: false; error: 'not_found'; message: string }        // domain-specific
  | { ok: false; error: LLMErrorKind; message: string }       // pass-through

if (err instanceof LLMError) {
  return { ok: false, error: err.kind, message: err.message }
}
```

---

## UI patterns

### The trigger

When the AI-derived value is missing, render a small `Sparkles` button that
fires the action. When present, render the actual value with a hover/popover
showing detail. Reuse this pattern: it's how users learn "the spark icon means
AI fills it in."

```tsx
{value
  ? <ValueDisplay value={value} />
  : <button onClick={trigger}><Sparkles size={14} /></button>}
```

### The busy state

Use `useTransition` for short calls (< 5s). For longer ones, consider the
busy-overlay pattern from the archive flow (see `JobRow` for the
`busyLabel` mechanic).

### Handling `not_configured`

A user who hasn't set up their LLM key will get `error: 'not_configured'`. The
toast should include an action button linking to `/dashboard/settings/llm`:

```ts
toast.error(result.message, {
  action: result.error === 'not_configured'
    ? { label: 'Set up', onClick: () => router.push('/dashboard/settings/llm') }
    : undefined,
})
```

### Disabled when inputs are missing

If your feature requires content that may not exist yet (e.g. the job has no
description), the trigger should be **disabled with a tooltip explaining
what's missing**, not hidden. Hidden triggers leave users wondering why an
action they expected isn't there.

---

## Adding a new AI feature — checklist

1. **File an issue** describing the feature, the schema, the inputs, and where
   the trigger lives in the UI.
2. **Define the zod schema + TS type** alongside your domain module.
3. **Reuse existing snapshot helpers** (`buildProfileSnapshot`); add new ones
   per domain if needed.
4. **Write the server action** following the 5-step pipeline. Return a
   discriminated union; never re-throw `LLMError`.
5. **Add a persistence column** with an `xAssessedAt` timestamp if the result
   is durable. Migration via `prisma migrate dev` (or hand-written SQL + apply
   locally + commit, our usual flow).
6. **Wire the UI**: Sparkles trigger when missing, value display when present.
   Show a busy state. Hook the `not_configured` toast action.
7. **Smoke test**: log in with a real LLM key set, hit the trigger, verify
   the persisted row, repeat with no key to confirm the `not_configured` path.

The whole flow should take 1.5–2 hours for a feature with a clear schema and
existing UI hook. If it's taking significantly longer, you're probably either
fighting the snapshot helper or trying to do the work that should live in
`src/modules/llm/`. Re-read this doc before writing more code.

---

## Worked example: job-fit

| File | Role |
|---|---|
| `src/modules/jobs/schema.ts` | `JobFitSchema` + inferred `JobFit` type. Kept here because `'use server'` files can't export non-functions. |
| `src/modules/jobs/job-fit.ts` | `assessJobFit()` server action — the whole 5-step pipeline. |
| `src/modules/profile/snapshot.ts` | Profile data → markdown for the prompt. Reused by every future AI feature. |
| `src/app/dashboard/job-applications/_components/job-fit.tsx` | Trigger button when null, popover when present. Handles loading + `not_configured` toast action. |
| `prisma/schema/jobs.prisma` | `jobFit Json?` + `jobFitAssessedAt DateTime?` columns. |
| `prisma/migrations/<ts>_add_job_fit_assessed_at/migration.sql` | The migration adding the staleness column. |

Read those five files top to bottom. The whole feature is ~250 lines, including
the snapshot helper that every later feature gets for free.
