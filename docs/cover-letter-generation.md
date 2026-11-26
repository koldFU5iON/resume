# Cover letter generation (writing desk)

Status: **backend shipped (PR 1 of issue #471)**. The angle picker and log page are PR 2. Until PR 2 ships, the routes below are the only way in, and the old guided cover letter editor (`src/modules/writing-guide/`) stays as it is (#469).

Related: [`cv-generation.md`](./cv-generation.md) (the run machinery this reuses), [`llm-usage-tracking.md`](./llm-usage-tracking.md).

## Goals

The letter should be purposeful, relatable and a bit personal, and follow how good cover letters are written:

- a specific opening;
- one true "why this company" detail;
- one or two short stories with real results instead of a CV rehash;
- the candidate's own words for anything personal;
- a confident close;
- half a page to three quarters of a page.

The app asks **how to angle the letter first**, with suggestions, before writing anything.

## Flow

A run has two phases, each in `after()`. It pauses between them for the owner.

| # | Stage | Model or code | Role | What it does |
|---|---|---|---|---|
| 0 | Gather (`gather.ts`) | code | none | Reads the job and description; company facts and practicalities from the newest complete deep dive; strategy (deep dive, else `jobAnalysis`; there is no `analyseJob` fallback, so Gather never spends); the profile (contact scrubbed) and name; the job's writing desk CV (so the letter doesn't repeat it). |
| 1 | Angles (`stages.ts runAngles`) | model | `analysis` | Suggests 3 distinct angles (name, pitch, hook, proof points, a "why them" fact, what it plays down, fit), 2–3 personal questions with a topic, and a suggested tone. Code marks each angle's company fact `whyThemVerified` when it is found in the research or the job description (`isFactSupported`). The run then waits at `awaiting_choice`. |
| – | Choice (owner) | — | — | The owner picks an angle or writes their own, answers the questions (all optional), and picks tone (warm, direct, formal) and length (short, standard). |
| 2 | Write (`runWrite`) | model + code | default | Writes the letter to the structure in `cl-gen-write.md`. Code checks length, generic phrases and figures (`checks.ts`); one retry, then the letter is accepted with notes. Code builds the Markdown: a `:::header` with the name and `{{contact}}`, the salutation, the paragraphs, then the closing and the name. |
| 3 | Review (`runReview`) | model + code | `analysis` | A fresh recruiter read. Edits are applied only when the quoted text is found exactly once, the paragraph is not emptied, and the edit adds no unsupported figure or new generic phrase (`applyReviewEdits`). It also lists up to 4 concerns for the coach. Review never fails the run; it is skipped with under 20 s left. |
| 4 | Land (`land.ts`) | code | none | The letter goes into the job's cover letter document as a DRAFT: the document an earlier run used while it is still a cover letter of that job, else a new "Cover letter - Company" document. Nothing live is written. Accepting the draft fills `{{contact}}`. |

## Honesty rules

- **Personal statements:** the prompts allow them only from the owner's answers. With no answers, the letter stays professional, and Review can raise a `personal` concern with a question to answer.
- **Company facts:** only from the deep dive's company facts or the job description. An angle fact that code can't find is marked unverified, and the writer is told to use it only if it can confirm it.
- **Figures:** every multi-digit figure in the letter must appear in the profile, the answers, the job description or the research (`unsupportedFigures`). A missing one is a soft problem (one retry, then a note), and Review edits may never add one.
- **Generic phrases:** `CLICHES` in `checks.ts` (for example "I am writing to apply", "team player", "passionate about") are a soft problem in Write, and Review edits may never add them.

## Run record and states

The run row is `CoverLetterGeneration` (`prisma/schema/cover-letter-generation.prisma`, migration `cover_letter_generation`). Its JSON columns (`angles`, `choice`, `letter`, `review`, `log`) are validated with Zod on read and never throw.

The status moves `queued → gathering → suggesting → awaiting_choice → writing → reviewing → landing → complete`, or to `failed` from any open status. `setStatus` only moves forward.

- **Open runs.** A *processing* run (every open status except `awaiting_choice`) is open while it has progressed within `PROCESSING_STALE_MS` (10 min, measured from `updatedAt`). After that it reads as failed / `timeout`. A run at `awaiting_choice` stays open for `ANGLES_VALID_MS` (7 days), then reads as failed / `expired`. Reads never write.
- **Admission** (`run.ts`, under a per-profile advisory lock): one open run per job, and at most `CONCURRENCY_PER_PROFILE` (2) processing runs per profile. A run waiting for a choice doesn't count. `fresh: true` ends a waiting run as `superseded` and starts again. Choosing re-checks the limit under the same lock as it moves the run to `writing`.
- **Failure kinds:** `no_llm_key`, `no_description`, `timeout`, `rate_limited`, `overloaded`, `refusal`, `invalid_output`, `draft_exists`, `document_limit`, `expired`, `superseded`, `error`. A run that fails after Write keeps its `letter` (and `review`) on the row.
- **Draft protection:** a waiting draft on the target document is refused before phase 1 and before phase 2 (409, nothing spent). If one appears meanwhile, Land fails the run with `draft_exists` and keeps the letter.
- **Time budgets** (`TIME_BUDGET_MS`): angles call 90 s, phase 1 150 s, write call 100 s, review call 70 s, phase 2 270 s. The route `maxDuration` is 300 s.

## Remembered configuration

`UserSettings.coverLetterPreferences` (`preferences.ts`) holds the last tone and length, and answers to the reusable topics (`why_now`, `motivation`). Job-specific answers (`why_company`, `personal_connection`) are never remembered. A blank answer forgets its topic. The picker starts from these values (warm and standard the first time). `remember: false` on a choice leaves them unchanged.

## API

Every route is session-authed and scoped to the profile and the job.

- `POST /api/jobs/[id]/cover-letter-generation`, body `{ fresh?: boolean }` (optional):
  - 202 `{ runId, existing: false }`: phase 1 started;
  - 200 `{ runId, existing: true, status }`: the job already has an open run;
  - 409 `{ code: 'draft_exists', documentId }`;
  - 400, 404, 429.
- `GET /api/jobs/[id]/cover-letter-generation/[runId]` returns 200 `{ run, defaults }`:
  - `run` has the effective status and failure, `angles`, `choice`, `letter`, `review`, `log` and `writingDeskDocumentId`;
  - `defaults` is the picker's remembered tone, length and answers.
  - 404 when the run isn't this profile's and this job's.
- `POST /api/jobs/[id]/cover-letter-generation/[runId]/choice`, body `{ angle: { index } | { custom }, answers?: [{ topic, question, answer }], tone, length, remember? }`:
  - 202 `{ runId }`: phase 2 started;
  - 409 `{ code: 'not_waiting' }`: already chosen, finished or expired;
  - 409 `{ code: 'draft_exists', documentId }`;
  - 400, 404, 429.

## Prompts, roles and usage

The prompts are `cl-gen-angles.md`, `cl-gen-write.md` and `cl-gen-review.md`, editable in Settings → Prompts (group "cover-letter"). Write also gets the shared writing rules, writing brief and search profile summary. The neutral-prompts test covers `cl-gen-*`.

| Feature tag | Stage | Role |
|---|---|---|
| `cover-letter-gen-angles` | Angles | `analysis` |
| `cover-letter-gen-write` | Write | default |
| `cover-letter-gen-review` | Review | `analysis` |

Every call carries `attribution: { jobApplicationId, runId, writingDeskDocumentId? }`, with `runId` set to the run row's id. A typical run is 3 calls (5 with both retries).

## Code map

`src/modules/cover-letter-generation/`:

- `schema.ts`: statuses, limits, Zod shapes.
- `run.ts`: admission and transitions.
- `gather.ts`.
- `stages.ts`: angles, write and review, plus `applyReviewEdits`.
- `checks.ts`: pure checks and `letterMarkdown`.
- `land.ts`.
- `pipeline.ts`: the two phases.
- `queries.ts`: reads and `effectiveStatus`.
- `preferences.ts`.

Elsewhere:

- `landGeneratedDraft` in `src/modules/writing-desk/draft.ts` lands app-generated drafts of any document type; agent tools still use the CV-only `createDraft`.
- The routes are under `src/app/api/jobs/[id]/cover-letter-generation/`.

## Next (PR 2)

- "Generate cover letter" in the New document dialog and in an empty cover letter's empty state.
- The angle picker: angle cards (with "check this" on unverified facts), write your own, personal questions pre-filled from the remembered answers, and tone and length options pre-selected from the last choice.
- A run log page.
- Review concerns to the coach through `openCoachWithDraft`.
- Then the old cover letter editor goes read-only and its coach tools are removed (#469).
