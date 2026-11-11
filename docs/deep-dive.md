# Job deep dive (backend)

A user-triggered report on one job: should they apply, and how. Billed to the user's own LLM key. Spec: `docs/superpowers/specs/2026-11-11-job-deep-dive-design.md`; this is build step 4 (#360). The report page, the re-wired button, writing `jobAnalysis` and retiring `assessJobFit` are step 5.

## Pipeline (`src/modules/deep-dive/`)

| Stage | File | LLM | Notes |
|---|---|---|---|
| Gather | `gather.ts` | none | Job, profile snapshot, search profile, newest complete `JobAssessment`, sponsor register status, fresh `CompanyResearch`. Splits the public `ResearchBrief` from everything private. |
| Research | `research.ts` | `role: 'research'` + `webSearch`, then `role: 'fast'` | Three researchers in parallel (company 5 searches, pay 5, practicalities 3). They get the `ResearchBrief` only: no profile, goals or notes. |
| Synthesis | `synthesise.ts` | `role: 'analysis'`, JSON in text | The only step that judges. Output: `DeepDiveReportSchema` (`schema.ts`), validated with Zod. |
| Run | `run.ts` | | Admission, status updates, failure mapping, company research cache. |
| Read | `queries.ts` | | Newest run as a view; stale runs read as failed / timeout; per-run usage from `LlmUsageLog.runId`. |

No feature code names a model: roles pick the model from the user's settings (`src/modules/llm/roles.ts`).

### Checks done in code, not by a model

- **Sources.** A finding citing a URL must cite one the search returned (`sources`) or wrote in its notes; a finding with no URL must quote the job ad word for word. Others are dropped. When the provider reports no URLs at all, URL findings are kept at `low` confidence.
- **Register and sponsorship need.** `practicalities.sponsorship.register` always comes from the UK register (`companies/queries.ts`); `needed` comes from the user's work rights when they settle it (`gather.ts`, `sponsorshipNeeded`).
- **Evidence.** Evidence pointing at a finding index that doesn't exist is dropped. A `pay.market` range with no finding behind it is dropped (no invented pay).

## Rows

- `JobDeepDive` (`prisma/schema/job-deep-dive.prisma`): one row per run, never written after `complete` / `failed`. Its `id` is the `runId` on every LLM usage row of the run. `inputsHash` is set by the gather stage (nullable until then).
- `CompanyResearch` (`prisma/schema/company.prisma`): the company researcher's findings, shared across users (public facts only), fresh for 30 days. A second job at the same company skips the company researcher. Only web-sourced findings are stored (a job-ad quote belongs to one ad), and nothing is stored from an agency's ad (the researcher may have researched the hiring company, not the agency the job is linked to).

## Limits and timing

- One active run per job: a second start returns the running one (`existing: true`).
- At most 2 active runs per profile, admitted under a per-profile advisory lock. A third start is refused (`429 limit`); there is no queue.
- Runs execute in `after()`; routes that start one set `maxDuration = 300`.
- Research budget 120s in total (search calls get up to 90s); a researcher over budget is marked `timeout` and the run continues. Synthesis budget 120s; over it, the run fails with `timeout`.
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

`deep-dive:research:company`, `deep-dive:research:pay`, `deep-dive:research:practicalities`, `deep-dive:structure`, `deep-dive:synthesis`. Every call carries `attribution: { jobApplicationId, runId: deepDive.id }`.

## Providers

**Anthropic is the supported provider for now.** OpenAI and Google are out of scope: the LLM layer already maps their web search tools (`src/modules/llm/web-search.ts`) and the schemas avoid optional fields and unions, so adding them later is a matter of testing, not rework. Until then they aren't tested with the deep dive.

## Anthropic structured output limits (found live)

- **At most 16 nullable/union parameters per schema.** The report's evidence objects are plain strings (`kind`, `ref`, `detail`, "" when unused) for this reason; `schema.test.ts` fails if a schema goes over 16.
- **"The compiled grammar is too large"**: the full report schema is too big for constrained decoding even under that limit. Synthesis therefore asks for JSON in text (`completeJSON`, the same path as the master CV): the JSON Schema is in the system prompt, the output is validated with the Zod schema, and a cut-off answer is retried once with a 32k cap. The research `structure` call keeps native structured output: its schema is small and works.

## Measured (Anthropic, 2026-11-11)

Research stage, `research` = Sonnet 5.5, `fast` = Haiku 5.5, real Greenhouse postings (Monzo, Intercom ×2, Cloudflare, GitLab), 4 runs with all three researchers live:

| | Per run |
|---|---|
| Time per researcher | 35–60s (budget 120s) |
| Findings per researcher | 11–15 (cap 15), every one sourced or quoting the ad |
| Pages reported by search | 18–48 per researcher |
| Tokens (3 searches + 3 structuring calls) | ~200–260k in, ~15–24k out |
| Server tool calls (search + fetch) | 23–27 |
| Estimated token cost | $0.46–0.60, plus Anthropic's per-search fee |

Not yet measured: synthesis (blocked first by the two schema limits above, then by the test key running out of credit), the Haiku-for-research comparison, and so the full cost per run. `ROLE_RECOMMENDATIONS.anthropic` `research` / `analysis` stay `null` until then. The GET response's `usage` gives tokens, searches and estimated cost per run.
