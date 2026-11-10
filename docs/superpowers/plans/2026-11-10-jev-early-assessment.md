# Early Job Assessment (Jev) — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Read `AGENTS.md` first (Next.js 16, Prisma 7 migration workflow, `feature` tag on every LLM call).

**Goal:** Every job that lands in the tracker gets an automatic, cheap, early **go/no-go**: a 1–10 score, a pursue level (weak → priority), concrete **blockers** (work rights, pay floor, hard requirements), and the job's strengths against the profile. The purpose is to stop investing time in a CV and cover letter for a role that has a blocker nobody spotted.

**Approach:** A new pipeline that runs **alongside** the existing `assessJobFit`. Nothing about the current assessment changes until the side-by-side review says the new one is ready.

- **Jev** (TypeSafe AI, System One model) makes every judgment. It returns calibrated probabilities over options we define and writes no prose. It's called with an app-level key, and every call is logged to the usage table.
- **A cheap model** (Haiku-class, on the user's own key) does the jobs that need text: fetching and filling missing job details, and pulling the job's requirements, location and salary into a structured object that Jev questions are built from.
- **Plain code** combines Jev's answers with the user's eligibility profile into the score, level and blockers. All thresholds live in one constant, so tuning means editing numbers, not prompts.

**Out of scope (later):** discovered jobs and scout triage (they move over once this is proven), web lookup of sponsorship policy (part of the deep dive), and replacing or removing the current `jobFit`.

---

## Decisions (from the review)

| # | Decision |
|---|---|
| 1 | One app-level `TYPESAFE_API_KEY`. Every Jev call is logged to `LlmUsageLog` per user, so limits can come from real data. A per-user daily cap ships from day one as a safety net. |
| 2 | Job applications only. The module takes plain input so discovered jobs and scout triage can reuse it later. |
| 3 | Automatic. A job lands, its fields are checked (and fetched if needed), then Jev assesses it. |
| 4 | Ladder: **1–2 weak · 3–4 consider · 5–7 pursue · 8–10 priority**. Thresholds sit in one constant and get tuned during the side-by-side. You often applied around an old 4/10, so we check where those jobs land. |
| 5 | A new **Eligibility & dealbreakers** section in the search profile: citizenships and visas, salary floor and target per currency, and dealbreakers. Experience and education blockers come from the job's must-haves, checked against the career profile. |
| 6 | The cheap model checks fields and fetches whatever is missing from the job URL. The job row shows a "Fetching details…" indicator while it works. |
| 7 | A job that fails verification is marked **failed: needs attention** with reasons, and waits for the user. Editing the job re-runs it. |
| 8 | The early stage shows score, level, blockers, strengths and gaps. For pursue or better, the user runs the deeper analysis (the current Claude assessment) by hand. |
| 9 | Side-by-side review in the UI, plus a compare script. |

### Defaults I've picked (say if you want them changed)

- **A hard blocker shows the level as "Blocked"** while keeping the score visible, e.g. `Blocked · 7/10 — needs UK sponsorship, JD says none offered`. The underlying level is still stored, for tuning.
- **"Unconfirmed" is a separate severity.** It covers requirements the JD doesn't settle, like "needs sponsorship, JD doesn't say". It shows amber, doesn't block, and is marked as something the deep dive should check.
- ~~A must-have scored below 0.3 is a hard blocker for every kind of requirement.~~ **Superseded by the spec** (`docs/superpowers/specs/2026-11-10-jev-early-assessment-design.md` §1, §5). Only credential must-haves (education, certification, licence, clearance, language) block outright. Years requirements use a **years rule**: Jev estimates the candidate's years in the area as a range; met / warn (est ≥ 50% of required, or within 2 years) / block. Other experience or skill must-haves below 0.3 are *major gaps*: −0.5 each, at most −2. The spec also adds `buildCandidateState` (the full dated history, never cut from the end), relocation, `availability` requirements, `employmentType` and `eligibility.currentCountry`. Where the two differ, the spec wins.
- **The cheap step needs the user's LLM key.** Without one, the run fails with `no_llm_key` and a link to settings. Jev runs on the app key, but it can't build the requirement questions alone.
- **Rollout flag:** `JOB_ASSESSMENT_V2=off|admin|all`, defaulting to `admin`. Admin uses the existing `isAdminUser`, so only you run it until it's flipped to `all`.

---

## Pipeline

```
job created / key fields edited
        │
        ▼
queueJobAssessment(profileId, jobId) ─ creates a JobAssessment row (status: queued) + after(run)
        │
        ▼
1. VERIFY ─────────── code: title/company present and not placeholders, JD ≥ 600 chars
   (status: checking)  Jev: is_full_description, has_requirements, has_responsibilities (noul)
        │ fail + URL present                         │ pass
        ▼                                            │
2. ENRICH (status: fetching — row shows "Fetching details…")
   fetch the page with the existing extract-fetch + Readability
   cheap model fills only empty/placeholder fields → written back to JobApplication
   → VERIFY again (once) ── still failing → FAILED (verification, reasons[])
        │                                            │
        ▼◄───────────────────────────────────────────┘
3. FACTS (status: assessing) — cheap model, structured output, cached by job input hash
   requirements[] (text, kind, must|nice), location {countries, mode}, salary {min,max,currency,period},
   seniority, sponsorshipMentioned
        │
        ▼
4. JUDGE — one Jev call, state = { candidate profile, job (facts + full JD), preferences }
        │
        ▼
5. COMBINE (pure code) → score 1–10, level, blocked, blockers[], strengths[], gaps[], unsettled[]
        │
        ▼
JobAssessment row: status complete, everything stored (including raw Jev answers)
```

### 1. Verify

- **Code checks.** The title isn't empty or `(untitled)`. The company isn't empty or `(unknown)`. The description is at least `MIN_JD_CHARS` (600) after trimming.
- **Jev (one request, three nouls).** State: `{ title, company, description }`.
  - `is_full_description` — true when it's a complete posting with responsibilities and candidate requirements. False when it's a teaser, search results page, login or cookie wall, or truncated preview (LinkedIn previews are the usual case).
  - `has_requirements`, `has_responsibilities`.
- **Pass rule:** every code check passes, `is_full_description ≥ 0.7` and `has_requirements ≥ 0.5`.
- **Fail reasons** are written in plain words for the row tooltip, e.g. "Description looks truncated", "Company is missing".
- The code checks run first, so Jev is never called on an empty job.

### 2. Enrich (only when verification fails and the job has a URL)

- Reuse `fetchPageContent` and `extractReadableContent`. Refactor `extractWithLLM` to take `profileId` instead of calling `requireProfile()`, because inside `after()` from the bearer-token capture route there's no session.
- Call the cheap model with `ExtractedJobLLMSchema`. Write back only the fields that are empty or placeholders; never overwrite something the user typed. Record which fields were filled in `JobAssessment.enrichedFields`.
- Fetch at most once per run, then verify again. If it still fails, mark it `failed / verification`.

### 3. Facts (cheap model, feature `job-assessment-facts`)

```ts
JobFactsSchema = z.object({
  requirements: z.array(z.object({
    text: z.string(),                 // "BSc in Computer Science or related field"
    kind: z.enum(['education','experience','skill','certification','language','clearance','other']),
    importance: z.enum(['must','nice']),
  })).max(14),
  location: z.object({
    countries: z.array(z.string()),   // ISO-3166 alpha-2
    mode: z.enum(['onsite','hybrid','remote_in_country','remote_region','remote_anywhere','unknown']),
    remoteRegions: z.array(z.string()).default([]),
  }),
  salary: z.object({ min: z.number().nullable(), max: z.number().nullable(), currency: z.string().nullable(),
                     period: z.enum(['year','month','day','hour']).nullable() }).nullable(),
  seniority: z.enum(['intern','junior','mid','senior','staff','principal','lead','manager','director','exec','unknown']),
})
```

- The job's existing `salaryBand` and `countries` fields go into the prompt as hints.
- The result is cached on `JobAssessment.facts` with `factsHash = sha256(title|company|JD)`. When only the profile or eligibility changes, a re-run copies facts from the latest run with the same hash and makes **no cheap-model call**. That keeps "re-assess everything" down to Jev cost only.

### 4. Judge (one Jev request, pinned model `jev-1.14.0`)

**State:** `{ candidate: serializeProfileForLLM(snapshot), job: { title, company, facts, description }, preferences: { targetRoles, careerGoals, pivotContext, remotePreference } }`. Truncate the description so the state stays under about 24k tokens, inside Jev's 32k per-question limit. Refer to parts of the state in instructions by dotted path, e.g. `` `job.description` ``, as the Jev docs recommend.

| Question id | Type | Purpose |
|---|---|---|
| `req_<i>` (one per requirement) | noul | "The candidate's profile shows they meet: «text»". The criteria spell out equivalence, e.g. a diploma is not a degree unless the requirement allows "or equivalent". |
| `skills_match` | score, 5 levels | Technical and functional overlap with what the role actually does |
| `seniority_fit` | choice | `well_below · below · match · above · well_above` |
| `domain_fit` | score, 4 levels | Industry or domain familiarity |
| `direction_fit` | score, 4 levels | Fits the target roles and career goals. Only asked when the search profile has them. |
| `sponsorship` | choice | `offered · explicitly_not_offered · not_mentioned`. Only asked when the work-rights check says sponsorship is needed. |
| `dealbreaker_<i>` (one per user dealbreaker) | noul | "This role involves: «dealbreaker»" |
| `remote_match` | noul | The role's working pattern fits `remotePreference`. Only asked when a preference is set. |

Jev's docs advise putting every question about the same state in one request: extra questions cost only their own tokens and barely change latency.

### 5. Combine (`src/modules/job-assessment/combine.ts`, pure and unit-tested)

**Blockers, decided in code:**

| Check | Hard blocker | Unconfirmed | Source |
|---|---|---|---|
| Work rights | Job country not covered by the user's rights **and** `sponsorship = explicitly_not_offered` | Not covered **and** `not_mentioned` → "Requires sponsorship — not confirmed" | `eligibility.ts` + Jev |
| Pay floor | The job's stated `max` is below the floor for that currency | The range straddles the floor | facts.salary + `salaryFloors`. A currency with no floor set is neither. |
| Must-have requirement | `req_i < 0.3` | — (0.3–0.7 becomes a **gap**) | Jev |
| Dealbreaker | `dealbreaker_i > 0.7` | 0.4–0.7 | Jev |

**Work-rights coverage** (`eligibility.ts`) is a static table from citizenship or visa to the countries where the user can work without sponsorship:

- An EU/EEA citizenship covers EU, EEA and CH.
- **IE ↔ GB through the Common Travel Area.** Irish citizens can work in the UK without a visa; other EU citizens can't. For example, an Italian citizen is covered for IE, EU, EEA and CH, while GB needs sponsorship.
- A visa covers its own country until `expiresOn`.
- `remote_anywhere` counts as covered. `remote_region` is checked against `remoteRegions`.

**Score.** Each signal is normalised to 0–1. Rubric scores are divided by `levels − 1`. Seniority maps `match = 1`, one step off = 0.6, two steps off = 0.2.

```
coverage  = Σ(weight·noul) / Σweight          // must = 2, nice = 1
composite = 0.35·coverage + 0.25·skills + 0.15·seniority + 0.10·domain + 0.15·direction
            (direction's weight is spread over the others when it isn't asked)
            − 0.05 if the job is outside the target countries, − 0.05 if pay is below target
score     = clamp(round(1 + 9·composite), 1, 10)
level     = LADDER: 1–2 weak · 3–4 consider · 5–7 pursue · 8–10 priority
blocked   = any hard blocker  → shown as "Blocked"
strengths = must-haves with noul ≥ 0.7 (top 3, by the JD's own wording)
gaps      = requirements with noul between 0.3 and 0.7
unsettled  = must-haves with 0.3 ≤ p < 0.7 → shown as "check these" (Jev confidence is not used as a gate; see spec §1)
```

All weights and thresholds live in `ASSESSMENT_CONFIG`, together with `PIPELINE_VERSION = 'early-v1'`. Every run stores the version, so results from different tunings never get mixed up.

---

## Data model

### New: `prisma/schema/job-assessment.prisma`

```prisma
model JobAssessment {
  id               String    @id @default(cuid())
  profileId        String
  jobApplicationId String
  pipelineVersion  String
  status           String    // queued | checking | fetching | assessing | complete | failed
  failureKind      String?   // verification | no_llm_key | rate_limited | error
  failureReasons   String[]
  enrichedFields   String[]
  factsHash        String?
  facts            Json?     // JobFacts (from the cheap model)
  signals          Json?     // raw Jev answers, keyed by question id
  request          Json?     // exact Jev request bodies, so any run can be replayed (spec §1)
  jevModel         String?   // e.g. jev-1.14.0, as returned by the API
  score            Int?
  level            String?   // weak | consider | pursue | priority
  blocked          Boolean   @default(false)
  blockers         Json?     // [{ kind, severity: 'hard'|'unconfirmed', label, detail }]
  strengths        String[]
  gaps             String[]
  unsettled        String[]
  startedAt        DateTime?
  completedAt      DateTime?
  queueTimeMs      Int?      // createdAt → startedAt (time waiting for after() to pick it up)
  processTimeMs    Int?      // startedAt → completedAt, written for complete AND failed runs
  stageTimings     Json?     // { verify, enrich, verifyRetry, facts, judge, combine, persist } in ms; skipped stages omitted
  createdAt        DateTime  @default(now())

  profile        Profile        @relation(fields: [profileId], references: [id], onDelete: Cascade)
  jobApplication JobApplication @relation(fields: [jobApplicationId], references: [id], onDelete: Cascade)

  @@index([jobApplicationId, createdAt])
  @@index([profileId, status])
}
```

- **One row per run**, never updated in place after it completes. The history makes the side-by-side and the tuning possible. "Current" means the newest row for the job.
- Add back-relations on `JobApplication` (`assessments JobAssessment[]`) and `Profile`.
- Migration: `npm run db:migrate -- --name job_assessment`.

### Search profile: eligibility (JSON column, no migration)

Add to `SearchProfileSchema` in `src/modules/search-profile/schema.ts`:

```ts
eligibility: z.object({
  citizenships: z.array(z.string().length(2)).default([]),            // ISO country codes, e.g. ['IE']
  visas: z.array(z.object({ country: z.string().length(2), type: z.string().max(80).default(''),
                            expiresOn: z.string().nullable().default(null) })).default([]),
  salaryFloors: z.array(z.object({ currency: z.string().length(3), floor: z.number().positive(),
                                   target: z.number().positive().nullable().default(null) })).default([]),
  dealbreakers: z.array(z.string().trim().max(200)).max(10).default([]),
}).catch(EMPTY_ELIGIBILITY).default(EMPTY_ELIGIBILITY)
```

- Example: `salaryFloors: [{ EUR, floor: 90000, target: 100000 }, { GBP, floor: 85000, target: null }]`.
- The existing `salaryBand` stays for current features. The new pipeline only reads `salaryFloors`.

---

## Usage tracking & limits

- **Every Jev call** writes to `LlmUsageLog`:
  - `provider: 'typesafe'`
  - `model`: the versioned id the response returns
  - `feature`: `job-assessment-verify` or `job-assessment-judge`
  - `promptTokens` / `completionTokens` from `usage.input_tokens` / `usage.output_tokens`
  - `latencyMs`: wall-clock time of the HTTP call, SDK retries included
- **Process time is tracked at two levels:**
  - **Per call:** `LlmUsageLog.latencyMs`, written for both Jev and cheap-model calls. The column already exists; `completeStructured` already fills it.
  - **Per assessment run:** on `JobAssessment`.
    - `processTimeMs` is the end-to-end time from claim to finish, recorded on failed runs too, so slow failures are visible.
    - `queueTimeMs` is how long the run waited before `after()` started it.
    - `stageTimings` is a per-stage breakdown in ms.
  - `run.ts` times each stage with a small `timed(stage, fn)` helper that adds to the timings object. Everything is written in the final update, so timing adds no extra DB writes.
- **Every cheap-model call** goes through `completeStructured`, so it's logged automatically under `job-assessment-enrich` or `job-assessment-facts`.
- **Add all four to `FEATURE_LABELS`** in `usage-log.tsx`.
- **Admin usage page:** add an **"App-billed (Jev)"** card, since `provider = 'typesafe'` means the app pays.
  - This month: calls, tokens, estimated cost ($0.042 per million input tokens; output is free).
  - **Top users:** runs per day, as average and p95.
  - **Process time:** p50 and p95 of `processTimeMs` for this month, split into complete and failed runs, plus the average of each stage from `stageTimings`. That shows whether time goes to the fetch, the cheap model or Jev.
  - These numbers decide where real limits go.
- **Safety cap:** `JEV_DAILY_CALL_LIMIT` (default 300) is a hard cap. Before each call, a transaction holding a per-profile advisory lock counts today's `typesafe` rows and inserts a zero-token reservation row; the row is updated with the real usage afterwards, or kept with `feature` suffixed `:failed` when the call fails (failures count too). Going over gives `failed / daily_cap`.
- **Kill switch:** if `TYPESAFE_API_KEY` is unset, the pipeline doesn't queue at all, and the UI shows nothing new.

---

## Triggers

`queueJobAssessment(profileId, jobId, { reason })` lives in `src/modules/job-assessment/queue.ts`. It's a plain module (not `'use server'`) and takes `profileId` explicitly:

1. It returns early if the flag is off for this user, or if `TYPESAFE_API_KEY` is missing.
2. It creates a `JobAssessment` row with status `queued`.
3. It calls `after(() => runJobAssessment(assessmentId))`, from `next/server`. That's valid in server actions and route handlers; Next 16 docs: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`.

**Call sites:**

| Where | When |
|---|---|
| `jobs/mutations.ts` → `createJobApplication` | Manual add |
| `jobs/mutations.ts` → `updateJobApplication`, `updateJobSalaryBand` | When title, company, description, location or salary changed |
| `jobs/quick-capture.ts` → `quickCaptureJob` | Quick add by URL |
| `jobs/capture.ts` → `captureJobFromUrl` | Only when `created: true`. Covers `/api/jobs/capture` and `/api/jobs/batch-capture`. |
| `job-hunt/actions.ts:445` | Promoting a discovered job into the tracker |
| New "Re-run" action | From the job row or detail page |

**Batch capture:** wrap the batch route's runs in a single `after()` that works through them **one at a time**, so the user's cheap-model key isn't hit with 20 requests at once.

**Run safety:**
- `runJobAssessment` claims its row with `updateMany({ where: { id, status: 'queued' } })`, the same pattern as scout triage.
- On read, any run stuck in progress for more than 5 minutes is treated as `failed / error`. That covers an `after()` callback killed at the time limit.
- A new run for the same job makes the older queued runs obsolete: only the newest row is shown.

---

## UI

1. **`EarlyAssessment` component** (`early-assessment.tsx`) works **the same way as the current `JobFit`** in `job-fit.tsx`.
   - **The trigger is a pill:**
     - Running: a spinner with `Checking…`, `Fetching details…` or `Assessing…`.
     - Complete: the level colour and `7/10`, or red `Blocked · 7/10`.
     - Failed: amber `Needs attention`.
   - **Tapping or clicking the pill opens the findings:**
     - **desktop:** a `Popover`, `w-96 max-h-[min(28rem,80vh)] overflow-y-auto`
     - **mobile:** a bottom `Drawer` with an sr-only `DrawerTitle`
     - The same `max-sm:hidden` / `sm:hidden` split as `JobFit`; no tooltip.
   - **Inside, `EarlyAssessmentDetail`** shows, in order:
     - the level, score and gauge, using the same layout as `FitDetail`
     - blockers: hard first, then unconfirmed
     - strengths and gaps
     - "check these": unsettled must-haves
     - for failed runs: the failure reasons and a **Re-run** button
     - a footer with the Jev model, pipeline version and `processTimeMs`
   - **Deep analysis button:** shown when the level is pursue or better and the job isn't blocked. It runs the existing `assessJobFit`.
   - Reuse `FitDetail`'s gauge and the `GAUGE_COLORS` style. Pull small shared pieces out of `job-fit.tsx` instead of copying them.
2. **Where it's mounted (side by side with the current fit):**
   - **Job row and card** (`job-row.tsx`, `job-row-card.tsx`): next to the current `JobFit` pill.
   - **Job detail sidebar** (`job-sidebar.tsx`): a second line, "Early assessment", in the existing Fit Score card, under the current `JobFit`.
   - Data: `getActiveJobs` and `getJobApplicationById` add `assessments: { orderBy: { createdAt: 'desc' }, take: 1 }`.
   - **Live updates:** a small `AssessmentPoller` client component calls `router.refresh()` every 3 seconds while any visible job has a run in progress, and stops after 2 minutes. It reuses the existing `router.refresh` pattern; no new data-fetching layer.
3. **Search context page:** a new **Eligibility & dealbreakers** card in `search-context-form.tsx`, with:
   - citizenships (country multiselect)
   - visas (country, type, expiry)
   - salary floor and target per currency (repeatable rows)
   - dealbreakers (a list of up to 10 short lines)
4. **Job list filter** (`filter-bar.tsx`): add "Early level", including Blocked and Needs attention, once the data is there.

---

## File map

**Create**
- `prisma/schema/job-assessment.prisma`, plus the migration
- `src/modules/jev/client.ts` — `TypeSafeClient` singleton (pinned `jev-1.14.0`), `systemOne()` wrapper that logs usage, normalises errors to `JevError { kind }`, and enforces the daily cap
- `src/modules/jev/client.test.ts`
- `src/modules/job-assessment/schema.ts` — `JobFactsSchema`, `Blocker`, `AssessmentResult`, `ASSESSMENT_CONFIG`, `PIPELINE_VERSION`
- `src/modules/job-assessment/eligibility.ts` (+ `.test.ts`) — work-rights coverage and the salary floor check
- `src/modules/job-assessment/verify.ts` (+ `.test.ts`) — code checks + Jev verify questions + pass rule
- `src/modules/job-assessment/enrich.ts` — fetch and fill missing fields
- `src/modules/job-assessment/facts.ts` — cheap-model facts extraction + hash cache
- `src/modules/job-assessment/questions.ts` (+ `.test.ts`) — builds the Jev question set from facts and preferences
- `src/modules/job-assessment/combine.ts` (+ `.test.ts`) — pure scoring, blockers and level
- `src/modules/job-assessment/run.ts` — the stage machine; writes status at each step
- `src/modules/job-assessment/queue.ts` — `queueJobAssessment` + flag check
- `src/modules/job-assessment/actions.ts` — `'use server'`: `rerunJobAssessment(jobId)`
- `src/modules/job-assessment/queries.ts` — latest run per job, stale-run handling
- `src/app/dashboard/job-applications/_components/early-assessment.tsx` — pill + desktop Popover / mobile Drawer + `EarlyAssessmentDetail`, the same pattern as `job-fit.tsx`
- `src/app/dashboard/job-applications/_components/assessment-poller.tsx`
- `src/app/dashboard/search-context/_components/eligibility-card.tsx`
- `scripts/assessment-compare.ts` — runs v2 over a profile's active jobs (or reads the latest runs) and prints a table: old label and rating vs new level, score and blockers
- `docs/job-assessment.md` — the pipeline, question set, thresholds and how to tune them

**Modify**
- `package.json` — `@typesafe-ai/sdk`; script `assess:compare`
- `.env.example`, `AGENTS.md` (env + external API sections) — `TYPESAFE_API_KEY`, `JOB_ASSESSMENT_V2`, `JEV_DAILY_CALL_LIMIT`. Also note the BYOK exception: Jev is app-billed and tracked.
- `src/modules/llm/client.ts` — export `FAST_MODELS` (`anthropic: 'claude-haiku-5-5'`, plus cheap OpenAI and Google models checked against `availableModels`) and `resolveFastModel(profileId)`. Make `logUsage` exportable or add a shared usage writer for the Jev client.
- `src/modules/jobs/extract-llm.ts` — `extractWithLLM(html, profileId)`, no `requireProfile`
- `src/modules/jobs/{mutations,quick-capture,capture}.ts`, `src/modules/job-hunt/actions.ts`, `src/app/api/jobs/batch-capture/route.ts` — triggers
- `src/modules/jobs/queries.ts` — include the latest assessment
- `src/modules/search-profile/schema.ts` — `eligibility`
- `src/modules/llm/usage.ts` + `settings/usage/_components/usage-admin.tsx` — the app-billed Jev card
- `src/app/dashboard/settings/usage/_components/usage-log.tsx` — `FEATURE_LABELS`
- Job row, card, sidebar and search-context form — mount the new components

---

## Tasks

### Phase 1 — Foundations
- [ ] Install `@typesafe-ai/sdk`. Check the installed types for `systemOne()`, `answers.<id>`, `usage`, retry and timeout options, and the error classes; the docs disagree about some accessors.
- [ ] Add the env vars to `.env.example` and the AGENTS.md env and external-API sections.
- [ ] `jev/client.ts`: singleton, pinned model, usage logging (`provider: 'typesafe'`), daily cap, `JevError` kinds (`auth | rate_limited | overloaded | invalid_request | context_exceeded | unavailable`). Tests use a mocked SDK.
- [ ] Schema + migration `job_assessment` (with `db:migrate`, never `db:push`).
- [ ] `FAST_MODELS` + `resolveFastModel`.

### Phase 2 — Eligibility profile
- [ ] Add `eligibility` to `SearchProfileSchema`, and update `emptySearchProfile` and `searchProfileHasContent`. Old rows must still parse cleanly (`.catch`).
- [ ] `eligibility.ts` + tests: Irish citizen → IE, EU, GB covered; a non-Irish EU citizen → GB not covered; an expired visa is ignored; `remote_anywhere` is covered; salary: max below floor → hard, a straddling range → unconfirmed, a currency with no floor → none.
- [ ] `eligibility-card.tsx` on the search-context page, saved through the existing search-profile action.

### Phase 3 — Pipeline
- [ ] `verify.ts` + tests (code checks, pass rule over mocked Jev answers, reason text).
- [ ] Refactor `extractWithLLM` to take `profileId`. `enrich.ts` fills only empty or placeholder fields.
- [ ] `facts.ts`: cheap-model structured call (`feature: 'job-assessment-facts'`), `factsHash` cache.
- [ ] `questions.ts` + tests: the question set changes correctly with the facts and preferences (no `sponsorship` question when the user is covered, no `direction_fit` without goals, one `req_i` per requirement).
- [ ] `combine.ts` + tests: fixture answers → expected score, level and blockers, covering every row of the blocker table and the ladder boundaries (2/3, 4/5, 7/8).
- [ ] `run.ts`: claim the row → verify → (enrich → verify) → facts → judge → combine → persist. Status written at each step; every failure path ends in `failed` with a kind.
- [ ] Timing in `run.ts`: a `timed(stage, fn)` helper fills `stageTimings`. `queueTimeMs` and `processTimeMs` are written on every final update, failed runs included. Test it: a failed run still has `processTimeMs`, and skipped stages are left out.
- [ ] `queue.ts` + flag, and wire it into every trigger call site. Batch capture runs one job at a time.
- [x] Limit each profile to 2 concurrent runs at a time, enforced atomically (count + claim in one transaction under a per-profile advisory lock, 5-minute lease). `askJev`'s daily cap is now hard too: the usage row is reserved atomically before the call (PR #330 review; PR #332 security review).
- [ ] Bound Jev calls inside `after()`: pass a per-call SDK `timeout`/`retry` so a long `Retry-After` can't hold a run for minutes (PR #330 review).

### Phase 4 — UI
- [ ] `getActiveJobs` / `getJobApplicationById` include the latest run. Treat stale in-progress runs as failed.
- [ ] Pull the shared gauge and pill pieces out of `job-fit.tsx`.
- [ ] `EarlyAssessment` (pill + Popover/Drawer + detail, with Deep analysis and Re-run) + `AssessmentPoller`. Mount it on the row, the card and the sidebar's Fit Score card.
- [ ] `rerunJobAssessment` action, wired to the Re-run button inside the detail.
- [ ] Check the drawer at phone width, and keyboard focus and `aria-label` on the pill, matching `JobFit`.

### Phase 5 — Usage, compare, tune
- [ ] Admin usage: app-billed Jev card (cost, top users, runs per day, p50/p95 process time, average per stage). `FEATURE_LABELS`.
- [ ] User usage page: separate app-billed Jev rows (`provider = 'typesafe'`) from own-key usage. The page says "each call uses your own API key", which isn't true for Jev. Must ship with Phase 3 (PR #330 review).
- [ ] `scripts/assessment-compare.ts` + `npm run assess:compare`.
- [ ] Queue continuation: rows still queued when a drain hits its deadline only run on the next trigger for that profile. Add a self-continuation endpoint (secret-authenticated POST that drains) or a cron that drains profiles with queued rows, so a large batch finishes without user action (PR #332 review).
- [ ] Backfill existing jobs (owner request, 2026-11-10): an **Assess not-started jobs** action in Settings (a one-off script is the fallback). It queues non-archived jobs with status `not started` that have no `complete` assessment for the current `PIPELINE_VERSION`, newest first.
  - **Daily cap:** respect the Jev cap. Each job takes about 2–3 calls, so 300 calls is about 100–150 jobs a day. Queue in capped batches and show how many jobs are left.
  - **Depends on queue continuation** (the item above), so a large backfill finishes without further triggers.
- [ ] Admin card: skip `stageTimings.requeues` when averaging stage times.
- [ ] Run it over your active jobs. Hand-check the disagreements, adjust `ASSESSMENT_CONFIG`, and bump `PIPELINE_VERSION` on each change.
- [ ] `docs/job-assessment.md`.

**Verification for each phase:** `npm run typecheck`, `npm run lint`, and the relevant unit tests. At the end of Phase 4, add a job by URL locally and watch the row go through each status to a result. Then add a LinkedIn preview URL (thin description) and check that it fetches or ends in Needs attention.

---

## Risks / notes

- **Background work dies with the request.** `after()` is limited by the route's max duration (300s by default on Vercel). One run is a few seconds, so it fits; a slow fetch can stall the run, which the stale-run rule covers. If batch volume grows, move to Vercel Queues; the `run(assessmentId)` entry point already fits that.
- **Cheap-model cost is the user's.** Facts are cached by job hash, so changing the profile or eligibility only costs Jev calls.
- **Jev answers depend on the model version.** It's pinned to `jev-1.14.0`, and the version is stored on each run. Upgrading means a new `PIPELINE_VERSION` and a fresh compare.
- **Untrusted job description.** It reaches the cheap model only through structured output, and Jev can only choose among our options, so the injection surface is small. Never interpolate fetched page text into the system prompt.
- **The current `jobFit` is not touched.** The side-by-side ends with a separate PR that decides on replacement and cleanup, including the three duplicated assessors noted in review and the `chat/tools.ts` `jobFit.summary` bug.
