# CV generation (writing desk)

Status: **shipped.** Phases 1 to 4b are merged: the run record and log, Gather/Brief/Select, per-employer selection, the section writers and Assemble, Review, Land, stored-selection reuse, and (4b) the switch of the app to this flow. Phase 5 (deleting the legacy generator) is pending; its removal list is at the end. This file is the implementation record: it describes what the code does now. Where a history note is useful it says which phase changed a rule, but it does not keep superseded designs. The pipeline of the code being replaced is kept in [`cv-generation-legacy.md`](./cv-generation-legacy.md) until Phase 5.

Related: [`llm-usage-tracking.md`](./llm-usage-tracking.md) (usage tags and attribution), [`deep-dive.md`](./deep-dive.md) (the run machinery this copies), [`llm-layer.md`](./llm-layer.md).

---

## 1. Overview and goals

A job's **CV is generated from the profile, per job, into the writing desk**. The user presses "Generate CV for this job" (writing desk) or "Generate CV" (the log page). A run picks the evidence that fits the job, writes each section, checks the result in code, has one model review it, and **lands it as a draft** in the job's CV writing desk document. The user accepts or discards the draft in the existing `DraftReview`. Nothing live is ever overwritten.

Goals, from the audit of the legacy generator (one 8,000-token call wrote everything, nothing was capped but activities, no progress, no cost visibility, output was legacy JSON, not a desk document):

- **Controlled length.** Every section is capped in code after the model answers, not only in prose.
- **Facts are facts.** Titles, companies, dates, certifications, education and languages are rendered by code from the profile. No model can change a title or an employer. Figures must match the profile's evidence by value.
- **Transparent.** One log per run: every stage, the model, time, tokens, cost, what was kept and dropped, retries and why, where each bullet came from.
- **Cheap and reusable.** The expensive "what to show" stages (Brief, Select) are reused on re-runs when nothing changed.
- **Conversational, not strict.** Checks are soft (one retry, then accept with a note). Review concerns are suggestions for the coach, never a gate. The draft is never blocked.

### Decisions (kept for the record)

1. **Master CV is dropped** from job CV generation. Evidence is curated per job from the profile. The master-CV generator (`src/modules/career-vertical/master-cv.ts`) stays, for generic recruiter handoffs.
2. **Deep dive is not required.** Strategy comes from the newest *complete* deep dive when one exists, else `JobApplication.jobAnalysis` (from the early Jev assessment), else a last-resort `analyseJob` call, else none (the Brief reads the description alone).
3. **One entry per employer, latest title, progression as sub-text, titles never changed.** Roles at one company are one employer. The heading is the latest title; the dates are the employer's *stints*; progression is built in code with neutral wording (never "promoted"). "Play down" in the Brief affects emphasis only, never a title or employer.
4. **Bullets follow relevance, not recency.** A total budget is split across employers by the Select model's 1-5 relevance score.
5. **Claimed skills stay in lists.** A skill with no evidence behind it may appear in Skills and Tools lists; in a bullet, summary or profile only if the job's requirements name it; never as a Core Competency.
6. **Certifications and education are code-rendered, in relevance order**, with status derived from the data (in progress, expired, undated).
7. **Coach and verification flags stay rare.** At most 3 "worth a quick check" notes per run.
8. **Switch immediately** (done in 4b): the menu points at the writing desk; the old routes stay reachable by URL only (nothing links to them: the job menu, the job nav's "Older editors" group and the CV and cover letter list pages no longer do) until Phase 5.

---

## 2. Pipeline

Feature code names only a `role`; the user's "Models by task" settings and `ROLE_RECOMMENDATIONS` (`src/modules/llm/roles.ts`) choose the model. No feature module names a model id.

| # | Stage | Code or model | Role | What it does |
|---|---|---|---|---|
| 0 | Gather (`gather.ts`, `candidates.ts`, `strategy.ts`) | code (a model only as the last-resort `analyseJob`) | none | Loads the profile vault, the contact-free profile text (for the hash), the candidate list with the database id of every employer, activity, skill, tool, competency, certification, education and project, and the strategy (deep dive > `jobAnalysis` > `analyseJob` > none). Computes `inputsHash`. |
| 1 | Brief (`brief.ts`) | model | `analysis` | The hidden question, lead-with, emphasise, play down, positioning, tone, per-section budgets (floored in code, section 6). Small JSON. |
| 2 | Select (`select.ts`, `caps.ts`, `employers.ts`) | model + code | `fast` | Picks employers (with relevance 1-5) and evidence by id. **Every cap is enforced in code afterwards**; a rules fallback chooses when the call fails or names nothing real. |
| 3a | Write wave 1 (`write/run-write.ts`, `write/experience.ts`, `write/skills.ts`) | model + code | `default` (experience), `fast` (skills) | One experience writer per employer that shows bullets (parallel, `WRITE_CONCURRENCY` 3) and one skills/tools grouping call. Plain strings out; code builds every `:::` block. |
| 3b | Write wave 2 (`write/profile.ts`) | model + code | `default` | Professional profile, headline, competency labels, written after wave 1 so they cannot claim more than the experience supports. |
| 4 | Assemble (`assemble.ts`) | code | none | Orders sections, header with `{{contact}}`, `validateDraftMarkdown`, `checkFacts`, length note. |
| 5 | Review (`write/review.ts`) | model + code | `analysis` | One call: bounded edits and concerns. Code re-checks every edit before applying it. |
| 6 | Land (`land.ts`) | code | none | Creates or reuses the job's CV desk document, `createDraft`. |

Code-rendered, never model-written: employer headings (company, latest title, stints, progression line), Earlier Experience, certifications, education, languages, the header block, all block syntax.

---

## 3. Run record, state machine, admission and budget

**Row**: `CvGeneration` (`prisma/schema/cv-generation.prisma`), copied from the `JobDeepDive` pattern (`src/modules/deep-dive/run.ts`).

**Statuses** (`CV_GENERATION_STATUSES`, `schema.ts`): `queued → gathering → briefing → selecting → writing → assembling → reviewing → landing → complete`, or `failed`. `status` is a `String` validated with Zod (like `JobDeepDive`), so a status can be added without a migration. `STAGE_STATUS` maps a stage to its status.

**Transitions** (`run.ts`): `setStatus` is forward-only and guarded by `allowedFrom`; a row is never written after `complete` or `failed`. `updateActive` writes to an active row only. `failRun` records `failureKind` and `failureMessage` (`FAILURE_MESSAGES`), and may keep data (`data`) so a failure after Assemble keeps the CV and review.

**Failure kinds** (`FAILURE_KINDS`): `no_llm_key` (checked before Gather via `getLLMConfigStatus`), `no_description`, `timeout`, `rate_limited`, `overloaded`, `refusal`, `invalid_output`, `draft_exists`, `document_limit`, `error`. `LLMError.kind` is mapped by `failureKindFor` (`run-pipeline.ts`).

**Stale window**: a run still active after `CV_GENERATION_STALE_MS` (15 minutes) reads as failed / `timeout` (`isStaleRun`, `effectiveStatus` in `queries.ts`); nothing is written to the row by reading.

**Admission** (`createCvGenerationRun`, `run.ts`): under a per-profile Postgres advisory lock (`cvGenerationLockKey`), one active run per job (a second request gets the running one back, 200) and at most `CV_GENERATION_CONCURRENCY_PER_PROFILE` (2) active runs per profile (429). It only inserts the `queued` row. `startCvGeneration` (`run-pipeline.ts`) first answers an already-running run (a second click is not a conflict), then checks the landing target for a pending draft (409, `checkLandingTarget`), then admits.

**Execution**: `startCvGeneration` schedules `runCvGenerationStages` in Next's `after()` and returns at once (202 + `runId`). The route's `maxDuration` is 300 s (`CV_GENERATION_ROUTE_MAX_DURATION_S`; the route file's literal must be kept in sync). `AssessmentPoller` refreshes the log page while a stage is active.

**Profile writer cap.** `writeProfile` 4,000 / retry 8,000 tokens (was 1,500 / 3,000): the answer is about 300 tokens but a thinking model's reasoning counts against the cap, and 1,500 was cut off in a real run.

**Time budget** (`TIME_BUDGET_MS`, `schema.ts`): brief 90 s, select 60 s, write 70 s per call, analyse 60 s (the last-resort call in Gather, raced; a timeout is strategy source `none`), review 60 s, whole run 280 s (route limit less 20 s). Reserves: `ASSEMBLE_RESERVE_MS` 8 s, `WAVE2_RESERVE_MS` 45 s (wave 1's deadline), `WAVE2_MIN_START_MS` 12 s, `MIN_CALL_MS` 5 s (`write/limits.ts`), `LAND_RESERVE_MS` 12 s and `REVIEW_MIN_START_MS` 20 s (`schema.ts`). A soft-problem retry is skipped when the time left is under twice the first call's duration (`SOFT_RETRY_TIME_FACTOR`, `call.ts`).

**Retries** (`call.ts`): `completeValidated` (Brief, Select, Review) is `completeJSON` + Zod with at most two calls: the retry prompt names the failing fields and never echoes the model's text, and always runs at the larger token cap. `completeChecked` (writers) makes at most two calls, with ONE retry shared by every soft problem. A first answer cut off by the output cap is retried only when the retry cap is larger; otherwise `CutOffError` is thrown after one call and the employer is listed with its own activity text, logged.

**Time and failure safety**: a timeout in wave 1 does not lose finished work (the employer falls back to its own activity text, logged); wave 2 is rendered from the Brief by code when under 12 s remain; Review never fails the run (it is skipped and logged); Land aborts without writing when the row can no longer be written (stale or killed).

---

## 4. Data model and migrations

`prisma/schema/cv-generation.prisma`. Columns of `CvGeneration`: `id`, `profileId`, `jobApplicationId`, `writingDeskDocumentId?`, `deepDiveId?`, `status`, `failureKind?`, `failureMessage?`, `inputsHash?`, `startedAt?`, `completedAt?`, `stageTimings Json?`, `log Json?`, `brief Json?`, `selection Json?`, `assembled Json?`, `review Json?`, `selectionReusedFromRunId String?`, `createdAt`, `updatedAt`. Relations: profile and job cascade on delete; desk document and deep dive `SetNull`. `selectionReusedFromRunId` has no relation (the earlier run may be deleted). Every Json column is read tolerantly (`parseBrief`, `parseSelection`, `parseAssembled`, `parseReview`, `parseCvGenerationLog`: null or a dropped bad entry, never a thrown error), so older runs keep rendering.

**Migrations** (`prisma/migrations/`):

| Migration | What it does |
|---|---|
| `20261118085231_cv_generation_run` | `CvGeneration` table; `LlmUsageLog.writingDeskDocumentId` (nullable, indexed, FK to `WritingDeskDocument`, `ON DELETE SET NULL`). |
| `20261118120000_cv_generation_job_index` | Index `CvGeneration(jobApplicationId, createdAt)` (the job's run list). |
| `20261118130000_cv_generation_brief_selection` | `CvGeneration.brief Json?`, `selection Json?`. |
| `20261118150000_cv_generation_assembled` | `CvGeneration.assembled Json?`. |
| `20261118154457_cv_generation_review` | `CvGeneration.review Json?`, `selectionReusedFromRunId String?`. |

Phase 4b added no migration. Never use `db:push`; see AGENTS.md.

---

## 5. LLM roles, feature tags, attribution and cost

| Stage | Feature tag | Role | Temperature |
|---|---|---|---|
| Gather (last resort only) | `cv-job-analysis` | its own | |
| Brief | `cv-gen-brief` | `analysis` | `TEMPERATURE.brief` 0.2 |
| Select | `cv-gen-select` | `fast` | `TEMPERATURE.select` 0 |
| Experience writer | `cv-gen-write-experience` | `default` | 0.4 |
| Skills grouping | `cv-gen-write-skills` | `fast` | 0.2 |
| Filler bullet | A bullet that is a near-verbatim copy of the summary (at least 85% of its content word-stems in the summary, 3+ content words, no figure) is **kept**: the summary loses the repeated sentence (or, in a one-sentence summary, the repeated clause) and a note says so; when the summary has nothing else to keep, both stay and a note says so. The bullet count is never reduced by this check. | `write/bullets.ts` (`repeatsSummary`, `dedupeSummary`) |
| Profile writer | `cv-gen-write-profile` | `default` | 0.4 |
| Review | `cv-gen-review` | `analysis` | 0.1 |

(`CV_GENERATION_FEATURES`, `TEMPERATURE`, `schema.ts`; labels in `src/app/dashboard/settings/usage/_components/feature-labels.ts`.) The `llm` layer **drops the temperature for Anthropic's Claude 5 family** (`samplingOptions`, `src/modules/llm/client.ts`), so on those models the values do nothing; see Known limits. The `default` role resolves to the user's own default model (`UserSettings.llmModel`); nothing else decides which model the writers use.

**Attribution.** Every call passes `attribution: { jobApplicationId, runId: <CvGeneration id> }`, plus `writingDeskDocumentId` when the job's earlier generated CV document already exists (`attributionOf`, `call.ts`). A document created at Land does not exist when the calls run, so a job's first run has no `writingDeskDocumentId` on its rows. `resolveAttribution` (`src/modules/llm/attribution.ts`) drops a document the profile does not own or that belongs to another job.

**How the log reads cost.** Per-stage tokens and cost come from the call results (`usageOf` / `addUsage` / `CallUsage` in `call.ts`, priced with `estimateRowCostUsd`), not from reading `LlmUsageLog` back: the usage row is written in an `after()` callback of the call, so an immediate read can miss it. The usage rows with this `runId` remain the fallback for a stage whose calls all failed and the source of the side panel's run total (`getRunUsage`, `queries.ts`). A model with no listed price shows its tokens with no cost; the total is then marked incomplete.

---

## 6. Selection, caps, employers

**Employer grouping** (`employers.ts`): roles are grouped by normalised company name (case, accents, punctuation, spacing, a leading "the" and a trailing legal suffix such as Ltd/Inc/GmbH/Company/Co ignored; "Unity" and "Unity Technologies" stay separate and Select logs a hint to merge them in the profile). A role with a blank company is its own employer.

**Latest-title rule** (`laterRole`): a current role (no end) wins; otherwise the later START date wins, with the nested-role tolerance `LATEST_TITLE_END_TOLERANCE_MONTHS` (6): a later-starting role wins only when it is current or ends within 6 months of the other's end; otherwise the role that kept running keeps the heading. The end date is only the tiebreak for equal starts. The CV heading is that title exactly as in the profile.

**Stints and progression**: an employer's dates are its `stints`, the roles' ranges merged only where they touch, overlap or start within `STINT_GAP_MONTHS` (3) of the previous end (`2015–2017, 2019–present`; never one overall span). `progressionLine` is oldest-first with neutral wording, null with one distinct title. Employer order: any current role first, then the latest end over all its roles, then the later start of its latest role; a current role counts as the latest possible end.

**Caps, floors and ceilings** (`caps.ts`). The volume calibration PR (see History, "Calibration") replaced "the Brief may ask for fewer" with **floors the Brief may raise but never go below**, and kept hard **ceilings** so over-production cannot return. The first real production run came out at about 507 words (12 bullets, an 8-year employer as a title line, 1 certification, 5 competencies) against the owner's hand-made 2.5-page CV of about 850 words (17 bullets, 7 certifications, 8 competencies), mostly because the Brief's own budget line asked for 3 employers, 5 competencies and 3 certifications.

| Section | Floor (Brief may not go lower) | Ceiling (nothing may exceed) | Constant |
|---|---|---|---|
| Employers with bullets | 4 | 4 | `MIN_EMPLOYERS_WITH_BULLETS`, `MAX_EMPLOYERS` |
| Header-only employers | n/a (all the rest, most recent first) | 4, further ones dropped (`over_cap`) | `MAX_HEADER_ONLY_EMPLOYERS` |
| Bullets in total | about 17 (`TOTAL_ACTIVITY_BUDGET`; the split fills it whenever supply allows; aim 16-18) | 20 | `MAX_TOTAL_BULLETS` |
| Bullets per employer | 2 (fewer only if it has fewer activities) | 6; 8 for an employer with 3 or more roles in the profile | `MIN_ACTIVITIES_PER_EMPLOYER`, `MAX_ACTIVITIES_PER_EMPLOYER`, `MAX_ACTIVITIES_LAYERED_EMPLOYER`, `maxActivitiesFor` |
| Skills | 12 | 12 | `MAX_SKILLS` |
| Tools | 6 | 10 | `MIN_TOOLS`, `MAX_TOOLS` |
| Competencies | 8 | 8 | `MAX_COMPETENCIES` |
| Certifications | 6 | 6 | `MAX_CERTIFICATIONS` |
| Education | 1 | 3 | `MAX_EDUCATION` |
| Projects | 0 | 2 substantive; thin (title-only) projects never use a slot | `MAX_PROJECTS` |

`FLAT_FLOORS` / `MIN_EMPLOYERS_WITH_BULLETS` give the floors (`BUDGET_FLOORS`), `FLAT_CAPS` / `BUDGET_CAPS` the ceilings, and `clampBudgetValue(section, n)` clamps into `[floor, ceiling]`. A floor is met only as far as the profile has items (a profile with 5 certifications shows 5). An expired certification the model picked is left off the selection (log note), like the top-up. Projects keep a floor of 0: a project with no bearing on the job is not padding. Where the floors are applied:

- **In the Brief schema** (`budget()`, `schema.ts`): a stored or model-written budget outside the range reads as the nearest end (a stored Brief that asked for 3 certifications reads as 6). The CV body soft limit `CV_BODY_WORDS_SOFT_LIMIT` (1,000 words, about 2.5 pages; at the ceilings the body can legitimately pass 900: 20 bullets x 25 = 500, 4 summaries x 40 = 160, profile 110, labels, skills, tools, certifications, education and Earlier Experience about 210) remains the guard against a CV that runs long.
- **In Select** (`enforceSelection`): budgets are clamped again; a flat list the model left shorter than its floor is **topped up by rule** (`topUpOrder`: evidence-backed first, then brief and requirement term matches, then profile order; certifications by `rankCertifications`, never an expired one) with the reason "Chosen by rule: the model picked too few" and a log note. A claimed-only skill or tool is eligible for that top-up only when the brief or the job's requirements name it: every distinctive word of its label is among their terms (`namedIn`; generic words such as API or SDK do not count), so a job asking for "API" experience no longer pads with "OpenAI API". Employers with bullets are filled by recency when the model picked fewer than 4 (existing rule). `allocateBullets` clamps its total to `MAX_TOTAL_BULLETS`.
- **The Brief prompt** (`cv-gen-brief.md`) proposes budgets in these ranges; the Select prompt (`cv-gen-select.md`) tells the model each budget is a floor to fill, projects excepted.

**Calibration 2** (`fix/cv-gen-calibration-2`, after a second real run):

- **Thin projects use no project slot.** A candidate project with only a title (`CandidateItem.thin`, from `isThinProject` over description and highlights) is kept on the selection beyond the cap (at most `MAX_PROJECTS` of them, so the thin-project coach concern still fires) while substantive projects fill the cap of 2 first. Before, two thin named projects cut the figure-rich "17th Unity Awards".
- **Name pins pick the best match.** Of several candidates that match a lead-with or emphasise name: more matched words (`matchedWords`), then a figure or outcome, then longer text; one under `MIN_PIN_WORDS` (8) is taken only when nothing longer matches.
- **Top-ups do not pad.** The tools floor is 6 (ceiling 10; the model may pick up to 10). A code top-up of skills or tools takes evidence-backed items first and a claimed-only one only when the brief or the job's requirements name it; the floor is met only as far as that allows.
- **Select answer shape (ids only).** The model is asked for ids only: employers as `{ id, relevance }`, every other list as plain id strings, plus the `emphasise` claims. No per-pick reasons and no list of left-out items (a real run with 4 employers, about 58 kept and 75 not selected hit the 8,000 cap and retried). Code derives the dropped list (`not_selected` and the other `DROP_REASONS`) from what was not picked; kept items carry an empty `reason` (a rule top-up or pin still writes its own). `SelectOutputSchema` still READS the older `{ id, reason }` shape (`trimReason`, `REASON_MAX_WORDS` 8); the JSON Schema shown to the model is the ids-only one (`OUTPUT_FORMAT`). A worst case (4 employers, 20 bullets, 12 skills, 10 tools, 8 competencies, 6 certifications, 2 projects, 2 education, three emphasise claims) is about 1,500 tokens by chars/4 (`select-size.test.ts` asserts under 4,000). Caps stay `select` 8,000 / retry 16,000.

`MAX_RECORDED_DROPPED` 300 bounds the stored dropped list (`droppedTotal` and `notSelectedTotal` keep the true counts). A header-only employer is never scored; a missing relevance score is `MIN_RELEVANCE` in a model run and derived from brief and requirement term matches in a rules run; a bad stored relevance reads as 3. A long-tenure employer (an 8-year role) is no longer reduced to a title line because the Brief asked for fewer employers: it gets 2-3 bullets by relevance, and only the employers beyond the 4 stay header-only.

**Brief shape.** `CvBrief` (`schema.ts`): `hiddenQuestion`, `leadWith: { name, framing }[]` (up to 4), `emphasise: { name, framing, why }[]` (up to 6), `playDown: string[]`, `positioning`, `tone`, `budgets`. `name` is the short proper name or topic (an employer, project, programme, tool or theme: "Unity", "One Marketing Request Form", "Automation"; no sentence, no year or ordinal) that code matches evidence by; `framing` is the sentence the writers read. The reader (`CvBriefSchema`) is tolerant of the old shapes: a plain string is read as the framing with the name derived by `deriveItemName` (the text before `:`, else the first quoted phrase, else the first run of capitalised words that is not just a sentence's first word, else the first six words), a `{ name }` with no framing reads with the name as its framing, and the old emphasise `{ item, why }` reads as `{ name: derived, framing: item, why }`. The JSON Schema shown to the model is `CvBriefOutputSchema` (the new shape only). Read the number of employers with bullets through `employersWithBullets(brief)`.

**Header-only and Earlier Experience**: employers listed without bullets render as ONE `## Earlier Experience` section directly after Professional Experience: a single `:::compact-list`, one line each, newest first, `Company — Latest title, YEARS` (`renderEarlierExperience`, `write/render.ts`; `stintYears`: `2012–2014`, a returnee `2015–2017, 2019–present`). No bullets, no progression, no model call; omitted when there are none. The section is `earlier-experience` in `assembled`; the shared `DEFAULT_CV_STRUCTURE` (`src/modules/writing-desk/structure-guide.ts`) is **not** changed because the MCP writing contract also uses it; `assembleCv` derives its own structure with `cvStructure()`.

**Stored selection** (`CvSelection`, `parseSelection`, `schema.ts`): `mode` `'model' | 'fallback'`; `employers[]` (key, company, `latestTitle`, bounds `start`/`end` for ordering only, `stints` to display, `roles[]`, `progression`, `relevance?`, `reason`, `headerOnly`, `bullets[]` with `experienceId`), flat lists (skills, tools, competencies, certifications, education, projects), `dropped[]` with `DROP_REASONS` (`not_selected`, `over_cap`, `unknown_id`, `duplicate`, `role_not_kept`, `role_header_only`), `droppedTotal`, `notSelectedTotal?`, `uncovered?` (the names of Brief lead-with and emphasise items no kept activity or project supports). Select sees the job's `mustHave`/`niceToHave` (from the deep dive, or `jobAnalysis` when a deep dive carries none) inside a `<job_requirements>` data block. Read the number of employers with bullets through `employersWithBullets(brief)`, not the raw `budgets.experiences` key.

**Named lead-with and emphasise items** (`select.ts` `enforceSelection`, `named-items.ts`): matched on the item's **name**, not its framing sentence. Matching is accent-insensitive (`foldText`, `text.ts`: NFD, combining marks stripped, ß/æ/œ/ø folded) on both the name and the text, so the Brief's "Wētā Tools" meets the profile's "Weta Tools". The profile-map `normalizeName` (link identity) is unchanged. `matchesName(text, name)` compares normalised whole words with only plurals and -ed/-ing stemmed (so "launches" meets "launch", "production" never meets "product"; years and ordinals such as "17th" or "2022" and filler words ignored): every word of a name of up to three words, a majority of a longer one, any order (a single very generic word such as Marketing matches only a text of three words or fewer; a name with no usable word matches nothing). An item is **covered** when the model's `emphasise` claim names a kept activity or project, when an employer that shows bullets carries the name in its company name (the item is the employer: "Unity" for "Unity Technologies"), or when a kept activity or project text matches the name. When the model's picks do not cover an item, the best matching activity of an employer with bullets (or a matching project) is pinned first with a log note ("it matches by name"), so "17th Unity Awards" finds a project called "Unity Awards 2022". `uncovered` holds the NAMES nothing matches (note "No kept evidence supports N lead-with item(s)"); an item whose only match is at an employer with no bullets stays uncovered. The Select prompt shows each item as `name: framing`, asks the model to copy the name in its `emphasise` report, to prefer evidence with an outcome or a figure over broad responsibilities, and to avoid play-down items. Select's `emphasise` claims are read by name, or by the whole framing when the model copied that.

**Figure-rich evidence** (`strongEvidence`, `MAX_FIGURE_SWAPS_PER_EMPLOYER` 2): an activity is *strong* when it states a figure or an outcome (`figuresIn` finds a figure, or it has an `impact` line) AND matches the name of a lead-with or emphasise item. When filling an employer's bullet allowance, strong activities come first in the rule top-up; and a strong activity the model left out (picked below the cap, or never picked) replaces the last kept activity that has NO figure or outcome AND matches no named brief item, was not pinned by name and is not evidence the model listed for an emphasise item (candidates ordered by activity rank, then profile order), at most twice per employer, never past the caps (log note "Kept X instead of Y ... states a figure and matches a brief item"). This is why an ARM workflow cut from 3 weeks to 1 hour is no longer dropped for a plain responsibility when the Brief emphasises automation.

**Certification order** (`rankCertifications`, used by the rule top-up and the rules fallback; the Select prompt asks the model for the same): job relevance (term matches in name and issuer) first, then in progress, then issued within `RECENT_CERT_YEARS` (5), then older, then one with neither issuer nor date, an expired one last (it never renders). `CandidateItem` carries `issued`, `inProgress` and `expired` for certifications, and the candidate line shows the issue year.

**Rules fallback** (`fallbackSelection`): used when the Select call fails or names nothing real: recency, highlighted, achievement, and term matches to lead-with and emphasise; it goes through the same `enforceSelection`. It is logged, never a failure.

---

## 7. Code-side checks

Policy: **soft** means one retry with the specific problems listed, then accept with a log note; the run never fails. **Hard** (retry once then fail `invalid_output`) is only an unusable answer: no JSON, wrong shape, empty profile. At most 2 calls per writer. Checks live in `write/checks.ts` unless noted; limits in `write/limits.ts`.

| Check | Rule | Where |
|---|---|---|
| Plain text | No images, links, HTML, `#`/`>`/list markers, `:::`, `{{`, emphasis, and no first person (`I`, `my`, `we`, `our`...; verbatim titles and roman-numeral "I" excepted) in bullets, summaries, the headline and competency labels; **the profile paragraph is written in first person and is exempt** (`PlainOptions.allowFirstPerson`, also in Review's re-check of a profile edit). Retry once, then clean and accept. | `write/plain.ts` (`plainLine`, `plainReasons`, `hasFirstPerson`) |
| Length | Summary `SUMMARY_MAX_WORDS` 40, bullet `BULLET_MAX_WORDS` 25, profile `PROFILE_MAX_WORDS` 110, headline `HEADLINE_MAX_WORDS` 12. **A long summary or bullet is not a retry reason:** code shortens it at a clause boundary (`shortenToWords`, leaving at most the cap and at least half of it) or keeps it as written and logs it. The profile (over 110 words) and headline (over 12) are shortened the same way in `write/profile.ts` and logged; a headline still over the cap is dropped. Retries stay for correctness checks. | `write/plain.ts`, `write/limits.ts` |
| Bullet count | At most the Select allocation per employer (+`LEAD_WITH_PROJECT_EXTRA_BULLETS` 1 per lead-with project with evidence). Soft retry once; then code **trims** deterministically (own bullet of a lead-with project first, then bullets reflecting Brief items, then writer order) and logs each cut. | `write/bullets.ts` (`bulletAllowance`, `trimBullets`) |
| Figures | Every figure must be supported BY VALUE by that employer's selected evidence (14k = 14,000; £500k = £500,000; 1m = 1,000,000; "forty percent" = 40%). Number words and multipliers are checked in the output ("five", "doubled"). Digits touching a letter (B2B, Web3, GA4, Q3) and 24/7 are not figures. | `checks.ts` |
| Repeated figures | A notable figure (a percentage, a multiplier, or >= 100) may not repeat within an employer, nor appear in both the experience text and the profile/headline/competencies; the profile has at most `PROFILE_MAX_FIGURES` 1. | `checks.ts` (`isNotableFigure`, `repeatedFigures`, `sharedFigures`) |
| Claimed names | A skill/tool/competency with no evidence may be in a bullet, summary or profile only when the job's requirements name it. Names of 2 characters or fewer are case-sensitive and not matched next to `-`, `&`, `/`, `'`. A tiny alias map (GA4/Google Analytics, JavaScript/JS, Kubernetes/K8s, PostgreSQL/Postgres) is the only equivalence. | `checks.ts` |
| Introduced names | No job title or company the evidence does not contain; capitalised title-like phrases that are not the candidate's titles (best effort). | `checks.ts` (`introducedNames`) |
| Credentials | No certification or education the evidence does not mention; an in-progress one only with in-progress wording. | `checks.ts`, `write/status.ts` |
| Headline | May not equal or contain a title, nor use a title or seniority word none of the candidate's titles uses. A headline still failing after the retry is **dropped**, not shipped. | `checks.ts` |
| Competency labels | Up to the Brief's budget, at most `COMPETENCY_MAX_LABELS` (8, the ceiling), as noun-phrase labels (`COMPETENCY_LABEL_MIN_WORDS` 2 to `COMPETENCY_LABEL_MAX_WORDS` 5); the call is asked for 6-8 when the profile has at least `COMPETENCY_MIN_LABELS` (6) competencies, code drops labels the profile does not back (keeping them only to reach that minimum, log note) and tops up from the selected competencies (no retry, log note) when fewer remain; no standalone numbers, no sentences, no repeats, no claimed capability, each overlapping a selected competency or the employers' evidence text. | `checks.ts` (`competencyLabelProblem`) |
| Sources | Every bullet cites at least one evidence label (`E1`, `P1`); a bullet with none is a soft problem. | `write/provenance.ts`, `write/experience.ts` |
| Project coverage | A selected project is covered when its normalised name (years, versions, trailing numbers stripped) appears in the employer's summary or a bullet, or one of its figures does. | `checks.ts` (`projectReflected`) |
| Lead-with standing | A lead-with project with evidence needs its OWN bullet, named in the first half of it. | `write/bullets.ts` (`leadWithStanding`) |
| Play down | A bullet whose first half names at least two words of a play-down item (all of them when fewer) is a soft problem. | `write/bullets.ts` (`playDownBullets`) |
| Tense | A finished role is past tense throughout; in the current role completed results are past tense (a curated list of present-tense achievement verbs is flagged: "Drives", "Delivers"). | `write/bullets.ts` |
| Thin lead-with | See Review's "thin lead-with rule" below. | `write/thin.ts`, `write/limits.ts` |
| Skills grouping | At most `MAX_SKILL_GROUPS` 3 groups, `GROUP_LABEL_MAX_WORDS` 4; a list is grouped only with at least `MIN_NAMES_TO_GROUP` 6 names, otherwise it is one ungrouped list ordered by code with no call, and `validateGroups` merges any group under `MIN_GROUP_SIZE` 2 into its neighbour so a group of one is never emitted; a failed or junk call falls back to code ordering. | `write/skills.ts` |

**Profile voice** (`write/profile.ts`, `cv-gen-write-profile.md`). Calibrated to the owner's own profile (about 110 words, first person, figure-led): the profile is **4-6 sentences in the first person** ("I build ...", "I've designed ..."), plain, no slogans or "storyteller" phrasing, at most `PROFILE_MAX_WORDS` (110, shortened at a clause boundary when over). First person is allowed in the profile paragraph ONLY: the headline, competency labels, bullets and summaries keep the no-first-person check. The repeated-figure rule is unchanged: the profile must not repeat a figure the experience section states and uses at most `PROFILE_MAX_FIGURES` (1), so the prompt says to prefer a different figure from the evidence, or none. **Years of experience: pending the owner's decision.** `WriteContext.yearsOfExperience` (`write/types.ts`) is the unset option slot: unset (what the pipeline passes today) the prompt says "Do not state a number of years of experience"; when set, the prompt asks for a first-person years opener and the figure check accepts that number. Nothing sets it yet.

**Status rules** (`write/status.ts`, `EDUCATION_RECENT_START_YEARS` 6): certification in progress = issue date in the future or in-progress wording in the name, written "(in progress)"; a past `expiryDate` leaves it OFF the CV (log note); education in progress = end date in the future, in-progress wording, or no end date and a start within 6 years; no end date and an older start renders with no span and no status and adds one low-priority check note. A weak certification (no issuer, no date) is skipped only when it is not the first rendered, `selection.mode === 'model'`, it is not in progress AND the certifications that are not weak already fill the Brief's certification budget (`renderCertifications(certs, now, budget)`); when the others would leave the section short, it renders by name with a log note.

**Check notes** (`MAX_CHECK_NOTES` 3, prefix `CHECK_NOTE_PREFIX`): ordered by priority (invented figures, claimed tools, credentials, competency labels, education dates) then employer order, cut to 3. The length note (body over `CV_BODY_WORDS_SOFT_LIMIT` 900 words, about two pages) and the mixed-source note are log notes, not check notes. **Nothing selected is silently dropped:** every selected item is on the CV or named in a log note.

**Project text** sent to a writer is cut to `PROJECT_EVIDENCE_MAX_CHARS` (1,200) at a word boundary (`capProjectText`); the figures check still reads the full text. The experience writer's token cap is `experienceTokenCaps` (`EXPERIENCE_TOKENS`: base 1,200 + 400 per allowed bullet, retry double, never above 8,000; an employer with project evidence starts at the larger cap).

**Alias and proper-noun gaps** are listed under Known limits.

---

## 8. Provenance and the Copy log format

**Provenance** (`write/provenance.ts`, `write/experience.ts`): each evidence item in an experience prompt carries a short label (`E1`..., `P1`... for projects; never real ids). The writer returns each bullet as `{ text, sources: ['E1'] }`; code resolves labels (case and brackets tolerated, unknown labels dropped and counted) to real ids. Stored on `assembled.sections[].bullets[]` as `{ text, sources: [{ id, kind: 'activity' | 'project', snippet }], editedByReview? }` in display order, after the hard cap. `snippet` is at most 140 characters, plain, one line, scrubbed of anything that looks like an email or URL. The numbers check does not use a bullet's own sources as authority (the whole employer evidence is), so a mis-cited label is not retried for a figure that is in the evidence. **Mixed-source flag** (`mixedSourceNote`): a bullet whose figures come from two or more different cited items gets an informational note on the section row ("Bullet combines figures from 2 activities: A / B"); merging items that state the same result with the same figures is fine.

**Copy log** (`runLogMarkdown`, `src/app/dashboard/job-applications/_components/cv-generation-view.ts`; button `copy-log-button.tsx`, clipboard helper `copy-text.ts`): permanent feature. Markdown with: a header (job title and company, run id, date, status, estimated cost, calls, tokens, duration, reuse source, draft id); the Brief; the Selection (kept per employer and section, left-out counts, uncovered emphasise and lead-with items); every stage with model, time, tokens, cost, retries and why, notes; the Write section rows with "where each bullet came from"; the check notes and warnings; the Review section (applied and discarded edits with reasons, concerns with questions and evidence); and the assembled CV fenced at the end. The CV keeps the literal `{{contact}}`; nothing reads a contact field. Every field is optional so an old run still produces a log. "Copy Markdown" on the Assembled CV panel is separate.

---

## 9. Review

`write/review.ts`, prompt `src/lib/prompts/cv-gen-review.md`, `REVIEW_LIMITS` (`schema.ts`). ONE call (`completeValidated`, role `analysis`, 3,000 output tokens, retry 6,000, 60 s). Skippable per run (`review: false`).

**Input** (lean: no header, no name, no contact detail, no whole profile): the user's writing rules and the review prompt as the system message; as the user message the Brief (hidden question, positioning, tone, emphasise, play down, lead with), the job's requirement terms, the profile's claimed names (`maxClaimedNames` 40), in-progress credentials, Select's uncovered emphasise items, and the CV: each experience entry with its section id (`experience:<key>`), role line, current/finished flag, summary, each bullet with an id (`b1`...) and the evidence it was written from as labelled snippets (`S1`...). Evidence text is built by `activityPromptText` / `projectPromptText` (`write/evidence.ts`), the same text the writer saw (activities whole, projects capped at 1,200 characters), so a figure the writer rightly took cannot look unsupported. Only cited items are sent, once each. Certifications, education, languages, Earlier Experience, competencies, skills and tools are read-only context or not sent.

**Summary evidence.** Under each experience entry the prompt also lists, labelled (S#) like the bullets' evidence and with the same text the writer saw (`activityPromptText`), up to `REVIEW_SUMMARY_EVIDENCE_MAX` (8) of that employer's selected activities that no bullet cites. A figure in a summary that is in any of them is supported (a false 'no evidence' concern about a Blizzard budget, from an activity the writer put in the summary, led to this). Cost: up to about 40 tokens per activity, so 0 to about 300 tokens per employer in practice (about 1,300 at the 4-employer worst case) on a prompt of several thousand.

**Output**: `edits` (at most `maxEdits` 8: target `{ sectionId, bulletId? }`, action `replace` | `remove`, `newText` <= `newTextChars` 800, `reason`) and `concerns` (at most `maxConcerns` 5: kind in `CONCERN_KINDS` = `evidence_gap`, `metric_conflict`, `claimed_in_bullet`, `weak_proof`, `other`; title <= 80, why <= 200, question <= 200, `refs` = evidence labels). The answer is parsed item by item (`ReviewOutputSchema`): one malformed edit or concern is dropped and counted, not the answer; only a non-object answer retries. An unknown concern kind reads as `other`.

**What it may touch.** Only an experience bullet, an experience summary (`bulletId: "summary"`) and the profile paragraph. **Read-only targets** (an edit is discarded with the reason): the header (name, headline, `{{contact}}`), every title, company, date and progression line (kept in an untouched `head`; they are not in the editable model), certifications, education, languages, Earlier Experience, competencies, skills and tools lists. A `remove` cannot delete the profile paragraph or an entry's summary (reword only) and cannot leave an employer with zero bullets.

**Guards.** An edit is applied only after `recheckText`: plain text and no first person (except in a profile edit, which keeps the profile's first-person voice; `{{`, `:::`, links, HTML are refused, not cleaned), word limits, figures verbatim by value against THAT employer's evidence (the whole profile's selected evidence for the profile paragraph), the claimed-tool rule, no introduced title or company, in-progress credentials only with in-progress wording, no bullet about a play-down item, tense, no new repeated figure within the entry (the profile paragraph counts), and for the profile no figure the experience already states and at most one notable figure. `entryRuleProblem`: after an edit a lead-with project that had its own bullet must still have one and a reflected project must still be reflected. `unsupportedProperNouns` / `unsupportedQualitative`: a replacement may not introduce a capitalised word, acronym, CamelCase, dotted token, C++/C# or letter-digit token that is not in the old text, that employer's evidence or the profile's own names; **the job's requirement text and the brief are never an allowed source**; a short list of superlatives (award-winning, world-class, best-in-class...) is refused unless the evidence says it. A failing edit is discarded and logged with what failed; an applied edit is logged with before/after (160 characters) and the reason. If the edited CV does not validate, ALL edits are dropped and the unreviewed CV is kept. A replaced bullet is marked `editedByReview`; its sources are kept while the new text still states a figure the old had (or neither states any) and cleared with a note otherwise.

**Thin lead-with rule.** A project is *thin* when its text, with its own name and punctuation removed, is under `THIN_PROJECT_MIN_CHARS` (80) characters (`isThinProject`, `write/limits.ts`). A thin lead-with project adds no bullet to the allowance, is shown to the writer as `NO EVIDENCE` with no framing line, is skipped by the own-bullet and coverage checks, and a bullet whose only sources are thin projects is dropped in code (kept when it also cites an evidence item). Review's guard no longer protects such a bullet. `withThinProjectConcerns` (`write/thin.ts`, called by the pipeline after Review, also when Review is skipped or off) adds one `weak_proof` concern per thin lead-with project asking what was done and the result, unless the reviewer already raised one naming it. The Brief prompt says a project with only a title gets no framing beyond its title; the profile writer treats lead-with and emphasise lines as direction, not evidence.

**Never fails the run.** A timeout, an unusable answer after the retry, any error, or less than `REVIEW_MIN_START_MS` before the Land reserve skips the review: the reason and spent tokens are recorded (`review.skipped`, `skipReason`) and the unreviewed CV lands. Concerns are stored even when every edit was discarded; refs resolve to evidence snippets (160 characters). **Nothing here writes to the profile.**

---

## 10. Brief and Select reuse

`reuse.ts`, `SELECTION_REUSE_WINDOW_DAYS` 30, `SELECTION_PIPELINE_VERSION` 4 (`schema.ts`; 2 by the calibration PR: floors, name-matched lead-with items and the new Brief shape; 4 by the truncation fix: accent-insensitive name matching and the stricter claimed-tool top-up change what Select picks, so older stored selections are not reused).

- **Key**: sha256(`SELECTION_PIPELINE_VERSION`, `inputsHash`, sha256 of the effective `cv-gen-brief` prompt, sha256 of the effective `cv-gen-select` prompt), stored on `log.reuseKey` (`computeReuseKey`, `reuseKeyOf`). `inputsHash` (profile text + job description + strategy + deep dive id) is unchanged, because the deep dive staleness check compares it. A prompt edited in Settings → Prompts therefore stops reuse; model settings are not in the key (use `fresh`). **Bump `SELECTION_PIPELINE_VERSION` whenever the meaning of Brief or Select changes in code.** A run stored without a key is never reused.
- **Lookup** (`findReusableSelection`): after Gather, the NEWEST eligible run of the same job and profile within the window; its key must equal; it must hold a parseable brief and a parseable selection in the employer shape from a model answer (a `fallback` selection means Select failed, so a fresh call is tried). Only the newest eligible run counts. The lookup is profile-scoped.
- **Origin window**: each run stores `log.reuseOrigin` = `{ runId, at }` of the run that MADE its pair; the 30 days and the log note are measured from the origin, and `selectionReusedFromRunId` is the origin run, so a pair cannot be chained past 30 days.
- **Failed donors**: a failed run with `failureKind` `draft_exists` or `document_limit` (`REUSABLE_FAILURE_KINDS`) may donate (it failed at Land, after paying for its Brief and Select). A failure before Land never donates.
- **On reuse**: both log rows are `skipped` with "Reused the brief and selection from the run of 10 Nov 2026 (nothing changed since)" (UTC date); no `cv-gen-brief` or `cv-gen-select` usage rows exist for the run.
- **Fresh** (`fresh: true`): never looks; makes new Brief and Select calls. In the UI: "Fresh (re-select evidence)" in the writing desk, "Generate again with a fresh brief and selection" on the log page.

---

## 11. Landing and the 409 flow

`land.ts`. **Target document** (`findLandingTarget`): the job's previous generated CV document when it still exists and is a `cv` of the same profile and job, else a NEW `cv` document made with `createWritingDeskDocument` (named "CV - <Company>", else "CV - <job title>", cut to 80 characters; its per-job advisory lock and the 10-document limit `MAX_WRITING_DESK_DOCUMENTS_PER_JOB`, `src/modules/writing-desk/schema.ts`, apply). Then `createDraft(markdown)`: the draft shows in the existing `DraftReview`; `{{contact}}` stays a placeholder (`acceptDraft` fills it). `writingDeskDocumentId` is set on the row as soon as the document is known; `assembled` is overwritten with the final (post-review) CV; the run ends `complete`.

**409 `draft_exists`** (`checkLandingTarget`): `createDraft` refuses when a draft exists. The route answers **409 `{ code: 'draft_exists', error: 'draft_exists', documentId }` BEFORE any run is created or model called**, so nothing is spent. Both entry points handle it with a choice:

- **Open draft** → `/dashboard/job-applications/view/[id]/writing/[documentId]`.
- **Discard draft and generate** → confirm, then the writing desk's own `discardDraftAction` (`src/modules/writing-desk/draft-actions.ts`), then the POST again (`discardDraftThenStart`, `cv-generation-start.ts`). A failed discard starts nothing.

**Races at Land**: a draft that appeared meanwhile fails the run `draft_exists` with the final CV and review kept on the failed row and shown on the log page; the 10-document race fails `document_limit` the same way; any other draft error fails as `error`. The runner also fails `document_limit` at the start of Gather, before any model call, when the job is at its limit with no CV document to reuse. Land asks `isRunActive` before creating a document and treats a row that can no longer be written as `aborted` before `createDraft`.

---

## 12. API

`POST /api/jobs/[id]/cv-generation` (`src/app/api/jobs/[id]/cv-generation/route.ts`; session cookie only; `requireProfile`, every query profile-scoped; `maxDuration = 300`).

- **Body** (optional JSON, `StartCvGenerationBodySchema`): `{ fresh?: boolean, review?: boolean }`. An empty body is the defaults (reuse, with review). Unknown keys are ignored; wrong types or invalid JSON give 400.
- **202** `{ runId, existing: false }` started. **200** `{ runId, existing: true }` a run of this job is already active. **409** `{ code: 'draft_exists', error: 'draft_exists', documentId, message }` (nothing started or spent). **400** `{ error: 'invalid' }`. **404** `{ error: 'not_found' }` (another profile's job reads as not found). **429** `{ error: 'limit' }` (2 active runs per profile). **401** not signed in.
- A missing LLM key or job description is NOT refused by the route: the run is created and ends `failed` (`no_llm_key` / `no_description`), so the log page shows why.
- **There is no GET.** A run is read server-side by the log page through `getLatestCvGeneration(profileId, jobId)` / `getCvGeneration(profileId, runId)` (`queries.ts`, returning `CvGenerationView`); `hasCvGeneration(profileId, jobId)` answers whether any run exists. Bearer-token and MCP access are not provided (a deep-dive-style `deep-dive:run` scope was not wired).

---

## 13. UI map

- **Job list and menu** (`src/components/app-item-menu.tsx`, `job-row.tsx`, `job-row-card.tsx`, `job-group.tsx`, `job-list.tsx` under `src/app/dashboard/job-applications/_components/`): "Generate CV" and "Create Cover Letter" are gone. The menu has View, "Writing desk", Edit and Archive; a legacy CV or cover letter that already exists keeps a "View CV" / "View Cover Letter" link with the deprecating badge (`legacyDocumentLinks`).
- **Writing desk entry** (`src/components/job-workspace/generate-cv-for-job.tsx`, `GenerateCvForJob`): "Generate CV for this job" posts `/api/jobs/[id]/cv-generation` (`requestCvGeneration`, `cv-generation-start.ts`) and then goes to the progress page `/dashboard/job-applications/view/[id]/cv-generation`. A "Fresh (re-select evidence)" checkbox sends `{ fresh: true }`; unchecked sends no body. "View last generation" shows when a run exists. A 409 shows the Open draft / Discard draft choice inline. It appears (a) in the "New document" dialog (`new-document-dialog.tsx`) when the type is CV, and (b) as the empty state of an empty CV writing desk document (`writing-desk.tsx`; `hasCvGeneration` comes from the document page).
- **Nav** (`src/components/job-workspace/job-document-nav.tsx`, `jobExtraDestinations`, `src/modules/jobs/workspace-nav.ts`): "CV generation" is always in "All documents" beside Deep Dive, whether or not a run exists. `JobWorkspace.hasCvGeneration` only drives "View last generation".
- **Log page** (`src/app/dashboard/job-applications/view/[id]/cv-generation/page.tsx`): empty state with the stages and a Generate button; active stepper (mounts `AssessmentPoller`, "You can leave this page"); failed state with the reason, a link to the waiting draft on `draft_exists`, an "Add an LLM API key" link on `no_llm_key`; complete state "CV drafted: review it in the writing desk" with a link to the draft. Panels (all collapsible, see **Collapsible sections** below): stage stepper and rows (`generation-log.tsx`: model, time, tokens, cost, retries and why, notes, kept/dropped, section rows, "Where each bullet came from"), Copy log, **Review concerns** (below), Assembled CV (`assembled-cv.tsx`, rendered with `blockRemoteContent`, collapsible Markdown, copy), Brief and Selection (`brief-and-selection.tsx`, with the uncovered emphasise items). **Right-hand column** (`_components/run-panel.tsx`, `RunPanel`): run time, status, estimated cost, calls and tokens, then the controls directly under them: "Generate again" and "Generate again with a fresh brief and selection" (`generate-cv-button.tsx`, same 409 Open draft / Discard draft choice; hidden while a run is active) and Copy log. On a narrow screen the column stacks before the long sections (`order-first`), so the controls stay near the top.
- **Collapsible sections** (`_components/log-sections.tsx`): `LogSection` is a heading containing a toggle button (`aria-expanded`, `aria-controls`) over a body that stays in the DOM (`hidden` when collapsed), so nothing is lost on collapse. Sections: `concerns`, `assembled`, `brief`, `selection` and one `stage:<stage>` per log row that has detail (`logSectionIds`). While a run is active every section starts collapsed; on a complete or failed run Concerns and Assembled CV start open and the rest collapsed (`defaultSectionOpen`). Open state lives in `LogSectionsProvider` (client state, only the user's own choices, `resolveSectionOpen`), which stays mounted across the poller's `router.refresh()`, so a section the user opened stays open; it is not persisted across page loads. "Expand all" / "Collapse all" (`ExpandAllButton`) sets every section. The nested native disclosures (kept/dropped, warnings, "Where each bullet came from", Markdown) are unchanged.
- **Concerns panel** (`_components/concerns-panel.tsx`): a `LogSection`. Collapsed or open, it shows "N concerns to discuss with the coach", every title and a **Discuss all with coach** button; its body shows, per concern, the kind badge, why, the question and the evidence snippets, and a **Discuss with coach** button. Wording is suggestion-only: "the draft does not wait on them".
- **Coach handoff** (`src/components/shell/coach-handoff.ts`): the single helper `openCoachWithDraft(text)` dispatches a `coach-draft` event; `ChatPanel` (`src/components/shell/chat-panel.tsx`) listens, fills its input, expands it, opens the panel and focuses it. **It never sends** and writes nothing to the profile. The message text is built by `concernCoachMessage` / `allConcernsCoachMessage` (`cv-generation-view.ts`): the job, the concern, why, the question and evidence, and "Don't change my profile; I'll make any change myself." The coach is due a rework: this is the only coupling (one helper, one listener).
- **Retired pages**: `/dashboard/cv-builder/new` and `/dashboard/cover-letters/new` are linked from nowhere (the list pages' "New" buttons now go to the job list, `jobDocumentCreateLinks` offers interview prep only) and show a retirement banner (`src/components/legacy-editors/legacy-generation-banner.tsx`) pointing at the job's writing desk; the old generator runs only on an explicit click.

Pure view helpers live in `src/app/dashboard/job-applications/_components/cv-generation-view.ts` (stage rows, `briefRows`, `selectionGroups`, `concernRows`, `reviewSummary`, `defaultSectionOpen`, `resolveSectionOpen`, `setAllSections`, `allSectionsOpen`, `logSectionIds`, `runLogMarkdown`, `startResponseMessage`, `draftHref`).

---

## 14. Prompts and user overrides

Six prompt files in `src/lib/prompts/`: `cv-gen-brief.md`, `cv-gen-select.md`, `cv-gen-write-experience.md`, `cv-gen-write-skills.md`, `cv-gen-write-profile.md`, `cv-gen-review.md`. Each is registered in `PROMPT_REGISTRY` (`src/modules/prompts/registry.ts`, group `cv`, keys equal to the file names without `.md`) and loaded with `loadCV*Prompt`, so **users can override each in Settings → Prompts** (`/dashboard/settings/prompts`). The JSON Schema output contract is appended in code, so an edited prompt cannot break the output shape; and nothing in code depends on a prompt's wording. Every writer's system prompt is `composeSystem(writing rules, writing brief, prompt, output format)`: the user's writing rules and writing brief (Settings → AI writing) apply to every writer and to Review. The Brief and Select prompts' text is part of the reuse key. No prompt carries a name, contact detail, employer, title or date, or block syntax.

The legacy `cv-generate.md` is not used by this flow.

---

## 15. Cost and latency (real runs)

**Observed on one production run, 2026-11-18** (a Canonical job, Opus as the default model, so the writers ran on Opus): about **$0.54** and about **2 minutes 40 seconds**. Estimated cost split per stage for that run (a single sample, not an average):

| Stage | Cost |
|---|---|
| Brief (`analysis`) | ~$0.06 |
| Select (`fast`) | < $0.01 |
| Write (experience + skills + profile) | ~$0.32 |
| Review (`analysis`) | ~$0.16 |

A re-run on unchanged inputs skips Brief and Select (about $0.06 less and about 20-30 s). A Review skipped with `review: false` saves about $0.16. Choosing a cheaper default model for the writers lowers the Write share (it also moves every other `default` feature). Estimates come from the dated rate card (`src/modules/llm/pricing.ts`); BYOK means the provider bills the user. Phase 4a's evidence-fidelity change adds roughly 300-900 input tokens to the review prompt (not separately measured). **The calibration PR deliberately raises volume** (about 17 bullets instead of 14, 4 employers with bullets, 8 competency labels, a 110-word profile): expected cost is about +$0.05 to +$0.10 per run (more experience-writer output and a larger review input), not yet measured on a real run.

---

## 16. Known limits and gaps

- **Proper-noun check is not applied to the writers.** `unsupportedProperNouns` and `unsupportedQualitative` only guard Review replacements. Writers paraphrase, so a capitalised or tool-like word not in the evidence (product names, places) is common and a retry per false positive would cost money on every run. The qualitative list is best-effort ("the best" is not caught).
- **Select instability on Claude 5 models.** The llm layer drops `temperature` for Anthropic's Claude 5 family, so two runs on one job can pick differently (an in-progress PMP appeared once and not the next time). Stability rests on the Select prompt rules, deterministic caps, and now on reuse (a re-run on unchanged inputs reuses the selection). Providers and older models that accept temperature honour `TEMPERATURE.select` 0.
- **Thin-evidence profile data leads to left-out content.** A project or activity with only a title cannot be written from; it is listed in a log note, a thin lead-with project raises a coach concern, and the CV is shorter. Fix it by adding detail in the profile.
- **Aliases** are a tiny map; "Tableau Desktop" for "Tableau" is not matched, so a claimed name can slip through or be over-flagged.
- **Heuristic checks** (own-bullet, play-down, tense, first person) are text heuristics: a paraphrase can be a false positive or negative. They cost at most one retry and a note, never a failed run.
- **"Unity" and "Unity Technologies" stay separate employers** unless the profile uses one company name (a Select log hint says so). No override UI.
- **More than 8 employers**: the oldest are left out (4 with bullets + 4 header-only); the no-gaps promise holds only up to 8.
- **Document limit**: a job holds at most 10 writing desk documents; with none reusable the run fails `document_limit` before any spend.
- **No GET API, no bearer-token or MCP entry** for CV generation.
- **Quality of real runs beyond the logged ones is unmeasured**: the suite mocks the model; prompts were tuned from a handful of real production runs.

---

## 17. Tuning guide and troubleshooting

**Tuning** (all named constants):

- Length: `TOTAL_ACTIVITY_BUDGET` (aim 16-18) and its ceiling `MAX_TOTAL_BULLETS`, `MAX_EMPLOYERS`, `MIN_EMPLOYERS_WITH_BULLETS`, `MAX_HEADER_ONLY_EMPLOYERS`, per-employer min/max, the floors `FLAT_FLOORS` and the ceilings `FLAT_CAPS` (`caps.ts`), `PROFILE_MAX_WORDS`, `COMPETENCY_MIN_LABELS`; word limits (`write/limits.ts`); `CV_BODY_WORDS_SOFT_LIMIT` for the length note.
- Cost: per-role models in Settings → LLM ("Models by task"); `review: false` on the POST; reuse (default).
- Voice and framing: Settings → Prompts and Settings → AI writing.
- Reuse behaviour: `SELECTION_REUSE_WINDOW_DAYS`; bump `SELECTION_PIPELINE_VERSION` when Brief/Select semantics change.
- Time: `TIME_BUDGET_MS`, the write reserves, `LAND_RESERVE_MS`.

**Troubleshooting: what to do when X appears in the log.**

| In the log | Meaning and what to do |
|---|---|
| "Reused the brief and selection from the run of ..." | Normal. Use "Fresh" to re-select, or edit the profile (the key changes with the profile text). |
| "Accepted with a problem after the retry: ..." | A soft check still failed after its one retry. The text shipped. Read the bullet; reword it in the desk if it matters. |
| "Shortened bullet N from 31 to 19 words at a clause boundary" / "kept as written because shortening it would cut its meaning" | Code handled an over-long bullet; no retry was spent. Edit by hand if the kept-as-written one is too long. |
| "Cut a bullet over this employer's limit of N: ..." | The writer returned more bullets than Select allocated; code trimmed (lead-with project first, then Brief-aligned bullets). Raise `TOTAL_ACTIVITY_BUDGET` only if every employer is consistently short. |
| "<project> has too little text to write from: left out; add detail to the project in your profile." or a "has too little detail to write from" concern | A thin project. Add detail (what was done, the result) to the project in the profile and run again. |
| "Selected project ... is not on the CV: it has no role and no date" | Attach the project to a role or give it a date. |
| "Bullet combines figures from 2 activities: A / B" | Informational. Check the bullet does not mix two different results. |
| "Worth a quick check: ..." (at most 3) | The risky items: an invented figure, a claimed tool the job asked for, an in-progress credential, an education entry with no end date. |
| "\"X\" is a tool or skill you list without evidence; the job asks for it, so the text names it." | Add evidence for it in the profile, or accept that it is only in the Skills list. |
| "<cert> expired in 2021 and was left out" | Add a new expiry date if it was renewed. |
| "'Unity' and 'Unity Technologies' were kept apart" | Give both roles the same company name to merge them. |
| "Chose by rules instead: ..." / "The model gave no relevance score for N employers" | The Select call failed or named nothing real; code chose by rules. Re-run; check the model setting. |
| "Review skipped: ..." | Timeout, unusable answer or no time. The unreviewed CV landed. Re-run or accept as is. |
| "Applied N edits, discarded M" and discard reasons | Review proposed an edit that a code re-check refused (a figure not in evidence, a new name, a lead-with bullet removed...). That is the guard working. |
| Failed `draft_exists` | A draft was waiting (or appeared during the run). The generated CV is kept on the log page. Open or discard the draft and generate again. |
| Failed `document_limit` | The job holds 10 documents. Delete one. |
| Failed `no_llm_key` / `no_description` | Add a key in Settings → LLM, or a job description. |
| Failed `timeout` | A stage ran out of time (or the run was killed and read as stale after 15 minutes). Retry; a cheaper `fast`/`default` model or `review: false` is quicker. |
| Failed `invalid_output` | A writer or Assemble returned an unusable answer twice. Retry; see the section named in the message. |
| Empty Select panel / no employers | The profile has no experience. Add some. |

---

## 18. Legacy pipeline and Phase 5

The legacy generator (`createAndGenerateCV` in `src/modules/cv/actions.ts`, `src/modules/cv/generate.ts`, the `cv-generate.md` prompt) is documented in [`cv-generation-legacy.md`](./cv-generation-legacy.md) and is **unlinked but still reachable** at `/dashboard/cv-builder/new` and `/dashboard/cover-letters/new` (behind a retirement banner and an explicit click). Existing legacy CVs and cover letters stay openable from the job menu and the list icons.

**Phase 5 removal list** (do in one PR; confirm usage first):

- `src/app/dashboard/cv-builder/new/page.tsx` and `src/app/dashboard/cover-letters/new/page.tsx` (the only remaining pages that start the old generators; nothing links to them), and `src/components/legacy-editors/legacy-generation-banner.tsx`.
- `createAndGenerateCV` (`src/modules/cv/actions.ts`) and `src/modules/cv/generate.ts` with its helpers used only by it (keep `analyse-job.ts`: `analyseJob` is still the last-resort Gather input here), `score-evidence.ts`, `scan-cv.ts`, and `src/lib/prompts/cv-generate.md` plus its `PROMPT_REGISTRY` entries (`cv-generate`, `cv-evidence-score`, `cv-recruiter-scan`) once nothing else uses them.
- Legacy-only feature labels may stay (old usage rows carry them).
- `docs/cv-generation-legacy.md` and its reference lines in AGENTS.md.
- The legacy editors (`/dashboard/cv-builder/[id]`, cover letter editor) and the "View CV" / "View Cover Letter" menu links and list icons only when their data is migrated or the owner chooses to retire them.

---

## 19. History (phase to change)

| Phase | PR / state | Change |
|---|---|---|
| 1 | #414 | Run record, usage attribution (`writingDeskDocumentId`), the generation log shell. |
| 2 | #415 | Gather, Brief, Select as a preview run. |
| 2b | #416 | Per-employer selection, relevance-driven bullets, stints. |
| 3 | merged | Section writers and Assemble (preview). |
| 3b | merged | Latest-title rule, projects routed as evidence, repetition and voice rules, retry reasons. |
| 3c | merged | Hard bullet cap, writer token caps, coverage rule, lead-with, tense, play-down, Copy log. |
| 3d | merged | Earlier Experience, per-bullet provenance, mixed-source note. |
| 4a | #422 and fixes (`fix/cv-gen-review-evidence`, `fix/cv-gen-leadwith-thin`) | Reuse, Review, Land, concerns stored, evidence fidelity, thin lead-with, word-cap shortening. |
| 4b | this PR | Menu switch, writing desk entry point, 409 Open/Discard, concerns panel and coach handoff, always-visible nav entry, retirement banners, this document. |
| Calibration | `feat/cv-gen-volume` | Volume floors under the Brief's budgets (4 employers with bullets, about 17 bullets, 8 competencies, 6 certifications, 12 skills, 10 tools; ceilings in section 6), certification weak rule only when the section is full, certification order (relevant, in progress, recent), competency labels up to the budget (min 6), first-person profile (4-6 sentences, 110 words), lead-with and emphasise items as `{ name, framing }` matched by name, figure-rich evidence tiebreak; `SELECTION_PIPELINE_VERSION` 2; no migration. The years-of-experience opener is pending the owner's decision. |
| Calibration 2 | `fix/cv-gen-calibration-2` | Thin projects use no slot, summary never eats bullets, name-pin quality, layered-employer cap 8, tools floor 6 with no claimed-only padding, Select reasons at most 8 words, Review sees summary evidence (a bullet edit may use only figures its own cited evidence states; a summary edit any selected evidence of the employer); `SELECTION_PIPELINE_VERSION` 3; no migration. |
| 5 | pending | Remove the legacy generator (list above). |

---

## 20. Profile readiness

Many CV problems are profile data problems: a project that is only a title, the same project entered twice, a certification with its status typed into the name, figures sitting in prose. The generator cannot fix thin data, so the app says so **before** a paid run. The check is general (it looks at the shape of the data, never at one person's), costs nothing in model spend (no model call; it needs one vault load, one profile-wide query, which is cached per request and skipped while a run is active) and **never blocks generating**.

Code: `src/modules/profile-readiness/` (`schema.ts`, `checks.ts`, `index.ts`). `checkProfileReadiness(vault, now)` is a pure function over the loaded vault. It returns `{ findings, total, fixCount }`: findings sorted by severity (`fix` before `consider`), then by impact, capped at `MAX_FINDINGS` (25) with the true `total`. A finding is `{ id, kind, severity, noteId?, noteType?, title, message, suggestion, editHref? }`. `editHref` comes from `vaultNoteHref` (the profile note's page, the Records pages, or the Overview). Messages quote only the owner's own titles and figures; contact details are never read into a message or a log (`contact_missing` names the field, never the value).

**Severities.** `fix`: the generator has nothing to work from, or the data is wrong. `consider`: worth a look, may be intended; phrased as a question where it can misfire.

| Kind | Severity | Fires when |
|---|---|---|
| `thin_narrative` | fix (a role that ended more than `EXPERIENCE_RECENT_YEARS` (5) years ago: consider) | A project or role whose text (body, highlights, its own evidence, and for a role its projects' text), minus its own name and punctuation, is under `THIN_PROJECT_MIN_CHARS` (80, `write/limits.ts`: the same test the writer uses) |
| `duplicate_project` | consider | Same-role (or both role-less) projects with the same normalised name or name similarity at least `DUPLICATE_NAME_SIMILARITY` (0.8); or, in any role, descriptions of at least `DUPLICATE_TEXT_MIN_WORDS` (8) content words (stopwords and one-letter tokens dropped) with similarity at least `DUPLICATE_TEXT_SIMILARITY` (0.7). Names differing by a number or year ("Awards 2024" / "2025") are never duplicates |
| `cert_no_issuer` | consider | A certification with no issuer |
| `cert_status_in_name` | consider | Bracketed or suffix wording ("(in progress)", "- pending") in the name with no future issue date. The generator deliberately also reads in-progress wording in a name as in progress (`write/status.ts`), so a name with that wording and a future issue date is fine, and plain words such as "Ongoing Professional Development" or "Expected Credit Loss" are not flagged |
| `cert_in_progress_no_date` | consider | Status wording in the name and no issue date |
| `cert_expired` | consider | Expired by `certificationStatus` and still listed |
| `education_dates_reversed` | fix | End before start |
| `education_undated` | consider | No end date and a start older than `EDUCATION_RECENT_START_YEARS` (6), so the CV claims neither completion nor progress |
| `experience_dates_reversed` | fix | End before start |
| `concurrent_roles` | consider | Roles at different employers overlapping at least `CONCURRENT_MIN_OVERLAP_MONTHS` (3); one finding per role listing what it overlaps, at most `CONCURRENT_MAX_FINDINGS` (3) |
| `employment_gap` | consider | More than `EMPLOYMENT_GAP_MONTHS` (12) between the latest end so far and the next start |
| `experience_no_evidence` | fix only for a current role or one that ended within `EXPERIENCE_RECENT_YEARS` (5) with a summary under `EXPERIENCE_SHORT_BODY_CHARS` (120) and no projects; otherwise consider | A role with no evidence of its own or under its projects (not raised when it is already `thin_narrative`) |
| `unmeasured_achievements` | consider | At least `UNMEASURED_MIN_COUNT` (3) achievements and `UNMEASURED_MIN_SHARE` (50%) with no impact and no digit; the weakest `LIST_LIMIT` (5) are listed |
| `filler_responsibility` | consider | Responsibilities under `FILLER_RESPONSIBILITY_WORDS` (6) words |
| `long_activity` | consider | An activity over `LONG_ACTIVITY_WORDS` (60) words |
| `conflicting_figures` | consider | Two evidence items under one employer with content-word similarity at least `CONFLICT_MIN_SIMILARITY` (0.5) and at least `CONFLICT_SHARED_WORDS` (3) shared words, both with figures of the same unit (percent, currency, count, multiple) and no figure in common (years ignored); at most `CONFLICT_MAX_FINDINGS` (3). Phrased as a question; expect false positives |
| `claimed_only_capabilities` | consider | At least `CLAIMED_ONLY_MIN` (3) skills or tools with no evidence, listed |
| `unlinked_evidence` | consider | At least `UNLINKED_EVIDENCE_MIN` (3) items and `UNLINKED_EVIDENCE_MIN_SHARE` (50%) of evidence linked to no capability; points at "Suggest links" (the AI link suggestions on the profile overview) |
| `unlisted_capability` | consider | A `[[wikilink]]` in a note names something that is not a capability |
| `contact_missing` | fix when email is missing, else consider | Email, phone or LinkedIn missing |
| `location_missing` | consider | No location |
| `right_to_work_not_shown` | consider | The search preferences hold citizenship or visa data, which the CV header cannot show yet (there is no right-to-work field; none was added) |

There is deliberately no spell-check and no date-format check.

**Where it shows.** The CV generation page loads the vault (`loadVault`, cached per request) and runs the check in the page loader, except while a run is active (the poller refreshes the page every few seconds): then the panel is replaced by a one-line note. The `ReadinessPanel` (`cv-generation/_components/readiness-panel.tsx`) sits in the right column under the run controls and in the empty state: a heading with the counts, a preview of the top titles when collapsed, and every finding (message, suggestion, "Edit in profile") when open. The writing desk's "Generate CV for this job" shows a one-line hint with the `fix` count, linking to `#profile-readiness`, only on an empty CV document (the only time that entry shows; the vault is not loaded otherwise).

**Generality suite.** `src/modules/profile-readiness/__fixtures__/profiles.ts` builds synthetic vaults of different shapes: `cleanProfile` (must give zero `fix` findings), `earlyCareer`, `longCareer` (concurrent roles and a gap), `careerChanger` and `messyImport` (duplicates, status in names, empty narratives). Reuse them in any test that must hold for "any user's profile" rather than writing another one-person fixture. Every name and figure in them is invented.

**Adding a check.** Write a small pure function in `checks.ts`, give it named thresholds, add its kind to `READINESS_KINDS`, call it in `checkProfileReadiness`, and test it against the fixtures, including that the clean profile stays quiet.
