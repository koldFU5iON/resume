# CV generation (writing desk)

Status: **plan agreed; phase 1 (run record, attribution, generation log) merged (PR #414); phase 2 (Gather, Brief, Select as a preview run) in review.** The Implementation record at the end is filled in as each PR lands, so this file ends up as the implementation record. The pipeline of the code being replaced is kept in [`cv-generation-legacy.md`](./cv-generation-legacy.md) until phase 5 removes it.

Replaces the legacy cv-builder generation (`createAndGenerateCV` in `src/modules/cv/actions.ts`, `src/modules/cv/generate.ts`). The result is a **writing desk document** (Markdown with `:::` blocks), landed as a reviewable draft.

## Why replace it

Findings from the audit of the legacy pipeline:

- **One call writes the whole CV** (pass 4, `completeJSON`, 8000 max tokens). Quality and length are controlled only by prose in `src/lib/prompts/cv-generate.md`.
- **Over-production.** Only activities are capped (5/4/3 per role). Experiences, skills, tools, projects, certs and competencies are sent whole. The schema has no `.max`. The master CV narrative is injected *on top of* the full profile, and its prompt says to reuse all master outcomes. The pass-2 "must-include" tiers never reach the writing call.
- **No progress.** One blocking server action, a spinner and a static "15-30 seconds". `CVDocument.status = 'generating'` exists but nothing reads it.
- **Master CV saved nothing.** It adds tokens rather than replacing any.
- **Output is the legacy `CVDocumentContent` JSON**, not a desk document.

Attribution was already in place (`LlmUsageLog.jobApplicationId/cvDocumentId/runId`, `docs/llm-usage-tracking.md`). The gap is that `cvDocumentId` points at the legacy `CVDocument`, not a desk document.

## Decisions

1. **Master CV is dropped from job CV generation.** Evidence is curated per job from the profile. The master-CV generator (`career-vertical/master-cv.ts`) stays, and is kept for more generic recruiter handoffs.
2. **Deep dive is not required.** Strategy comes from the newest *complete* deep dive when one exists. Otherwise the Brief stage falls back to `JobApplication.jobAnalysis` (written from the early Jev assessment), and runs `analyseJob` only if that is also missing.
3. **Switch immediately.** "Generate CV" points at the new flow as soon as it ships; the old routes are then deprecated and removed in a follow-up.

## Pipeline

The model tiers below are recommendations. Feature code only names a `role` (`fast` | `default` | `analysis`); `ROLE_RECOMMENDATIONS` in `src/modules/llm/roles.ts` and the user's "Models by task" settings choose the model. No feature module names a model id.

| # | Stage | Role (model) | Purpose |
|---|---|---|---|
| 0 | Gather | none (code) | Profile snapshot, newest complete deep dive (`cvStrategy`, gaps, strengths) or `jobAnalysis` fallback, structure guide, block contract. |
| 1 | Brief | `analysis` (Opus) | The hidden question: what problem is this role hired to solve? Plus lead-with, emphasise, play down, per-section budget. Small JSON. |
| 2 | Select | `fast` (Haiku) | Chooses evidence per section (activities, skills, tools, certs) against the brief and the job's must-haves. **Hard caps are enforced in code**, so over-production stops here. Roles beyond the bullet cap stay listed as header-only entries. |
| 3a | Write, wave 1 (parallel) | default (Sonnet) | Experience (one call per role: achievements, outcomes, business impact), skills and tools, education and certs. Each sees only its selected evidence, the brief and that section's block syntax. |
| 3b | Write, wave 2 | default (Sonnet) | Professional profile and competencies, written after wave 1 so they cannot claim what the experience section does not support. |
| 4 | Assemble | none (code) | Order by structure guide, fill `{{contact}}`, `validateDraftMarkdown`, `fact-check.ts`, per-section word/bullet limits with one retry. |
| 5 | Review | `analysis` (Opus) | Cohesion against the brief. Lists every factual claim as supported / uncertain / unsupported against profile evidence. Unsupported claims are removed. |
| 6 | Land | none (code) | `createDraft` into the desk. The owner accepts or discards in the existing `DraftReview`. Nothing overwrites a live document. |

### Claim verification and the coach

Uncertain claims are listed in the run log with a "verify with coach" action. **Not built yet:** the coach cannot write to the profile. `propose_profile_update` (`src/modules/chat/tools.ts`) is generic, with no target experience or achievement, and `docs/chat-assistant.md` notes the write-on-accept was not wired. The handoff needs its own piece of work (see Phase 4).

## Run record and transparency log

A `CvGeneration` row per run, copied from the `JobDeepDive` pattern (`deep-dive/run.ts`): status per stage, `failureKind`, `failureMessage`, `startedAt`, `completedAt`, `stageTimings`, `inputsHash`, plus a `log` Json column.

The "Generation log" panel shows, per stage:

- model used, duration, tokens and cost (summed by `runId` as `getRunUsage` does for deep dives)
- what Select kept and dropped
- validation retries
- review edits and flagged claims

Progress uses the existing pattern: the run executes in `after()` and `AssessmentPoller` refreshes the page while a stage is active.

## Usage attribution

Every call passes `attribution: { jobApplicationId, runId: row.id }`. Changes needed:

- add `writingDeskDocumentId` to `LlmUsageLog` (migration), set once the draft target is known
- new feature tags `cv-gen-brief`, `cv-gen-select`, `cv-gen-write-*`, `cv-gen-review`, each with a label in `src/app/dashboard/settings/usage/_components/feature-labels.ts`
- refresh the stale feature table in `docs/llm-usage-tracking.md`
- unrelated gap noted in the audit: `scout-triage` has a job in scope but passes no attribution

## Reused components

- `buildWritingContract` (`src/modules/mcp/contract.ts`), generated from the block registry so it cannot drift
- `buildStructureGuide` (`src/modules/writing-desk/structure-guide.ts`)
- `validateDraftMarkdown`, `createDraft`, `DraftReview`, `{{contact}}` substitution
- `fact-check.ts` (warnings only; becomes an input to Review)
- `deep-dive/run.ts` status machine, advisory locks and stale-run handling
- `completeJSON` with Zod (large schemas hit the provider grammar limit, see `docs/deep-dive.md`)
- `AssessmentPoller`

## Known constraints

- `createDraft` refuses if a draft already exists, and accepts only `cv` or untyped documents. The Land stage must handle "draft exists" (ask to discard or open it).
- A job holds at most 10 desk documents (`src/modules/writing-desk/schema.ts`).
- The desk stores Markdown, not the legacy JSON, so nothing from `CVDocumentContent` carries over.

## Delivery plan

Each phase is its own PR, cut from `origin/main`.

1. **Schema, run row, log panel.** `CvGeneration`, `LlmUsageLog.writingDeskDocumentId`, the poller and the empty log UI.
2. **Gather, Brief, Select.** Prompts, schemas, caps, deep-dive and `jobAnalysis` fallback.
3. **Section writers and Assemble.** Wave 1 and wave 2, validation and retry.
4. **Review, Land and coach handoff.** Claim table, draft creation, coach write path.
5. **Switch the entry point.** "Generate CV" in `src/components/app-item-menu.tsx`, then deprecate `cv-builder/new` and `createAndGenerateCV`.

## Implementation record

_Filled in per phase: what shipped, file locations, schema and migration names, prompt locations, caps and limits chosen, usage tags, and deviations from this plan._

- Phase 1: **in review (PR #414).** The run row, usage attribution and an empty-but-working generation log. No prompts, no LLM calls, no stages, and "Generate CV" still points at the old flow.
  - **Migration** `20261118085231_cv_generation_run`: new `CvGeneration` table, and `LlmUsageLog.writingDeskDocumentId` (nullable, indexed, FK to `WritingDeskDocument`, `ON DELETE SET NULL`).
  - **Schema**: `prisma/schema/cv-generation.prisma`. Columns: `id`, `profileId`, `jobApplicationId`, `writingDeskDocumentId?`, `deepDiveId?`, `status`, `failureKind?`, `failureMessage?`, `inputsHash?`, `startedAt?`, `completedAt?`, `stageTimings Json?`, `log Json?`, `createdAt`, `updatedAt`. Indexes `(profileId, jobApplicationId, createdAt)`, `(profileId, status)`, `writingDeskDocumentId`, `deepDiveId`. Relations: profile and job cascade on delete; desk document and deep dive `SetNull`.
  - **Attribution**: `writingDeskDocumentId` on `LlmAttribution` and `resolveAttribution` (`src/modules/llm/attribution.ts`). It must belong to the profile, and to the given job (or the job a CV implied); otherwise it is dropped with a warning. Without a job it supplies the document's job. The BYOK client's `writeUsageLog` (success and failed-call paths) and the Jev reservation both store the resolved value. `docs/llm-usage-tracking.md` documents the field and its feature table is refreshed to the current tags.
  - **Module** `src/modules/cv-generation/`:
    - `schema.ts`: `CV_GENERATION_STATUSES`, `ACTIVE_STATUSES`, `CV_GENERATION_STAGES` and `STAGE_STATUS`, `FAILURE_KINDS`, `CV_GENERATION_STALE_MS` (15 min), `CV_GENERATION_CONCURRENCY_PER_PROFILE` (2), the Zod log schema (`StageLogEntrySchema`, `CvGenerationLogSchema`) and the tolerant `parseCvGenerationLog` / `parseStageTimings`.
    - `queries.ts`: `getLatestCvGeneration(profileId, jobId)`, `getCvGeneration(profileId, runId)`, `getRunUsage` (total plus per-feature `UsageBucket`s, built on `summarizeRows` from `llm/job-cost.ts`), `isStaleRun`, `effectiveStatus`.
    - `run.ts`: `createCvGenerationRun` (advisory-lock admission: one live run per job, two per profile; inserts the `queued` row and starts nothing), `setStatus` (forward-only guarded transition via `allowedFrom`), `updateActive`, `failRun`, `FAILURE_MESSAGES`.
  - **UI**: `src/app/dashboard/job-applications/view/[id]/cv-generation/page.tsx` with `_components/generation-log.tsx` (`StageStepper`, `GenerationLog`), and the pure helpers in `src/app/dashboard/job-applications/_components/cv-generation-view.ts` (stage rows, formatters, poller signature). It renders the empty state ("No CV generation has run for this job yet"), the active stepper (mounting the unchanged `AssessmentPoller`), the failed state, and the complete state with a link to the draft. The side panel shows run time, status, estimated cost and call/token totals. Each stage row shows model, duration, tokens, cost, retries, notes, kept/dropped (collapsed) and flagged claims from the stored log.
  - **Tests**: `schema.test.ts`, `run.test.ts`, `queries.test.ts` in the module; `cv-generation-view.test.ts`; the attribution tests (`attribution.test.ts`, `client-attribution.test.ts`) cover `writingDeskDocumentId`.
  - **Deviations from the plan**:
    - `status` is a `String` with a Zod/TypeScript union, not a Postgres enum, like `JobDeepDive`, so a later phase can add or rename a status without a migration.
    - A `landing` status was added for stage 6 (Land) so every stage has one; the plan's statuses are in stage order, so `assembling` precedes `reviewing`.
    - `CvGeneration` also carries `updatedAt` and `deepDiveId` (the source deep dive).
    - `docs/cv-generation.md` already existed on `main` and described the legacy pipeline. It moved to `docs/cv-generation-legacy.md`; this plan took its place.
    - The generation log page is reachable only by URL (`/dashboard/job-applications/view/<id>/cv-generation`). The job workspace nav (`job-document-nav.tsx`) is built from fixed document kinds plus a hard-coded Deep Dive entry, with no obvious slot for a new tab, so no link was added; phase 5 (the entry-point switch) adds it.
    - No feature labels were added; no feature emits yet.
- Phase 2: **in review.** Stages 0-2 only: Gather, Brief, Select, run as a *preview* (no section writers, no draft, "Generate CV" still points at the old flow).
  - **Migration** `20261118130000_cv_generation_brief_selection`: `CvGeneration.brief Json?` and `CvGeneration.selection Json?` (nullable, no backfill). Both are validated with Zod on read (`parseBrief`, `parseSelection`) and read as null when missing or malformed. Phase 3 reads them through `CvGenerationView.brief` / `.selection` (`getCvGeneration`).
  - **Files** (`src/modules/cv-generation/`):
    - `gather.ts` (+ `candidates.ts`, `strategy.ts`): no model call of its own. Loads the vault (`loadVault`), the contact-free profile text (`serializeProfileForLLM`, pii scrubbed) for `inputsHash`, and builds the *candidate list* from the vault with the database id of every experience, activity, skill, tool, competency, certification, education and project, so Select can only return real ids. Strategy precedence: newest `complete` deep dive's report (`cvStrategy`, gaps, strengths; read with `parseReport`) > `JobApplication.jobAnalysis` > `analyseJob` as the last resort (see "Review fixes" for the out-of-date rule and the timeout). The master CV and career vertical are never read (the test's prisma mock has no such table). `inputsHash` = sha256 of profile text, description, strategy and deep dive id.
    - `brief.ts`: one `completeJSON` call, role `analysis`, feature `cv-gen-brief`. Output `CvBriefSchema`: `hiddenQuestion`, `leadWith`, `emphasise[{item, why}]`, `playDown`, `positioning`, `tone`, and `budgets` per section (clamped to the caps by the schema). It reads the job description, the strategy and a short outline (titles, names, counts; not activities).
    - `select.ts` + `caps.ts`: one call, role `fast`, feature `cv-gen-select`, over the candidate list. `enforceSelection` applies every cap in code after the answer (unknown ids dropped, duplicates removed, truncation in the model's rank order, roles and header-only roles as in "Review fixes", activities by recency tier among the roles that show bullets). `fallbackSelection` chooses by rules (recency, highlighted, achievements, matches to the brief's lead-with and emphasise terms) when the call fails or names nothing real, and then goes through the same `enforceSelection`; a fallback is noted in the log and never fails the run.
    - `call.ts`: `completeValidated`, shared by Brief and Select: `completeJSON` + Zod, plus one retry for an answer that parses but does not match (the retry prompt names the failing fields, never echoes the model's text). Not native structured output, because of the provider grammar limit in `docs/deep-dive.md`.
    - `run-pipeline.ts`: `startCvGeneration(profileId, jobId, { stopAfter: 'selecting' })` (admission via the existing `createCvGenerationRun`, then `after()`), `runCvGenerationStages(runId, profileId)` (guarded `setStatus` gathering → briefing → selecting, one log entry per stage with model, duration, tokens and cost from the usage rows of this `runId` and feature, kept/dropped, retries and notes; `failRun` with `no_llm_key` (checked before gathering, via `getLLMConfigStatus`), `no_description`, and `rate_limited` / `overloaded` / `refusal` / `invalid_output` / `timeout` mapped from `LLMError.kind`, else `error`). Every call carries `attribution: { jobApplicationId, runId }`; there is no `writingDeskDocumentId` because no document exists yet. With `stopAfter: 'selecting'` the run ends `complete` with `log.partial = true`.
    - `schema.ts` additions: `CvBriefSchema`, `CvSelectionSchema`, `CvGenerationLogSchema.partial`, `TIME_BUDGET_MS` (brief 90 s, select 60 s, run 280 s inside the 300 s route limit), `CV_GENERATION_FEATURES`, `STRATEGY_SOURCES`.
  - **Entry points**: `POST /api/jobs/[id]/cv-generation` (session; 202 `{runId}`, 200 if one is already running, 404, 429; `maxDuration = 300`) and a "Run preview" button on the log page (`_components/run-preview-button.tsx`, then the existing `AssessmentPoller` picks up progress). A missing LLM key or description is *not* refused by the route: the run is created and ends `failed`, so the log page shows why.
  - **UI**: a preview run is labelled "Preview run: writing, review and draft stages are not built yet"; its Write/Assemble/Review/Land rows read "not run yet", not "done". The page shows the Brief as labelled rows and the Selection grouped (roles, each role's evidence, then skills, tools, ...) with the reason for each kept item and what was left out and why (collapsed). Pure helpers: `cv-generation-view.ts` (`briefRows`, `selectionGroups`, `selectionSummary`, `startResponseMessage`).
  - **Prompts**: `src/lib/prompts/cv-gen-brief.md` and `cv-gen-select.md`, registered in `PROMPT_REGISTRY` (keys `cv-gen-brief`, `cv-gen-select`, group `cv`) and loaded with `loadCVBriefPrompt` / `loadCVSelectPrompt` like `cv-generate.md`, so users can override them in Settings → Prompts. The JSON Schema block is appended in code, so an edited prompt cannot break the output contract.
  - **Caps chosen** (`caps.ts`, all named constants): roles with bullets 4 (`MAX_EXPERIENCES`; the most recent is always one) plus 4 header-only roles (`MAX_HEADER_ONLY_ROLES`), activities per role 5/4/3 by recency tier (`ACTIVITIES_PER_ROLE`, the legacy `ROLE_BUDGETS`; the tier is the role's place among the *kept* roles, not the profile, so a short CV does not waste a 5-slot tier), skills 12, tools 10, competencies 6, certifications 4, education 3, projects 2. The numbers come from the legacy limits and the page-budget prose in `cv-generate.md` (a tight two-page CV); the Brief may ask for fewer, never more. `MAX_RECORDED_DROPPED` (300) bounds the stored list of dropped candidates (the rest are counted in `droppedTotal`).
  - **Tests**: gather source precedence and "master CV never read" (`gather.test.ts`), caps / unknown-id / dedupe / fallback (`select.test.ts`), Brief schema, clamping and retry (`brief.test.ts`), runner status progression, log, failure mapping and stale handling (`run-pipeline.test.ts`), route auth, ownership and limit (`route.test.ts`), view helpers, queries. Cross-profile cases: gather, the runner and the route all query by `profileId` and treat another profile's job or run as not found / a no-op.
  - **Usage**: `cv-gen-brief` and `cv-gen-select` in `FEATURE_LABELS` and the feature table in `docs/llm-usage-tracking.md`.
  - **Deviations**:
    - A fourth strategy source, `none`: if `analyseJob` also fails (it swallows its errors), the Brief runs on the job description alone and the log says so, rather than failing a run for a missing nice-to-have input.
    - Gather is "no LLM" except for that last-resort `analyseJob`, which logs under `cv-job-analysis` with the run's `runId`; its cost shows on the Gather row.
    - The newest complete deep dive is read with a direct query plus `parseReport`, not `getDeepDiveForCoach` (which renders the whole report to Markdown and runs usage queries we do not need). An unreadable report falls through to `jobAnalysis`.
    - The route returns 429 (not 409) at the limit, and 200 for an already-running run.
    - The migration SQL was written from `prisma migrate diff` and applied to the shared dev database alone (`migrate resolve --applied`), because `migrate dev` would also have applied the pending `20261118120000_cv_generation_job_index` from `main`.
  - **Review fixes** (an Opus review of this PR; all applied before merge):
    - **Role selection** (`select.ts`, `caps.ts`). A role whose activities were picked counts as picked (after the roles the model listed, in activity pick order), so activities are no longer dropped as `role_not_kept` and an answer with only activities no longer triggers the rules fallback. When the model picked fewer roles than the budget, the budget is filled by recency. The most recent role is always among the roles with bullets (it replaces the lowest-ranked pick when the budget is full).
    - **Design decision: all roles stay visible, so the work history has no gaps.** Roles with bullets are capped at `MAX_EXPERIENCES` (4; activity budgets 5/4/3 by recency, as before). Further roles are kept as **header-only** entries (company, title, dates, no bullets), most recent first, up to `MAX_HEADER_ONLY_ROLES` (4 more). A role beyond that is dropped, reason `over_cap`. So a CV shows at most 8 roles. Header-only roles are chosen by recency alone, whether or not the model picked them. The rules fallback follows the same rule (it only picks activities for the roles that will show bullets).
    - **Stored shape, for Phase 3.** `CvSelection` (`schema.ts`) gains `headerOnlyRoles: SelectedItem[]` (`{ id, label, reason }`; ids are the profile's experience ids, newest first; company, title and dates are read from the profile by id, `label` is "Role — Company"). `experiences` is the roles that show bullets, newest first, and `activities` is keyed by those roles only: a header-only role has no key. The writer renders `experiences` with bullets, then `headerOnlyRoles` as one line each, in the same newest-first order (the two lists are each newest first; merge by profile order if the CV shows one timeline). Rows stored before the field existed parse with `headerOnlyRoles = []`; no migration (the column is Json). New drop reason `role_header_only` ("its role is listed without bullets") for activities the model picked in a header-only role. The log page's Selection panel shows a "Listed without bullets" group.
    - **Select sees the job's requirements.** The Select prompt carries the strategy's `mustHave` / `niceToHave` and their key terms inside a `<job_requirements>` data block (a requirement cannot close the block), and `cv-gen-select.md` tells the model to choose skills and tools against them as well as the brief. The rules fallback matches the same terms. The prompt also names the most recent role's id and says it must be included and counts toward the role budget (before, it told the model it need not spend a pick on it, and code then evicted the model's lowest-ranked role).
    - **Brief prompt** (`cv-gen-brief.md`): the hidden question is inferred only from the job description and the strategy source, with no company facts that are not in them; lead-with and emphasise name roles or themes from the outline and never a number, result or tool it does not show; one line says the brief is direction, not evidence. The JSON Schema block appended in code is unchanged.
    - **Out-of-date deep dive** (`gather.ts`). The newest complete deep dive's `inputsHash` is compared with `currentInputsHash` (`src/modules/deep-dive/gather.ts`, the check behind `outOfDate`). When they differ the Gather log notes "The deep dive is out of date for this job"; a `jobAnalysis` written after the deep dive (`jobAnalysedAt` later than its `completedAt`) is then preferred and the note says so, otherwise the deep dive is still used and the note says that. An unknown hash (none stored, or the check fails) is not "out of date".
    - **Token caps and retries** (`schema.ts`, `call.ts`): brief 4000 first try / 8000 retry, select 8000 / 16000. Select's `reason` is at most 100 characters (prompt and Zod). `completeValidated` now makes at most **2 calls per stage** (it used to be up to 4: completeJSON's own cut-off retry restarted at the small cap inside each of its two attempts). completeJSON's retry is switched off (`minRetryMs: Infinity`); the one retry always runs at the larger cap, with a "cut off" note after `finishReason: 'length'` and a "rejected" note naming the fields otherwise.
    - **analyseJob deadline** (`gather.ts`): the last-resort call is raced against `TIME_BUDGET_MS.analyse` (60 s); a timeout is strategy source `none` with a Gather log note, so a hang cannot hold the run in `gathering` until the stale window.
    - **Nits.** The Brief never leaves education at 0 when the profile has education (`applyProfileBudgets` in `brief.ts`, and `enforceSelection` again for a stored brief). When the model picks no skills or no tools, they are refilled by rule (evidence-backed first, then profile order; a budget of 0 is respected). The stored dropped list now records what code cut before what was merely not selected, and `CvSelection.notSelectedTotal` holds the true "not selected" count, so the log line no longer overcounts once the list hits `MAX_RECORDED_DROPPED` (rows without it fall back to the old difference). `RunPreviewButton` lost its dead `active` prop and stays disabled until `router.refresh()` has rendered (`useTransition`).
  - **Left for Phase 3**: section writers and Assemble (they read `brief` and `selection` from the run row), `writingDeskDocumentId` on the usage rows, the `stopAfter` values beyond `selecting`, a link to the page from the job nav, and the entry-point switch (Phase 5). Select's `reason` strings are stored but not yet shown to writers. Real-provider quality of the two prompts is unmeasured: the suite mocks the model, and the preview was exercised in the app only for the no-key failure and with a seeded complete run for the display.
- Phase 3: _pending_
- Phase 4: _pending_
- Phase 5: _pending_
