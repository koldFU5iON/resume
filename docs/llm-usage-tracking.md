# LLM Usage Tracking

Every call through the LLM layer is logged automatically. This document covers how it works, how to add a new tracked feature, and how to read the data.

---

## How it works

`src/modules/llm/client.ts` exposes two functions — `complete()` and `completeStructured()`. Both call `logUsage()` internally after every successful response, using Next.js `after()` so the log write happens out-of-band and never delays the response to the user.

Each log entry captures:

| Field | Description |
|---|---|
| `profileId` | Which user made the call |
| `provider` | `anthropic`, `openai`, or `google` |
| `model` | Exact model ID (e.g. `claude-sonnet-4-6`) |
| `feature` | The product operation that triggered the call (required) |
| `role` | Model role the call asked for (`default`, `fast`, `research`, `analysis`); null on older rows and Jev |
| `promptTokens` | Input tokens consumed |
| `completionTokens` | Output tokens generated |
| `totalTokens` | Sum of the above |
| `latencyMs` | Wall-clock time from request to response |
| `createdAt` | Timestamp |

Log entries are stored in the `LlmUsageLog` table and never deleted — they are the source of truth for cost analysis and user-facing usage reporting.

### Job / CV / desk document attribution (#345)

Job-scoped calls also pass an explicit `attribution` so usage can be costed per job application, per CV and per writing desk document:

```ts
await completeStructured(profileId, prompt, schema, {
  feature: 'cv-generate',
  attribution: { jobApplicationId, cvDocumentId, writingDeskDocumentId, runId }, // all optional
})
await askJev(profileId, request, { feature: 'job-assessment-judge', attribution: { jobApplicationId, runId } })
```

- `jobApplicationId` / `cvDocumentId` / `writingDeskDocumentId` are validated against the profile before the row is written (`src/modules/llm/attribution.ts`): a job, CV or desk document the profile doesn't own, or a CV or desk document linked to a different job, is dropped (logged as a warning), never stored. A CV or desk document given without a job inherits its own job link.
- `writingDeskDocumentId` (`LlmUsageLog.writingDeskDocumentId`, added for CV generation, `docs/cv-generation.md`) is the writing desk document a call wrote, reviewed or refined. `cvDocumentId` points at the legacy `CVDocument`, so desk documents need their own column. A run sets it once the draft's target document is known; calls made before that carry only the job and `runId`. Deleting the document sets it to null (`onDelete: SetNull`), like the other references. Both writers (the BYOK client's `writeUsageLog`, which also covers failed calls, and the Jev reservation) store whatever `resolveAttribution` returns.
- `runId` groups the calls of one multi-call operation. Use `newRunId()`; the legacy CV generation and ATS checks make one per attempt; the new CV generation (`CvGeneration`) uses its row id, and the early assessment uses its `JobAssessment.id`.
- Profile-only work (master profile, chat, imports, discovered jobs not yet in the tracker) passes no attribution and stays unattributed. Older rows are never back-filled or matched by timestamp.
- Deleting a job or CV sets the reference to null (`onDelete: SetNull`); the usage row and its tokens stay.

Extra columns: `cacheReadTokens`, `cacheWriteTokens` and `serverToolCalls` (provider-executed tools such as web search/fetch, billed per call) are `null` when not reported, distinct from a measured `0`. `usageKnown = false` marks rows whose token counts are placeholders: Jev reservations and failed Jev calls, and structured output recovered from an error without usage. Failed calls are logged too: `status = 'error'` with `errorKind` (the `LLMError` / `JevError` kind, e.g. `timeout`, `rate_limit`), zero tokens and `usageKnown = false`, unless the error carried usage (output that failed schema validation was still billed). Calls that never reach the provider (no key configured) are not logged. The user usage page counts `status = 'ok'` rows only; failed Jev rows also keep the `:failed` feature suffix the daily cap and admin stats rely on.

`getJobCostSummary(profileId, jobId)` in `src/modules/llm/job-cost.ts` totals requests, tokens, cache tokens, server tool calls and latency for a job — the full workflow, the `cv-generate` calls alone, by feature and by CV. Money is an **estimate** from the dated rate card in `src/modules/llm/pricing.ts` (source, currency and `PRICING_RATES_AS_OF` are returned with it); unpriced models, unknown usage and web-search fees mark the estimate incomplete. `actualChargesUsd` is always null (BYOK is billed to the user by their provider), and `costPerAcceptedCv` is the full workflow estimate divided by the job's accepted CVs (`acceptedCvCount`), or null when none is accepted. A CV is accepted manually in the CV builder or automatically when its job moves to applied/interviewing (`CVDocument.acceptedVia` = `manual` | `applied`); see `src/modules/cv/acceptance.ts`.

`getJobSpend(profileId, jobId)` (same file) is the job page sidebar's **AI spend on this job** card: the estimate split into calls on the user's own key and app-paid Jev calls, and broken down by feature. Every deep dive call carries `{ jobApplicationId, runId }`, so its cost is counted there too.

---

## The `feature` field is required

`feature` is a required field in `CompleteOptions`. TypeScript enforces this at compile time — any call that omits it will not build.

```ts
// correct
await complete(profileId, prompt, { feature: 'job-fit' })
await completeStructured(profileId, prompt, schema, { feature: 'cv-import' })
```

Use a short kebab-case string. The values in use today (the authoritative display names are in `FEATURE_LABELS`):

| Area | Values |
|---|---|
| Jobs | `job-extract` (LLM fallback for extracting a job from a URL), `salary-estimate` |
| Profile | `cv-import` (parsing a pasted CV into profile data), `profile-summary`, `profile-extract` (suggestions from an experience or project; also writes project evidence), `profile-evidence-links` |
| Legacy CV builder | `cv-generate`, `cv-job-analysis`, `cv-evidence-score`, `cv-recruiter-scan` |
| CV generation (writing desk) | `cv-gen-brief` (role `analysis`), `cv-gen-select` (role `fast`), `cv-gen-write-experience` (default role, one call per employer that shows bullets), `cv-gen-write-skills` (role `fast`, one call that only orders and groups the selected skills and tools), `cv-gen-write-profile` (default role, profile, headline and competencies); every call passes `attribution: { jobApplicationId, runId }` with the `CvGeneration` row id as `runId` (`CV_GENERATION_FEATURES`, `src/modules/cv-generation/schema.ts`). When neither a deep dive nor `jobAnalysis` exists, Gather also calls `analyseJob`, logged as `cv-job-analysis` under the same `runId`. |
| ATS check | `ats-keyword-expand`, `ats-interpret`, `ats-context` |
| Cover letters (writing guide) | `cover-letter-analyse`, `cover-letter-architect`, `cover-letter-draft`, `cover-letter-review-pass`, `cover-letter-finalise`, `cover-letter-build`, `cover-letter-review` |
| Interview prep | `interview-prep-doc-analysis`, `interview-prep-interviewer-analysis` |
| Early assessment | `job-assessment-enrich`, `job-assessment-facts`; app-billed Jev: `job-assessment-verify`, `job-assessment-judge` (failed Jev calls get a `:failed` suffix) |
| Deep dive | `deep-dive-research-company`, `deep-dive-research-pay`, `deep-dive-research-practicalities`, `deep-dive-structure`, `deep-dive-synthesis` (`DEEP_DIVE_FEATURES`); the first builds used `deep-dive:<stage>` tags, kept as labels |
| Career vertical | `career-vertical-analyse`, `master-cv-generate` |
| Job hunt | `job-hunt-ats-discovery`, `scout-triage` |
| Chat | `chat-turn`, `chat-summarize` |
| Diagnostics | `ping` (round-trip from `/api/llm/ping`) |

Retired tags still have labels because old usage rows carry them: `job-fit` (JobFit was retired), `project-extract`, `job-hunt-fit`, `interview-prep-bulk-analysis`, `interview-prep-qa-generation`.

CV generation into the writing desk (`docs/cv-generation.md`) emits `cv-gen-brief`, `cv-gen-select` and the three `cv-gen-write-*` tags so far (no `writingDeskDocumentId` yet: no document exists until the Land stage). Planned, labelled with the stage that emits them: `cv-gen-review`. A run's per-stage tokens and cost on the generation log page come from the call results themselves (`usageOf` in `src/modules/cv-generation/call.ts`, priced with `estimateRowCostUsd`), not from reading the usage rows back: the row of a call is written in an `after()` callback of the call, so a read straight after the call can run before the write (this is why the Select row used to show no tokens or cost). The usage rows with that `runId` and feature remain the fallback for a stage whose calls all failed, and the source for the side panel's run total.

When you add a new LLM-powered feature, choose a value from the pattern above and add it to `FEATURE_LABELS` in `src/app/dashboard/settings/usage/_components/feature-labels.ts` so it displays a human-readable label in the usage UI rather than the raw key.

---

## Adding a new tracked feature

1. Call `complete()` or `completeStructured()` with your new `feature` string:

```ts
const result = await completeStructured(profileId, prompt, MySchema, {
  feature: 'cover-letter',
  system: SYSTEM_PROMPT,
})
```

2. Add the label to `FEATURE_LABELS` in `feature-labels.ts`:

```ts
const FEATURE_LABELS: Record<string, string> = {
  // existing entries...
  'cover-letter': 'Cover letter',
}
```

That is all. The log entry is written automatically and will appear on the user's usage page at `/dashboard/settings/usage`.

---

## Reading the data

**User-facing:** `/dashboard/settings/usage` — shows today / this month / all time token totals, call count, and a log of the last 100 calls with feature, model, token breakdown, and latency.

**Admin view:** the same page includes an admin section (gated by a role check) with cross-user breakdowns by feature and provider.

**Query layer:** `src/modules/llm/usage.ts` exports `getUserUsageSummary(profileId)` and `getAdminUsageSummary()`. Call these from Server Components or API routes — do not query `LlmUsageLog` directly from product code.

**API:** `GET /api/usage/summary` — returns the current user's summary as JSON.

---

## Cost estimation

At current model pricing (approximate, mid-2026):

| Model | Input / 1M tokens | Output / 1M tokens |
|---|---|---|
| Claude Sonnet 4.6 | $3.00 | $15.00 |
| Claude Haiku 4.5 | $0.25 | $1.25 |
| GPT-4o | $2.50 | $10.00 |
| GPT-4o mini | $0.15 | $0.60 |

Typical token counts by feature (observed on real usage):

| Feature | Input tokens | Output tokens | Total |
|---|---|---|---|
| `job-fit` | ~7,000–9,000 | ~800–1,200 | ~8–10k |
| `profile-summary` | ~3,000–5,000 | ~300–600 | ~4–6k |
| `cv-import` | ~4,000–8,000 | ~1,000–2,000 | ~5–10k |
| `profile-extract` | ~2,000–4,000 | ~500–800 | ~3–5k |

At Sonnet pricing, a `job-fit` call costs roughly $0.04–0.06. An active user running 30 job fits per month costs approximately $1.20–$1.80 in AI at Sonnet, or $0.10–$0.15 at Haiku.

These figures inform future pricing decisions. See `docs/superpowers/specs/` for the pricing strategy discussion.
