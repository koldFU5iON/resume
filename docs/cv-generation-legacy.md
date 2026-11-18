# CV Generation — How It Works

> **Legacy.** This describes the cv-builder pipeline (`createAndGenerateCV`), which is being replaced by the writing-desk flow planned in [`cv-generation.md`](./cv-generation.md). Kept until that flow ships and the old routes are removed.

The CV builder uses a **multi-pass AI pipeline** to produce a targeted, evidence-driven CV. Each pass has a distinct job; they feed into each other in sequence.

---

## Overview

A CV generation run does four things in order:

1. **Gather** — collect all inputs from the database (no LLM)
2. **Analyse** — understand what the job actually needs (LLM, job-targeted only)
3. **Score** — pick the best evidence from the candidate's history (LLM, job-targeted only)
4. **Write** — produce the CV sections from the filtered evidence (LLM, always)

A fifth step, **Scan**, runs fire-and-forget after writing as a quality check.

Generic CVs (no job target) skip passes 2 and 3 and apply a deterministic budget instead.

---

## Triggering Generation

There are two entry points:

- **New CV** — user visits `/dashboard/cv-builder/new?jobId=<optional>`. The page mounts and immediately calls the `createAndGenerateCV` server action. The CV row is created with `status: generating`, then the pipeline runs. When done, status becomes `draft` and the user is redirected to the editor.
- **Regenerate** — inside the editor, user confirms the regenerate dialog. This calls `regenerateCVContent`, which resets the same CV row to `generating` and re-runs the pipeline on the existing CV document.

Both paths call `generateCVContent` in `src/modules/cv/generate.ts`.

---

## Pass 0 — Gather Inputs

**File:** `src/modules/cv/generate.ts`

Everything needed is loaded in parallel before any LLM call:

| What | How |
|------|-----|
| Full profile data | `buildProfileSnapshot(profileId)` reads all DB tables and returns a `ProfileSnapshot` struct |
| Writing context | `loadWritingContext()` reads the user's writing brief from `UserSettings` + loads `writing-rules.md` from disk |
| CV prompt | `loadCVPrompt()` reads `cv-generate.md` from disk |
| Job details | If a `jobApplicationId` was provided, fetches `title`, `company`, `jobDescription`, and any cached `jobAnalysis` |

The `ProfileSnapshot` is the single source of truth for all candidate data. Every subsequent pass receives it directly; it is never re-fetched.

---

## Pass 1 — Job Analysis (LLM)

**File:** `src/modules/cv/analyse-job.ts`  
**Prompt:** `src/lib/prompts/cv-job-analysis.md`  
**Skipped if:** no job target, no job description, or `jobAnalysis` already cached on the `JobApplication` row

The model reads the job description and the candidate's profile summary, then produces a structured analysis:

```
{
  mustHave: string[]         // non-negotiable requirements
  niceToHave: string[]       // preferred qualifications
  risks: [{                  // hiring concerns
    risk: string
    severity: "low" | "medium" | "high"
    recommendation: string   // how to address it in the CV
  }]
  positioningStrategy: string // 1–2 sentence directive: what story to lead with
}
```

The result is persisted back to `JobApplication.jobAnalysis` so re-runs and other features (job fit assessment) can reuse it without an extra LLM call.

**Settings:** max 800 tokens, temperature 0.2 (low — we want precise extraction, not creativity)

---

## Pass 2 — Evidence Scoring (LLM)

**File:** `src/modules/cv/score-evidence.ts`  
**Prompt:** `src/lib/prompts/cv-evidence-score.md`  
**Skipped if:** no job target

Every activity in the candidate's experience history is sent to the LLM with coordinates `[roleIndex.activityIndex]`. The model returns a score (1–10) and a tier for each:

- `must-include` — directly proves a must-have requirement
- `useful-context` — relevant but not critical
- `cut` — not relevant to this role

`applyScores()` then rebuilds the profile snapshot keeping only non-`cut` activities, ranked by score, capped by **role budgets**:

| Role position | Max activities shown |
|---------------|---------------------|
| Current / most recent | 5 |
| Previous role | 4 |
| Older roles | 3 |

**Fallback:** if the LLM call fails, `applyRoleBudgets()` applies the same budget deterministically (takes the first N activities, no scoring). Generic CVs always use this fallback path.

**Settings:** max 1200 tokens, temperature 0.1 (very low — scoring needs consistency)

---

## Pass 3 — CV Draft Generation (LLM)

**File:** `src/modules/cv/generate.ts` (main pass)  
**Prompt:** `src/lib/prompts/cv-generate.md`

This is the main generation call. The user message is assembled from four blocks:

```
== JOB TARGET ==
[role title, company, full job description]

== JOB INTELLIGENCE ==
[must-haves, nice-to-haves, risks with recommendations, positioning strategy from Pass 1]

== CANDIDATE PROFILE ==
[Markdown serialization of the filtered/scored ProfileSnapshot from Pass 2]

== OUTPUT SCHEMA ==
[description of all section types the LLM must produce]
```

For a generic (no-job) CV, the first two blocks are replaced with `== MODE: GENERIC CV ==`.

The system prompt is assembled from three parts joined by `---` separators:

1. `writing-rules.md` — universal style rules (voice, accuracy, formatting)
2. User's personal writing brief (from `UserSettings.writingBrief`)
3. `cv-generate.md` — CV-specific instructions (section budgets, blacklisted phrases, output contract)

The LLM returns a `CVDocumentContent` JSON blob. The code strips any markdown fences and validates it against `CVDocumentContentSchema`. On validation failure it falls back to `parseCVContent()` which retries leniently, or returns an empty document.

**Settings:** max 4000 tokens, temperature 0.3

---

## Pass 4 — Recruiter Scan (fire-and-forget)

**File:** `src/modules/cv/scan-cv.ts`  
**Prompt:** `src/lib/prompts/cv-recruiter-scan.md`

After Pass 3 completes and the CV is saved, this runs asynchronously — it does not block the user. It simulates a 15-second recruiter skim and returns:

```
{
  takeaways: string[]       // what the recruiter walks away remembering
  positioningMatch: string  // does the CV lead with the right story?
  gaps: string[]            // what's missing or unclear
}
```

Currently this is logged to the console only and not surfaced in the UI. It is used for internal generation quality monitoring.

**Settings:** max 400 tokens, temperature 0.2

---

## Data Shapes

### CVDocumentContent (stored in `CVDocument.generatedContent` as JSON)

```ts
{
  version: 1,
  sections: CVSection[]
}
```

### CVSection (discriminated union on `type`)

Every section has: `id`, `type`, `visible: boolean`, `data`.

| type | key fields in `data` |
|------|--------------------|
| `header` | `name`, `headline`, `subHeadline?`, `contact: { email?, phone?, linkedin?, website? }` |
| `profile` | `content` (prose) |
| `competencies` | `items: string[]` |
| `capabilities` | `items: string[]` |
| `experience` | `company`, `titles[]`, `location`, `duration`, `description`, `outcomes[]` |
| `education` | `institution`, `qualification`, `field?`, `duration`, `grade?` |
| `certification` | `name`, `issuer?`, `date?`, `url?` |
| `skills` | `items: string[]` |
| `tools` | `items: string[]` |
| `languages` | `items: [{ name, proficiency }]` |

### CVDocument status lifecycle

```
creating → generating → draft
                      ↘ failed
```

---

## Key Files at a Glance

```
src/modules/cv/
  generate.ts          — pipeline orchestrator (the entry point)
  actions.ts           — server actions: create, regenerate, update section, toggle visibility, delete
  analyse-job.ts       — Pass 1: job analysis LLM call
  score-evidence.ts    — Pass 2: activity scoring + deterministic fallback
  scan-cv.ts           — Pass 4: recruiter scan quality check
  schema.ts            — Zod schemas for all section types + parseCVContent() fallback
  export.ts            — toMarkdown(), toText() for export/copy
  queries.ts           — getCV(), listCVs()

src/modules/profile/
  snapshot.ts          — buildProfileSnapshot() (DB read) + serializeProfileForLLM()

src/modules/llm/
  client.ts            — complete() and completeStructured() — the only LLM import point
  prompt-context.ts    — loads .md files from disk, loadWritingContext(), composeSystem()

src/lib/prompts/
  writing-rules.md     — universal style rules (included in every generation call)
  cv-generate.md       — main CV generation system prompt
  cv-job-analysis.md   — Pass 1 system prompt
  cv-evidence-score.md — Pass 2 system prompt
  cv-recruiter-scan.md — Pass 4 system prompt

src/app/dashboard/cv-builder/
  new/page.tsx         — triggers createAndGenerateCV on mount
  [id]/page.tsx        — loads CV, renders CvEditor
  [id]/_components/    — CvEditor, CvBlock, SectionRail, per-section block components
```

---

## Design Principles

**One DB read, many formats.** `buildProfileSnapshot()` is called once per generation run. `serializeProfileForLLM()` converts it to Markdown for the LLM. All passes share the same snapshot object — it is never re-fetched.

**Each pass has one job.** Analysis asks "what does the role need?" Scoring asks "which activities prove it?" Writing asks "what should the CV say?" Keeping these separate makes the prompts smaller, the outputs easier to validate, and failures easier to diagnose.

**Scores gate budgets.** The role budget (5/4/3 activities) is always enforced. For job-targeted CVs the LLM scores decide which activities fill those budget slots. For generic CVs or on failure, the first N activities fill them. The budget itself never changes.

**Prompts are files, not strings.** All system prompts live in `src/lib/prompts/` as `.md` files. They are loaded from disk at request time. This makes them editable without touching TypeScript and reviewable in the same way as code.

**All LLM calls go through one façade.** `client.ts` is the single import point. It handles provider routing, API key decryption, usage logging, and error normalization. Product features never import from the AI SDK directly.

**Structured output everywhere.** Every LLM call that returns data (not prose) uses `completeStructured()` with a Zod schema. If the model returns malformed output the Zod parse fails, not silent bad data.
