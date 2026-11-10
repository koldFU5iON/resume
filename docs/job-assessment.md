# Early job assessment (Jev)

Maintainer guide to the early job assessment. The design rationale and every question and rule are in
[the design spec](superpowers/specs/2026-11-10-jev-early-assessment-design.md); the build plan is in
[the plan](superpowers/plans/2026-11-10-jev-early-assessment.md). This page describes what the code does today.

Code: `src/modules/job-assessment/` (pipeline, queue, queries), `src/modules/jev/client.ts` (Jev client).

## What it is, and how it sits alongside JobFit

The early assessment gives every captured job a fast 1–10 score and a level (weak, consider, pursue, priority) the
moment it is saved, with blockers, strengths, gaps and "check these" notes. It reads the job description and the user's
profile and answers a fixed set of typed questions with Jev, TypeSafe's System One model.

**JobFit** (`src/modules/jobs/job-fit.ts`) is the older, on-demand assessment: one Claude call on the user's own key,
rated 0–10, stored on `JobApplication.jobFit`. The two run side by side and neither replaces the other. Differences:

| | Early assessment | JobFit |
|---|---|---|
| Trigger | Automatic when a job is created or edited, plus Re-run | User clicks assess |
| Model | Jev (app-billed) plus the user's cheap model for facts | The user's LLM, own key |
| Output | Score 1–10, level, blockers, strengths, gaps | Rating 0–10, label, free-text justification |
| Stored in | `JobAssessment` (one row per run, history kept) | `JobApplication.jobFit` (overwritten) |

`npm run assess:compare` prints them side by side (see Tuning).

## Pipeline

One run is `runJobAssessment` in `run.ts`. It never throws: any error ends the row in `failed` with a `failureKind`.

```
queued → checking → verify ── fail + URL ──► fetching (enrich) ──► verifyRetry ── fail ──► failed (verification)
                      │ pass                                          │ pass
                      ▼◄──────────────────────────────────────────────┘
                    assessing: facts → judge → combine → complete
```

1. **Verify** (`verify.ts`, `questions.ts`). Code checks first (title and company not placeholders, description at least
   `verify.minDescriptionChars`), then two Jev questions: `is_full_description` and `has_requirements`. Pass needs both
   above their thresholds. Jev is never called on an empty job.
2. **Enrich** (`enrich.ts`). Only when verify fails and the job has a URL: fetch the page once and let the user's cheap
   model fill fields that are empty or placeholders (title, company, description, countries, salary band). It never
   overwrites a value the user entered, and writes only if those fields are unchanged since they were read. Then verify
   runs once more (`verifyRetry`).
3. **Facts** (`facts.ts`). The user's cheap model (`resolveFastModel`, temperature 0) turns the description into
   `JobFacts`: requirements (kind, must/nice, years, parts), location, salary, seniority, employment type. Results are
   cached by `factsHash` (version, title, company, description and hints), so re-running after a profile change costs
   Jev calls only.
4. **Judge** (`run.ts`, `questions.ts`). One Jev request with the candidate state (`candidate-state.ts`), the job and the
   user's preferences, asking per-requirement fit, skills match, seniority fit, domain fit, years-share per role
   (asked in both option orders), eligibility and dealbreakers.
5. **Combine** (`combine.ts`). Pure code turns the answers into the score, level, blockers, strengths, gaps and
   unsettled items. All decisions are visible and unit-tested; Jev only supplies judgements.

Each stage's duration lands in `JobAssessment.stageTimings`. Skipped stages are omitted.

## Scoring and the ladder

```
coverage  = Σ w·p / Σ w          (w: must 2, nice 1)
composite = weighted coverage, skills, seniority, domain (+ direction when asked), minus 0.05 if max pay is below target
score     = clamp(round(1 + 9·composite − penalty), 1, 10)
penalty   = min(2, 0.5 · (major gaps + years warnings + years stretches))
```

Level ladder (`ASSESSMENT_CONFIG.ladder`): 1–2 weak, 3–4 consider, 5–7 pursue, 8–10 priority. A run with any hard
blocker is shown as "Blocked · n/10"; `level` is still stored for tuning. All weights and thresholds live in
`ASSESSMENT_CONFIG` in `schema.ts`.

## Blockers and the years rule

Blockers come from `combine.ts` and `eligibility.ts`: credentials below the gap threshold, work rights, relocation,
pay against the user's floor, dealbreakers, and the years rule. Severities: `hard` (makes the result Blocked),
`unconfirmed` (amber, "check this"), and for years `warn` and `stretch` (amber, count toward the penalty). Major gaps on
experience or skill must-haves are not blockers; they go to `gaps` and the penalty.

The years rule estimates years in an area from the CV timeline and Jev's per-role share answers, all arithmetic in
code. Status is met, warn, stretch or block. Tables and worked examples: spec section 5 ("Combine rules").

## Environment variables

| Variable | Effect |
|---|---|
| `TYPESAFE_API_KEY` | App-level key for Jev. Blank disables the assessment: nothing is queued (a run that started and then lost the key fails `not_configured`). Server-side only. |
| `JOB_ASSESSMENT_V2` | Rollout: `off` (nothing), `admin` (admins only; also the default for unset or unknown values), `all`. |
| `JEV_DAILY_CALL_LIMIT` | Hard cap on Jev calls per profile per day (default 300). |

The facts and enrich steps use the user's own LLM key, so a user without one fails with `no_llm_key`.

## Data model

`JobAssessment` (`prisma/schema/job-assessment.prisma`): one row per run of a `JobApplication`. A row is not updated
after it reaches `complete` or `failed`; re-assessing inserts a new row. The newest row per job is current; older rows
stay for comparison.

Key columns: `status` (queued, checking, fetching, assessing, complete, failed), `failureKind`, `failureReasons`,
`pipelineVersion`, `facts`, `signals` (raw Jev answers by question id), `request` (exact Jev bodies, so a run can be
replayed), `jevModel`, `score`, `level`, `blocked`, `blockers`, `strengths`, `gaps`, `unsettled`, `enrichedFields`,
`factsHash`, and timings: `queueTimeMs` (created to started), `processTimeMs` (started to finished, written for
failed runs too), `stageTimings`. `stageTimings.requeues` is a count of re-queues, not a duration: skip it when
averaging.

Jev calls are logged to `LlmUsageLog` with `provider = 'typesafe'` (see Usage tracking).

## The queue

`queue.ts`. `queueJobAssessment` inserts a `queued` row (marking older queued rows of the same job `failed` /
`superseded`) and schedules `drainProfileQueue(profileId)` with `after()`. Triggers (`QueueReason`): created, edited,
salary, quick-capture, capture, job-hunt-import, manual (Re-run). Call sites use `queueJobAssessmentSafely` so the
assessment never breaks the original action.

- **Concurrency.** At most `ASSESSMENT_CONCURRENCY_PER_PROFILE` (2) runs in progress per profile. `admitNextRun` counts
  running rows and claims the next queued one in one transaction under a per-profile Postgres advisory lock, so drains
  on different instances can't overshoot. A drain that finds the limit reached just returns.
- **Deadlines.** Routes that queue export `maxDuration = ROUTE_MAX_DURATION_S` (300s). The drain's budget is that minus
  a 15s margin. A new run starts only while at least `MIN_RUN_START_MS` (60s) is left, and each stage starts only if the
  time left covers its worst case (`STAGE_WORST_MS` in `run.ts`). Otherwise the row goes back to `queued` and the
  stage's partial results are cleared; after `MAX_REQUEUES` (3) it fails with "kept running out of time".
- **Stale rules.** An in-progress row whose `startedAt` is older than `IN_PROGRESS_STALE_MS` (5 min) is treated as dead
  (its `after()` was killed): it stops counting towards concurrency and reads as failed / `error` in the UI. A queued
  row older than `QUEUED_STALE_MS` (15 min) is failed at the next drain start ("Timed out before it started") and the UI
  already shows it as timed out. Reads never write.
- **Stranding.** A drain that ends because the queue looked empty checks once more after releasing its slot, up to
  `MAX_RESCHEDULES` (3) times.

## Queue continuation and backfill

Added in a follow-up PR. To be filled in.

## Usage tracking and the admin card

Every Jev call goes through `askJev()` (`src/modules/jev/client.ts`): it reserves a `LlmUsageLog` row (provider
`typesafe`, zero tokens) inside a transaction holding a per-profile advisory lock, enforcing `JEV_DAILY_CALL_LIMIT`,
then fills in model, tokens and latency. A failed call keeps its row with the feature suffixed `:failed`, and counts
towards the cap. Features: `job-assessment-verify`, `job-assessment-judge` (Jev) and `job-assessment-enrich`,
`job-assessment-facts` (user's key, so they appear on the user's own usage page). Labels live in
`src/app/dashboard/settings/usage/_components/feature-labels.ts`; `featureLabel()` adds "(failed)" for `:failed` tags.

The user's usage page leaves Jev rows out of every token total and only shows a count of included assessments.

Admins also see an **App-billed (Jev)** card on `/dashboard/settings/usage` (`getJevAdminSummary` in
`src/modules/llm/usage.ts`, all SQL aggregates, current calendar month):

- calls, failed calls, input and output tokens
- estimated cost: input tokens times `JEV_USD_PER_MILLION_INPUT_TOKENS` ($0.042 per million; output is free), in
  `usage-stats.ts`. Update it if TypeSafe pricing changes.
- top users by assessment runs: total, average per active day, p95 per day
- p50 and p95 of `processTimeMs`, for complete and failed runs
- average time per stage (skipping `requeues`)
- runs by status, and complete runs by level

## UI

`src/app/dashboard/job-applications/_components/`: `early-assessment.tsx` (pill on job rows and cards, detail panel with
Re-run), `early-assessment-view.ts` (labels, colours, filters, formatting; pure), `assessment-poller.tsx` (polls while a
run is pending). The job list has an early-level filter (priority, pursue, consider, weak, blocked, needs attention,
not assessed). Read models come from `queries.ts`, which maps stale runs to failed.

## Tuning

1. Change numbers in `ASSESSMENT_CONFIG` (`schema.ts`). Question wording is in `questions.ts`; never edit thresholds in
   the pure modules.
2. Bump `PIPELINE_VERSION` on any change to wording, thresholds, weights or the Jev model, so runs under different
   tunings are never mixed up. It also invalidates the facts cache.
3. Re-run the jobs you care about, then compare:

   ```bash
   npm run assess:compare -- --profile <profileId|email> [--version <pipelineVersion>] [--csv tmp/compare.csv]
   ```

   Read-only. It lists each job's JobFit and latest complete early run for that version, flags disagreements first,
   and prints level counts, the mean absolute score difference and the Spearman rank correlation. JobFit ratings
   (0–10) go through the same ladder as early scores (rounded; 0 counts as weak) so both are bucketed identically. A
   job is flagged when the buckets are two or more steps apart, or the early result is blocked while JobFit says pursue
   or priority. The script refuses a non-local `DATABASE_URL` unless `--allow-remote`, and CSVs must go under the
   gitignored `tmp/`. Logic is in `compare.ts` with unit tests.

## Troubleshooting by failureKind

Shown to users via `failureSummary()` in `early-assessment-view.ts`.

| failureKind | Meaning | What to check |
|---|---|---|
| `verification` | Job details too thin to assess, even after fetching the page | The job's description, title and company. Edit the job, then Re-run. |
| `no_llm_key` | The user has no LLM key for facts and enrich | User must add a key in LLM settings. |
| `not_configured` | `TYPESAFE_API_KEY` unset when the run started | Env var on the deployment. |
| `daily_cap` | Profile hit `JEV_DAILY_CALL_LIMIT` (failed calls count) | Look for a failure loop in `LlmUsageLog` (`:failed` rows); raise the limit only deliberately. |
| `rate_limited` | TypeSafe 429 after retries | Wait and Re-run. |
| `overloaded` | TypeSafe 529 after retries | Wait and Re-run. |
| `superseded` | A newer run for the job was queued before this one started | Expected; no action. |
| `error` | Anything else; also how a stale run reads in the UI | `failureReasons` on the row; a too-long description plus profile reads "too long to assess together". |

A run stuck in `queued` with no trigger expires after 15 minutes; one stuck in progress is treated as dead after 5.
