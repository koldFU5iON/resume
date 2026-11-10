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
| `promptTokens` | Input tokens consumed |
| `completionTokens` | Output tokens generated |
| `totalTokens` | Sum of the above |
| `latencyMs` | Wall-clock time from request to response |
| `createdAt` | Timestamp |

Log entries are stored in the `LlmUsageLog` table and never deleted — they are the source of truth for cost analysis and user-facing usage reporting.

---

## The `feature` field is required

`feature` is a required field in `CompleteOptions`. TypeScript enforces this at compile time — any call that omits it will not build.

```ts
// correct
await complete(profileId, prompt, { feature: 'job-fit' })
await completeStructured(profileId, prompt, schema, { feature: 'cv-import' })
```

Use a short kebab-case string. Established values:

| Value | Operation |
|---|---|
| `job-fit` | Job fit scoring against a user's profile |
| `job-extract` | LLM fallback for extracting job details from a URL |
| `cv-import` | Parsing a pasted CV into structured profile data |
| `profile-summary` | Generating the career profile summary |
| `profile-extract` | Extracting structured suggestions from an experience entry |
| `project-extract` | Extracting insights from a project entry |
| `ping` | Sanity-check round-trip from `/api/llm/ping` |

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
