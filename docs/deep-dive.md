# Job deep dive

A user-triggered report on one job: should they apply, and how. Billed to the user's own LLM key. Spec: `docs/superpowers/specs/2026-11-11-job-deep-dive-design.md`. The backend is build step 4 (#360); the UI, writing `jobAnalysis` and retiring `assessJobFit` are step 5 (#363, see [UI](#ui) below).

## Pipeline (`src/modules/deep-dive/`)

| Stage | File | LLM | Notes |
|---|---|---|---|
| Gather | `gather.ts` | none | Job, profile snapshot, search profile, newest complete `JobAssessment`, sponsor register status, fresh `CompanyResearch`. Splits the public `ResearchBrief` from everything private. |
| Research | `research.ts` | `role: 'research'` + `webSearch`, then `role: 'fast'` | Three researchers in parallel (company 5 searches, pay 5, practicalities 3). They get the `ResearchBrief` only: no profile, goals or notes. |
| Synthesis | `synthesise.ts` | `role: 'analysis'`, JSON in text | The only step that judges. Output: `DeepDiveReportSchema` (`schema.ts`), validated with Zod. |
| Run | `run.ts` | | Admission, status updates, failure mapping, company research cache. |
| Read | `queries.ts` | | A run as a view (newest, or one by id); stale runs read as failed / timeout; per-run usage from `LlmUsageLog.runId`. Summaries for job lists (`getDeepDiveSummaries`, two queries) and the run list. |
| After complete | `job-analysis.ts`, `gather.ts` | none | Writes `JobApplication.jobAnalysis` from the report; queues search-profile suggestions. Best effort: neither can fail a complete run. |
| Access | `access.ts` | | Whether the user has a key, and whether their provider's research is `tested` (Anthropic), `untested` (OpenAI, Google) or `none`. |

No feature code names a model: roles pick the model from the user's settings (`src/modules/llm/roles.ts`).

### Checks done in code, not by a model

- **Sources.** A finding citing a URL must cite one the search returned (`sources`) or wrote in its notes; a finding with no URL must quote the job ad word for word. Others are dropped. When the provider reports no URLs at all, URL findings are kept at `low` confidence.
- **Register and sponsorship need.** `practicalities.sponsorship.register` always comes from the UK register (`companies/queries.ts`); `needed` comes from the user's work rights when they settle it (`gather.ts`, `sponsorshipNeeded`).
- **Evidence.** Evidence pointing at a finding index that doesn't exist is dropped. A `pay.market` range that cites no pay-researcher finding is dropped (no invented pay).

## Rows

- `JobDeepDive` (`prisma/schema/job-deep-dive.prisma`): one row per run, never written after `complete` / `failed`. Its `id` is the `runId` on every LLM usage row of the run. `inputsHash` is set by the gather stage (nullable until then).
- `CompanyResearch` (`prisma/schema/company.prisma`): the company researcher's findings, shared across users (public facts only), fresh for 30 days. A second job at the same company skips the company researcher. The job ad is user-supplied, so the shared copy is stricter than the run's own findings (`shareableFindings` in `research.ts`): a finding is stored only if its URL is a page the provider reported fetching (not just a URL the model wrote in its notes) and its site isn't named in the ad. That stops one user's ad from planting facts in other users' reports. Nothing is stored from an agency's ad, and agency jobs never read the cache: the researcher may have researched the hiring company, not the agency the job is linked to.

## Limits and timing

- One active run per job: a second start returns the running one (`existing: true`).
- At most 2 active runs per profile, admitted under a per-profile advisory lock. A third start is refused (`429 limit`); there is no queue.
- Runs execute in `after()`; routes that start one set `maxDuration = 300`.
- Research budget 120s in total (search calls get up to 90s); a researcher over budget is marked `timeout` and the run continues. Synthesis budget 120s per attempt. The whole run also has one deadline, 280s after it starts (`TIME_BUDGET_MS.run`, under the route's 300s): research and both synthesis attempts are capped by it, and the cut-off retry is skipped with under 30s left. Over it, the run fails with `timeout` on its row instead of being killed mid-stage.
- A run still active after 10 minutes reads as failed / `timeout` and stops counting towards the limits.
- Output caps: research notes 4k tokens, structuring 8k, synthesis 16k (#359). Invalid structured output logs `finishReason`, so truncation (`length`) is visible.

## Failure kinds

`no_llm_key`, `no_description`, `timeout`, `rate_limited`, `overloaded`, `refusal`, `error`. A failed researcher never fails the run: the synthesis is told which topics have no research and lists them in `unknowns`.

With a provider that has no web search tool, every researcher is skipped (`no_web_search`) and the report is built from the job ad, profile, early assessment and register.

## API

Session cookie, or `Authorization: Bearer rsm_…` with the `deep-dive:run` scope (Settings → API tokens → "Capture jobs and run deep dives").

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" https://<host>/api/jobs/<jobId>/deep-dive
# 202 {"deepDiveId":"…","existing":false}
curl -H "Authorization: Bearer $TOKEN" https://<host>/api/jobs/<jobId>/deep-dive
# 200 { id, status, failureKind, report, research, outOfDate, usage, … }
```

| Status | Body `error` | When |
|---|---|---|
| 202 | | Started, or already running (`existing: true`) |
| 401 / 403 | `unauthorized` / `forbidden` | No session or token / token without `deep-dive:run` |
| 404 | `not_found` | Not the caller's job, or (GET) no deep dive yet |
| 422 | `no_description` / `no_llm_key` | |
| 429 | `limit` | Two deep dives already running for this profile |

The Server Action `startDeepDiveAction(jobId)` (`actions.ts`) calls the same `startDeepDive`.

## Usage tags

`deep-dive-research-company`, `deep-dive-research-pay`, `deep-dive-research-practicalities`, `deep-dive-structure`, `deep-dive-synthesis`. Every call carries `attribution: { jobApplicationId, runId: deepDive.id }`.

## Providers

**Anthropic is the supported provider for now.** OpenAI and Google are out of scope: the LLM layer already maps their web search tools (`src/modules/llm/web-search.ts`) and the schemas avoid optional fields and unions, so adding them later is a matter of testing, not rework. Until then they aren't tested with the deep dive.

## Anthropic structured output limits (found live)

- **At most 16 nullable/union parameters per schema.** The report's evidence objects are plain strings (`kind`, `ref`, `detail`, "" when unused) for this reason; `schema.test.ts` fails if a schema goes over 16.
- **"The compiled grammar is too large"**: the full report schema is too big for constrained decoding even under that limit. Synthesis therefore asks for JSON in text (`completeJSON`, the same path as the master CV): the JSON Schema is in the system prompt, the output is validated with the Zod schema, and a cut-off answer is retried once with a 32k cap. The research `structure` call keeps native structured output: its schema is small and works.

## Measured (Anthropic, 2026-11-11)

Real Greenhouse postings (Monzo, Intercom ×2, Cloudflare, GitLab), driven through the real route on a local dev server. Token costs are list-price estimates; web search is billed per search on top.

| | Sonnet 5.5 research | Haiku 5.5 research |
|---|---|---|
| Research time per researcher | 35–60s | 25–45s |
| Findings per researcher | 11–15 | 0–15 (pay: 0 and 4) |
| Research tokens per run | ~200–260k in, ~15–24k out | ~170–355k in, ~16–20k out |
| Search + fetch calls per run | 23–27 | 18–29 |
| Research token cost | ~$0.46–0.60 | ~$0.05 |

Synthesis (`analysis` = Opus 5.5), 7 runs: ~10–15k in, ~7–9k out, 58–84s, ~$0.18–0.25. Full run: ~1.5–2.5 minutes, **~$0.70–0.85 with Sonnet research** plus searches; a cached company saves about a third of the research.

**Recommendations** (`ROLE_RECOMMENDATIONS.anthropic`): `research` Sonnet 5.5, `analysis` Opus 5.5, `fast` Haiku 5.5. Haiku research is about 4× cheaper but much thinner: on Monzo its pay researcher searched 45 pages and wrote no notes. Such a researcher now fails as `no_notes:<finishReason>` so the report lists pay as unresearched.

Report quality on the test profile: verdicts were calibrated (long shot / don't apply for principal-PM roles on a programme-manager profile, apply with caveats for the matching Senior Program Manager role), profile evidence quoted real profile items, pay asks cited findings and noted when the ad gave two ranges, and register vs ad wording were reported separately.

Not covered: the early-assessment path (no Jev assessments on the local test jobs), and OpenAI / Google (out of scope).

## UI

- **Report page** `/dashboard/job-applications/view/[id]/deep-dive` (`?run=<id>` for an earlier run). One reading column (verdict, blockers, gaps, strengths, pay, practicalities and sponsorship, company, CV strategy, questions and unknowns, sources) and a side panel: the run's date, its estimated cost from the `runId` usage rows, the models, **Run again**, **Copy as Markdown** (the whole report with evidence and numbered sources, built by `reportToMarkdown` in `_components/report-text.ts`, for review in another LLM), the contents and the list of runs. While the newest run is active the page shows its stage and polls every 3s with `AssessmentPoller` (the signature is `id:status`, so each new stage restarts the fast window). A complete run whose `inputsHash` no longer matches shows "Out of date" with **Run again**. Evidence is shown inline: job-ad quotes and profile items in words, findings as numbered links into Sources. The page sets `maxDuration = 300` because Run again starts a run.
- **Deep dive button** (`_components/deep-dive-button.tsx`) in the early assessment popover, on every complete assessment, blocked ones included (no gate). No run yet: starts one and opens the page. A run exists: opens the page and shows the verdict chip. No key: disabled, with a link to Settings → LLM. The job list passes access through `DeepDiveAccessProvider`; the job page passes it directly.
- **Job page sidebar:** a Deep dive card under Fit score, with the newest verdict and a link to the report (or the stage while running).
- **Providers:** Anthropic shows nothing extra. OpenAI and Google: "Deep dives are tested with Anthropic. With <provider>, web research runs but hasn't been tested, so check the sources." A provider with no web search: "No web research with your provider".

## `jobAnalysis` from the report

A complete run writes `JobApplication.jobAnalysis` and `jobAnalysedAt` (`reportToJobAnalysis`, `job-analysis.ts`) when it has requirements to base it on, so CV generation, cover letters, the writing guide and career-vertical use it without another call:

| Field | From | Cap |
|---|---|---|
| `mustHave` | The early assessment's must requirements, else the job's existing `jobAnalysis.mustHave` | 10 |
| `niceToHave` | The early assessment's nice requirements, else the existing `niceToHave` | 8 |
| `risks` | Open blockers (hard → high, confirm with recruiter → medium) and gaps (not closable → high, later → medium, now → low), most serious first | 6 |
| `positioningStrategy` | `cvStrategy.positioning`, plus "Lead with" and "Play down" | |

The caps match the `JobAnalysisSchema` descriptions (#362). Blockers and gaps go to `risks` only, never `mustHave`: they're about this run, and putting them in the requirement lists would carry resolved ones into the next run. With no facts and no existing analysis nothing is written, so CV generation still runs `analyseJob` for the full requirements.

## Retired: `assessJobFit`

`src/modules/jobs/job-fit.ts` is gone and nothing writes `jobFit` any more. The `JobFit` pill still shows existing data, is hidden once the job has a complete deep dive, and its Assess / Re-assess start a deep dive. Its two search-profile suggestion rules (a salary floor in the job notes, a title outside the target roles) moved to `searchProfileSuggestions` in `gather.ts` and run after a complete deep dive, with source `deep-dive`. Dropping the `jobFit` columns and the `job-fit` usage label is a later change with a migration.
