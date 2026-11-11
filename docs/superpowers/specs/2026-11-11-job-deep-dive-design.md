# Job Deep Dive — Design Spec

**Status:** Design agreed in discussion on 2026-11-11. Steps 2–3 merged; step 4 (backend) built in #360, see `docs/deep-dive.md`. Step 5 (UI) not built.
**Depends on:** #345 (LLM usage → job attribution), merged in #347: `attribution: { jobApplicationId, cvDocumentId, runId }` on LLM calls, plus `serverToolCalls`, cache tokens and failed-call rows on `LlmUsageLog`.
**Related:** `2026-11-10-jev-early-assessment-design.md` (the early assessment this builds on), `2026-11-11-profile-map-design.md` (the evidence links the report cites).

---

## 1. What it is

Two separate features answer "should I go for this job?":

| | Early assessment (Jev) | Deep dive (this spec) |
|---|---|---|
| Trigger | Automatic, on every job | The user presses **Deep dive** |
| Billing | App-billed (`TYPESAFE_API_KEY`) | User's own key, any supported provider (the existing LLM layer) |
| Cost / time | ~$0.0005, seconds | Roughly $0.50–$1.00, 1–3 minutes (§9) |
| Output | Fit score, level, blockers, gaps, "check these" | A full report: verdict, cleared or confirmed blockers, a plan for each gap, pay and the suggested ask, sponsorship, company, CV strategy |
| Web access | None | Yes: researchers with web search and web fetch |

The deep dive **replaces the old `assessJobFit` / `JobApplication.jobFit`**. It reuses that feature's input gathering (profile snapshot, writing rules, search-profile goals) and its error handling. Existing `jobFit` data stays readable, and nothing writes to it once the deep dive ships (§10).

The early assessment stays as it is. It's the deep dive's **starting point**: its facts, blockers (especially `severity: 'unconfirmed'`), years breakdown, gaps and `unsettled` must-haves set the deep dive's agenda.

## 2. Decisions

| Decision | Choice | Why |
|---|---|---|
| Who pays | The user's own key, through `src/modules/llm/` | The billing route already exists. No new app-billed path. |
| Provider and model | **Never named in feature code.** Each stage asks for a **model role** (`research`, `analysis`, `fast`). The user's settings decide which model fills each role (§3.0). | Users bring Anthropic, OpenAI or Google keys. The app shouldn't decide that Claude does research. Recommended models per provider are data, not code. |
| Web search | A capability of the LLM layer, mapped per provider | The installed SDKs all have a search tool: `@ai-sdk/anthropic` (`webSearch_20260209`, `webFetch_20260209`), `@ai-sdk/openai` (`webSearch`) and `@ai-sdk/google` (`googleSearch`, `urlContext`). OpenAI and Google haven't been tested here yet. |
| Blocked jobs | **Allowed, no gate** | A deep dive is how the user checks whether Jev got a blocker wrong. `canDeepAnalyse` is removed. |
| Research vs judgement | Researchers **only gather**. One synthesis call judges. | Researchers stay cheap, narrow and replaceable. All judgement sits in one place, with every input in front of it. |
| Facts we can look up for certain | Use code, not a model | The UK sponsor licence comes from the Home Office register (§5), not from web search. |
| Profile data in research | **Never sent to researchers** | Researchers only need public information (company, title, location, the job description). This keeps personal data out of search queries and the prompts cheap. |

## 3. Pipeline

```
 Deep dive pressed
        │
        ▼
 ┌─────────────┐   no LLM
 │ 1. Gather   │   profile snapshot · job description · newest JobAssessment
 │             │   · salaryEstimate · company match + SponsorLicence
 │             │   · cached CompanyResearch (if fresh)
 └─────┬───────┘
       ▼
 ┌─────────────┐   role: research (+ web search), in parallel, no profile data
 │ 2. Research │   company · pay · practicalities   → findings[]
 └─────┬───────┘   (structuring the notes: role: fast)
       ▼
 ┌─────────────┐   role: analysis, structured output, no tools
 │ 3. Synthesis│   everything above → DeepDiveReport (§6)
 └─────┬───────┘
       ▼
   Persist report · write JobAnalysis (§7) · cache company findings
```

### 3.0 Model roles (a prerequisite in the LLM layer, shared by every feature)

Feature code declares **what kind of work** a call is. The LLM layer picks the model from the user's settings. This replaces `FAST_MODELS` / `resolveFastModel` and the per-feature `opts.model` choices.

**Roles** (a fixed list in `src/modules/llm/roles.ts`):

| Role | Used for | Needs |
|---|---|---|
| `default` | Writing and generation: CVs, cover letters, chat. The user's current `llmModel`. | — |
| `fast` | Extraction, structuring, classification, high-volume steps (job facts, enrichment, turning research notes into findings) | Structured output |
| `research` | Gathering facts from the web, no judgement | A web search tool on the provider |
| `analysis` | Long reasoning over a lot of context: deep-dive synthesis, fit judgement | Structured output; large context |

**Settings:**
- **Storage:** `UserSettings.llmModelRoles Json?`, in the shape `{ fast?: string, research?: string, analysis?: string }`, with model ids from the user's `availableModels`. Zod-validated; native JSON per AGENTS.md.
- **Settings page:** `/dashboard/settings/llm` gets a **"Models by task"** section with one dropdown per role. Each dropdown lists the user's available models plus "Same as my default model", and shows a recommended model where one is known.

**How a role resolves to a model:**
1. The user's explicit choice for that role, if it's still in `availableModels`
2. Otherwise the provider's **recommended** model for that role, if it's in `availableModels`
3. Otherwise the user's default model

**Recommendations** are a data table in `roles.ts` (`ROLE_RECOMMENDATIONS[provider][role]`). They're only used to prefill the settings page and as the fallback in step 2. An entry stays `null` until a model has been checked against the feature, so OpenAI and Google start mostly `null` and fall back to the user's default model.

**LLM layer API:**
- `complete` and `completeStructured` take `role?: ModelRole`, which defaults to `'default'`. Explicit `opts.model` is kept only for tests and admin tools.
- `webSearch?: { maxUses: number, allowedDomains?: string[] }` turns on the provider's search tool. If the provider has none, the layer throws `LLMError` with kind `unsupported`.
- **Usage:** `LlmUsageLog` gains `role String?`, so the usage page can break spend down by role as well as by feature and job (#345). Every row already records the model actually used.

**What this changes for the deep dive:**
- The deep dive needs a key for any provider whose web search the layer supports. Without one, research is skipped, and the report is built from the job description, profile, early assessment and sponsor register, marked "No web research".
- `JobDeepDive.researchModel` / `synthesisModel` record what was actually used, so runs on different models can be compared.

**Migrating existing callers:** `facts.ts`, `enrich.ts` and `extract-llm.ts` move from `resolveFastModel` to `role: 'fast'`. `FAST_MODELS` becomes the `fast` column of `ROLE_RECOMMENDATIONS`.

**Status (#350):** built. Web search mapping per provider (`src/modules/llm/web-search.ts`), unit-tested against the installed SDK tool factories:

| Provider | Mapping | Live test |
|---|---|---|
| Anthropic | `webSearch_20260209` + `webFetch_20260209`, `maxUses` and `allowedDomains` on both | Yes, with the deep dive (#360, 2026-11-11): Sonnet 5.5 and Haiku 5.5 |
| OpenAI | `webSearch` with `filters.allowedDomains`; no per-call use limit, so `maxUses` isn't enforced | Not yet: no key |
| Google | `googleSearch`; no use limit or domain filter; searches counted from `groundingMetadata.webSearchQueries` | Not yet: no key |

Record live results here once tried with real keys (step 2 of the build order).

### 3.1 Gather (no LLM)

- Job: title, company, `countries`, `jobDescription`, `salaryBand`, notes (only when `notesIncludeInFit`)
- Profile: `buildProfileSnapshot` plus `serializeProfileForLLM`, the same as `assessJobFit`. Writing rules and the search profile come with it: goals, `eligibility`, salary floors, dealbreakers.
- Early assessment: the newest `complete` `JobAssessment` for the job, if there is one. Its `id` is stored as `sourceAssessmentId`. With no assessment the deep dive still runs, and the report says it had no early assessment to build on.
- `salaryEstimate`, if present
- Company: match `JobApplication.company` to a `Company` row (§5). Load its `SponsorLicence` rows and any `CompanyResearch` younger than its TTL.

### 3.2 Research

Three researchers run in parallel. Each gets a narrow brief, a `max_uses` limit on search, and the same output shape. **No researcher assesses fit.**

| Researcher | Brief | Search budget | Skipped when |
|---|---|---|---|
| `company` | What they do, size and stage, office locations, recent news (12 months), hiring signals (layoffs, freezes, growth), Glassdoor-style red flags | 5 | Fresh `CompanyResearch` exists |
| `pay` | Market range for this title, level and location. Public bands (levels.fyi-style sources, postings with salaries, government data). Note the currency and date of each figure. | 5 | Never: the result depends on the role |
| `practicalities` | Remote, hybrid or on-site policy, whether the office named in the ad exists, sponsorship or right-to-work wording in the ad, the real employer if the ad is from an agency, contract vs permanent | 3 | Never |

**Researcher output** (structured, per finding):

```ts
Finding = {
  topic: string,              // e.g. 'office_locations', 'pay_band', 'sponsorship_wording'
  claim: string,              // one factual statement, no judgement
  sourceUrl: string | null,   // null only for claims read from the job description
  quote: string | null,       // the supporting text, ≤ 300 chars
  publishedAt: string | null, // date of the source if known
  confidence: 'low' | 'medium' | 'high',
}
```

Research runs in two steps:
1. Search with tools (`role: 'research'`), writing free text with sources.
2. A structured call (`role: 'fast'`) that turns those notes into `Finding[]`.

Two steps are needed because providers don't reliably combine search tools and structured output in one request. Both calls carry the same `runId`.

**Models.** Chosen by the user's role settings (§3.0), never named here. Before shipping, run the same 10 jobs with each provider's candidate `research` models and fill in `ROLE_RECOMMENDATIONS` from the results. For Anthropic that means comparing Sonnet and Haiku; for OpenAI and Google, whichever models the test keys offer.

A failed researcher doesn't fail the run. The synthesis is told which topics have no research, and the report shows "Couldn't research X".

### 3.3 Synthesis

- `role: 'analysis'`, structured output against `DeepDiveReportSchema` (§6). No tools.
- Reasoning settings (effort, thinking) are set by the LLM layer per provider for the `analysis` role. Feature code doesn't set provider-specific options.
- Input, in this order so the stable part can be cached:
  1. Instructions
  2. Profile
  3. Job description
  4. Early assessment
  5. Sponsor register result
  6. Findings
- Rules in the prompt:
  - Every blocker, gap and pay claim cites at least one of: a job-description quote, a profile item, or a finding (by index).
  - An early-assessment blocker must end up **confirmed**, **cleared** or **still unknown**, with the reason. None is silently dropped.
  - Don't invent pay figures. With no sourced figures, the suggested ask comes from the user's own salary floors and the job's stated band, and says so.

## 4. Data model

### 4.1 `JobDeepDive` (`prisma/schema/job-deep-dive.prisma`)

One row per run. It's never updated after it reaches `complete` or `failed`, the same rule as `JobAssessment`. The newest row is the current deep dive, and older rows stay viewable.

```prisma
model JobDeepDive {
  id                 String    @id @default(cuid())
  profileId          String
  jobApplicationId   String
  sourceAssessmentId String?            // JobAssessment it built on; SetNull on delete
  /// queued | gathering | researching | synthesising | complete | failed
  status             String
  /// no_llm_key | wrong_provider | no_description | timeout | rate_limited | overloaded | refusal | error
  failureKind        String?
  failureMessage     String?
  /// sha256 of (profile snapshot, job description, salaryBand, sourceAssessmentId): drives the "out of date" banner
  inputsHash         String
  researchModel      String?
  synthesisModel     String?
  /// Finding[] per researcher, plus which were skipped or failed, and why
  research           Json?
  /// DeepDiveReport (§6)
  report             Json?
  /// Short columns for list views and filters (copied from report)
  verdict            String?            // apply | apply_with_caveats | long_shot | dont_apply
  worthTailoredCv    Boolean?
  startedAt          DateTime?
  completedAt        DateTime?
  stageTimings       Json?              // { gather, research: { company, pay, practicalities }, synthesis } ms
  createdAt          DateTime  @default(now())

  profile          Profile         @relation(fields: [profileId], references: [id], onDelete: Cascade)
  jobApplication   JobApplication  @relation(fields: [jobApplicationId], references: [id], onDelete: Cascade)
  sourceAssessment JobAssessment?  @relation(fields: [sourceAssessmentId], references: [id], onDelete: SetNull)

  @@index([jobApplicationId, createdAt])
  @@index([profileId, status])
}
```

The `JobDeepDive.id` is the **`runId`** passed to every LLM call in the run (#345). Usage per run is then a single `groupBy`.

### 4.2 `Company`, `SponsorLicence`, `CompanyResearch` (`prisma/schema/company.prisma`)

These are the foundation for the company profile (§11), built now because the deep dive needs them. All three are **shared across users and hold only public facts**. Per-user history (applications, contacts, outcomes) is never stored here.

```prisma
model Company {
  id             String   @id @default(cuid())
  name           String              // display name
  normalizedName String   @unique    // lowercased, legal suffixes stripped (ltd, limited, plc, inc, gmbh, …)
  aliases        String[]            // other normalised spellings seen in jobs or the register
  domain         String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  sponsorLicences SponsorLicence[]
  research        CompanyResearch[]
  jobApplications JobApplication[]
}

model SponsorLicence {
  id          String   @id @default(cuid())
  companyId   String
  country     String               // 'GB' (room for other registers later)
  orgName     String               // as written in the register
  townCity    String?
  county      String?
  typeRating  String               // e.g. "Worker (A rating)"
  route       String               // e.g. "Skilled Worker"
  firstSeenAt DateTime
  lastSeenAt  DateTime             // bumped on each import; rows not seen in the latest import = licence lost
  company     Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@unique([country, orgName, townCity, route])   // built (#356): the register repeats org + route across towns
  @@index([companyId])
}

model CompanyResearch {
  id         String   @id @default(cuid())
  companyId  String
  topic      String               // 'company' researcher output for now
  findings   Json                 // Finding[]
  model      String
  expiresAt  DateTime             // createdAt + 30 days
  createdAt  DateTime @default(now())
  company    Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@index([companyId, topic, createdAt])
}
```

`JobApplication` gains `companyId String?` (SetNull). On capture or edit the company name is matched to a `Company`; a new one is created when nothing matches. Existing jobs are linked by a one-off backfill in the migration's follow-up script.

**Matching.** Exact match on `normalizedName`, then `aliases`, and nothing fuzzier automatically. A near match (trigram similarity ≥ 0.85, via `pg_trgm`) is offered in the UI as "Is this X?" rather than linked silently. A wrong sponsor result is worse than none.

## 5. UK sponsor register

- **Source:** the Home Office *Register of licensed sponsors: workers* on gov.uk, published as a CSV with organisation name, town/city, county, type & rating, and route. The column names and URL get checked when this is built. The URL changes with each publication, so the importer finds the current CSV link from the gov.uk page.
- **Import:** a daily Vercel cron calls `POST /api/internal/sponsor-register/import` (HMAC-guarded like the job-assessment drain route; `/api/internal/*` is already ungated in `src/proxy.ts`). The import streams the CSV, upserts `Company` and `SponsorLicence`, bumps `lastSeenAt`, and records the run in `SponsorRegisterImport { id, sourceUrl, rows, added, removed, startedAt, completedAt }` for troubleshooting.
- **Use in the deep dive.** Code turns the register result into one of:

| Result | Meaning |
|---|---|
| `licensed` | Matched; holds a Skilled Worker licence. Shows the rating, and an amber warning if the rating is B. |
| `licensed_other_route` | Matched, but no Skilled Worker route |
| `not_listed` | Matched company name, but not on the register, or the licence was lost since the last import |
| `unknown` | No confident company match, or the job isn't in GB |

  The synthesis gets this as a fact. The UI shows **"Register: licensed (A)"** separately from the model's reading of the ad's wording. The two can disagree: some licensed sponsors won't sponsor a particular role.
- **Salary threshold.** A Skilled Worker visa needs pay above a threshold that depends on the role. Code doesn't encode those numbers. The `pay` researcher finds the current general threshold from gov.uk, and the synthesis compares it with the job's band. The finding is cited like any other, so an out-of-date figure shows its date.
- **Who it applies to.** The check only matters when the job is in GB and the user's `eligibility` doesn't cover GB, which `eligibility.ts` already works out. Otherwise the report shows "Sponsorship: not needed".

## 6. Report (`DeepDiveReportSchema`, `src/modules/deep-dive/schema.ts`)

```ts
Evidence = { kind: 'jd', quote: string }
         | { kind: 'profile', ref: string, text: string }   // ref = profile item id where the profile map has one
         | { kind: 'finding', index: number }                // into research findings
         | { kind: 'register' }

DeepDiveReport = {
  verdict: 'apply' | 'apply_with_caveats' | 'long_shot' | 'dont_apply',
  verdictSummary: string,                 // 2–3 sentences
  worthTailoredCv: { answer: boolean, reason: string },
  likelihood: { band: 'low' | 'medium' | 'high', reason: string },   // chance of getting to interview; no fake %

  blockers: {
    label: string,
    status: 'hard' | 'confirm_with_recruiter' | 'cleared',
    fromEarlyAssessment: boolean,          // true when it was one of Jev's blockers
    reason: string,
    evidence: Evidence[],
  }[],

  gaps: {
    requirement: string,
    closability: 'closable_now' | 'closable_later' | 'not_closable',
    // closable_now  = evidence exists but isn't on the profile or CV yet → what to add
    // closable_later = needs real work → action + rough weeks
    action: string,
    weeksToClose: number | null,
    evidence: Evidence[],
  }[],

  strengths: { point: string, evidence: Evidence[] }[],

  practicalities: {
    location: { summary: string, workMode: 'remote' | 'hybrid' | 'onsite' | 'unknown', relocationNeeded: boolean | null },
    sponsorship: { needed: boolean, register: 'licensed' | 'licensed_other_route' | 'not_listed' | 'unknown' | 'not_applicable',
                   adWording: 'offers' | 'not_offered' | 'right_to_work_required' | 'silent', meetsSalaryThreshold: boolean | null, summary: string },
    employmentType: string | null,
    other: { label: string, detail: string }[],     // start date, travel, on-call …
  },

  pay: {
    stated: { min: number | null, max: number | null, currency: string } | null,
    market: { min: number, max: number, currency: string, evidence: Evidence[] } | null,
    ask: { floor: number, target: number, stretch: number, currency: string, reasoning: string } | null,
    vsSearchProfile: string,               // how it compares with the user's floors and targets
  },

  company: { summary: string, signals: { label: string, tone: 'positive' | 'neutral' | 'negative', evidence: Evidence[] }[] },

  cvStrategy: {
    leadWith: string[],
    emphasise: { item: string, why: string }[],
    playDown: string[],
    positioning: string,                   // 1–2 sentences
  },

  questionsToAsk: string[],                // for the recruiter or hiring manager
  unknowns: string[],                      // what research couldn't settle
}
```

Each array has a maximum length so the report stays readable: blockers 8, gaps 10, strengths 6, signals 6, questions 6.

## 7. Connections

- **Into CV generation.** On completion the deep dive also writes `JobApplication.jobAnalysis` (`mustHave`, `niceToHave`, `risks`, `positioningStrategy`), built from the report. `cv/generate.ts`, cover letters, the writing guide and career-vertical already read `jobAnalysis`, so they benefit without code changes. A later step can pass `cvStrategy` directly.
- **From the early assessment.** The popover's **Deep analysis** button becomes **Deep dive**:
  - No deep dive yet → start one and go to the page
  - One exists → go to the page, which offers **Run again**, and shows "out of date" when `inputsHash` differs
  - Shown for every complete assessment, blocked ones included
  - With no LLM key, the button shows the reason and a link to settings, the same as today's `disabledReason`
  - With a key whose provider has no supported web search, the button still runs, and says "No web research with your provider"
- **On the job page** (`view/[id]`): a **Deep dive** entry in the sidebar showing the verdict chip, next to the early assessment.
- **Usage page.** `deep-dive:research:company`, `deep-dive:research:pay`, `deep-dive:research:practicalities`, `deep-dive:structure` and `deep-dive:synthesis` are added to `FEATURE_LABELS`. Each run's total cost appears on the deep-dive page, using #345's `runId` summary.

## 8. Routes and execution

| Route | Purpose |
|---|---|
| `/dashboard/job-applications/view/[id]/deep-dive` | Report page: the current run, older runs in a selector, live stage progress while running |
| `POST /api/jobs/[id]/deep-dive` | Start a run → `202 { deepDiveId }`. Session or bearer-token auth (the api-tokens scopes get `deep-dive:run`) |
| `GET /api/jobs/[id]/deep-dive` | Newest run: status, stage, report when complete |
| Server action `startDeepDive(jobId)` | What the button calls; same module function as the POST route |

**Execution.**
- **Starting a run:** `startDeepDive` inserts a `queued` row and runs the pipeline in `after()`. The route sets `maxDuration = 300`. The page polls every 3s while the newest row isn't finished, the same as `assessment-poller`.
- **Limits:** one non-finished run per job (a new request returns the running one) and at most 2 running per profile, admitted under a per-profile advisory lock the same way as `job-assessment/queue.ts`.
- **Time budget:** gather < 2s, research (parallel) ≤ 120s, synthesis ≤ 120s.
  - A researcher over budget is cut and marked `timeout`, and the run continues.
  - A synthesis over budget fails the run with `timeout`.
  - If real runs often go past ~240s, move the pipeline to Vercel Workflow, one step per stage. The module boundary allows it.
- **As built (#360):** a start past the per-profile limit is refused (`429`), not queued. `inputsHash` is nullable and set by the gather stage. `wrong_provider` isn't used: a provider without web search runs with research skipped.
- **Rows left behind:** a row stuck in a running status for over 10 minutes is shown as failed (`timeout`), using the same stale rule as `IN_PROGRESS_STALE_MS`.

**Module layout:** `src/modules/deep-dive/`
- `schema.ts`: Zod schemas and types
- `gather.ts`
- `research.ts`: researchers, briefs, budgets
- `synthesise.ts`
- `run.ts`: the pipeline, status updates, attribution
- `queries.ts`
- `actions.ts`

No model ids appear in this module.

Separately, `src/modules/companies/` holds `match.ts`, `sponsor-register.ts` and `queries.ts`.

## 9. Cost (measured on Anthropic, user's key)

Measured on 2026-11-11 (#360) on real job postings, with `research` = Sonnet 5.5, `fast` = Haiku 5.5, `analysis` = Opus 5.5. Token costs are estimates from list prices; web search is billed per search by Anthropic on top.

| Stage | Measured tokens | Time | Cost (tokens) |
|---|---|---|---|
| Research ×3 (search + structure) | ~200–260k in / ~15–24k out | 35–60s per researcher, in parallel | ~$0.46–0.60 |
| Web search + fetch | 23–27 tool calls | | Anthropic's per-search fee |
| Synthesis | ~10–15k in / ~7–9k out | 58–84s | ~$0.18–0.25 |
| **Total** | | **~1.5–2.5 min** | **~$0.70–0.85** plus searches |

A second job at the same company reuses cached company research and costs about a third less. With Haiku as the research model a run cost about $0.22 in tokens, but its research was much thinner (one pay researcher searched 45 pages and wrote nothing), so Sonnet is the recommended `research` model. OpenAI and Google are out of scope for now.

**Before starting:** the button shows "Uses your own API key" with an estimate. The estimate comes from the per-role models and a pricing table. With no known pricing for a model, it shows "cost unknown" rather than a guess.

## 10. Retiring `assessJobFit`

- **In the PR that ships the button change:**
  - Remove `assessJobFit` calls from `early-assessment.tsx`.
  - Keep `JobFit` (the flame pill) showing existing `jobFit` data. It disappears when the job has a deep dive.
  - Its **Assess** button starts a deep dive instead.
- **Later:** once no recent writes exist, a separate change removes `jobFit`/`jobFitAssessedAt` and the `job-fit` feature, with a migration.
- **Code that moves into `deep-dive/gather.ts`:** the input gathering from `job-fit.ts` (snapshot, writing rules, search-profile goals, notes rule) and the `emitSuggestion` call (search-profile suggestions from the fit).

## 11. Out of scope: company profile (its own issue)

The tables in §4.2 are the start of a company profile. Not in this spec:

- A company page showing every job, CV and application with that company, the furthest stage reached, and outcomes (**per-user**)
- Contacts and recruiters rolled up from `ApplicationContact` to the company (**per-user**)
- Pay seen across the user's own captured jobs, roles hired recently, and offices (shared facts plus per-user history)
- Following or watching a company, and alerts on new roles
- Patterns across applications (e.g. "you reach final rounds at fintechs")

**Rule for that work:** shared tables hold public facts only. Anything from the user's own activity stays keyed by `profileId`, so no user sees another's history.

## 12. Build order

1. ~~**#345**: usage attribution~~. Done in #347.
2. **Model roles (§3.0)**, its own issue and PR:
   - `roles.ts`, `llmModelRoles`, and the "Models by task" settings section
   - `role` and `webSearch` options on the LLM layer, plus `LlmUsageLog.role`
   - Move the `resolveFastModel` callers over
   - Test web search on OpenAI and Google keys
3. **Companies + sponsor register** (#356; see `docs/companies.md`):
   - `Company`, `SponsorLicence` and `SponsorRegisterImport`
   - The importer and cron
   - `JobApplication.companyId`, with matching on capture and edit and a backfill for existing jobs
   - A small "Licensed sponsor" chip on the job page, useful on its own
4. **Deep dive backend:**
   - `JobDeepDive` and `CompanyResearch`
   - Gather, research and synthesis, plus the API routes
   - Test on 10 real jobs per provider; fill in `ROLE_RECOMMENDATIONS`; replace §9 with measured numbers
5. **Deep dive UI:**
   - The report page
   - The re-wired button and sidebar entry
   - Writing `jobAnalysis`
   - Retiring the `assessJobFit` writes
6. **Company profile:** separate issue (§11).

## 13. Open questions

- **Pay data sources.** Which sites can the `pay` researcher actually reach and use? Some salary sites block fetches. Decide after step 3's test runs, possibly with an `allowed_domains` list.
- **Non-UK sponsorship.** Other countries have no equivalent public register (IE has none that's comparable). For now, outside GB the report relies on the ad's wording and research, and labels it as such.
- **Re-runs.** Should a re-run reuse the previous run's research when it's under 7 days old and only the profile changed? That would be a cheap "re-judge" mode. Leave it out until there's data on how often people re-run.
