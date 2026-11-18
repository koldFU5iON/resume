# CV generation (writing desk)

Status: **plan agreed; phase 1 (run record, attribution, generation log) in review (PR #414).** The Implementation record at the end is filled in as each PR lands, so this file ends up as the implementation record. The pipeline of the code being replaced is kept in [`cv-generation-legacy.md`](./cv-generation-legacy.md) until phase 5 removes it.

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
| 2 | Select | `fast` (Haiku) | Chooses evidence per section (activities, skills, tools, certs). **Hard caps are enforced in code**, so over-production stops here. |
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
- Phase 2: _pending_
- Phase 3: _pending_
- Phase 4: _pending_
- Phase 5: _pending_
