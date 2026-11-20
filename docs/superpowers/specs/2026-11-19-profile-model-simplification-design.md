# Simplifying the profile model: roles own achievements, projects are labels

**Date:** 2026-11-19 · **Status:** Approved in direction; decisions recorded in §12. Nothing here is built.
**Builds on:** `2026-11-11-profile-map-design.md` (the vault), issue #440 and its PRs #442–#444, `docs/cv-generation.md` §20–21.
**Constraint kept:** the CV generator stays general and is never tuned to one person's data. Profile data is never changed without the owner seeing it first.

## 1. Why this document exists

Phase 1 of #440 made profile data more reliable (structured results, moving evidence, header facts). The next Canonical run showed those fixes worked. The owner's reaction was not relief but a worry: the profile "is getting in the way of surfacing the right information" and "overly complicates the capture process". The things being shaped are:

- job experience, with achievements, responsibilities and outcomes;
- projects, with results and metrics, that might be used inside a job experience.

That is a web with several overlapping concepts. Part of it is a consequence of the work in #440: the Move action, the `outcome_without_project` readiness check and the ownership guards all exist to manage one underlying ambiguity.

**The ambiguity:** an achievement has two possible owners, a role or a project. The same result ("9.6% CTR on the awards campaign") can be written under either, and the owner has to decide where it belongs. A wrong guess changes how the CV generator sees it.

## 2. What the evidence says is wrong, and what is not

From the Canonical run (see `docs/cv-generation.md` §21):

| Observed | Cause | Addressed by this design? |
|---|---|---|
| Select returned 22 ids that do not exist; skills, tools and competencies came back empty | Select is handed the whole vault and asked to echo opaque ids | Partly: a clean achievements table makes a shortlist with short handles easy (§7). The fix itself is a generator change. |
| The campaign name appears in 1 of 5 bullets drawn from it | No rule ties bullets to their project | Yes, once an achievement carries a single project label (§7). |
| Enemies, done in an earlier role, sits under the current title | Ownership is ambiguous and merged | Yes: one role owns each achievement. |
| Two lead-with items have no evidence | Data gap | No. No model change adds evidence that is not there. |

This is not a retrieval problem. A vector database would not fix any row above. See §8.

## 3. Goals and non-goals

**Goals**

1. One owner per achievement, always a role.
2. Personal and side projects are never isolated.
3. Capture is "pick a role, write what you did, name the project if there is one".
4. Capabilities stay derived, never authored.
5. A migration that loses nothing and changes no wording.

**Non-goals**

- No change to generator prompts or the pipeline in the data phases (the pause on generator tuning stands until the owner lifts it).
- No embeddings or vector store in this work (§8).
- No change to Education, Certification, Language or Capability notes.

## 4. Today's model (verified against `prisma/schema/profile.prisma`)

- `Experience`: company, role, dates, location, a markdown `summary` note (Overview / Responsibilities / Achievements / Skills headings that feed extraction), tags.
- `Project`: `experienceId` is **nullable** (`onDelete: SetNull`), name, description, markdown `notes`, status, dates, urls.
- `RoleActivity`: `experienceId` and `projectId` are **both nullable**. `kind` is `responsibility | achievement`. `description`, free-text `impact`, structured `result` (Json), `highlighted`, `order`, skill links.
- Exactly-one-owner is enforced only in code (`ownedTarget`, `moveActivity` in `src/modules/profile/actions.ts`).
- The same content can live in three places: the note markdown, the `RoleActivity` rows extracted from it, and the project `highlights` column.

## 5. Proposed model

**A role owns every achievement. A project is a label on an achievement, never an owner.**

| Concept | Definition | Authored by |
|---|---|---|
| **Experience** | Employer, title, dates, location, and a short optional **scope** (§5.2). Also the home for independent work (§5.1). | Owner |
| **Achievement** | What was done, with an optional structured result. Belongs to exactly one experience. Optionally names one project. | Owner, or proposed by extraction and accepted |
| **Project** | A named campaign, launch or product inside one experience, with a short description and status. Achievements point at it. | Owner, or created when an achievement names one |
| **Capability** | Skill, tool, domain or competency, with derived status | Derived from achievements; never authored directly except as a claim |

Outcomes and results stop being a concept of their own. They are the `result` on an achievement, as already built in PR #442.

### 5.1 Personal projects: an "independent" experience

The owner builds side projects (including this one) that have not "done anything yet". They should still appear, and never float free of any context.

- Give each profile an experience of a new `type` (§6) such as `independent`, titled e.g. "Independent projects". Personal projects hang under it. It is created on demand and is never required. It is **timeless**: no start or end date is shown anywhere, and the date columns are not read for it.
- **Position on the CV (decided): a Projects section after Experience.** Side work never reads as a job. Promoting selected independent work into Experience for a thin-history job is a possible later option, and would be a generator change.
- It must **not** be treated as a job. Today `experience_dates_reversed`, `concurrent_roles`, `employment_gap`, `thin_narrative`, the employer progression line, header right-to-work and the CV's Experience section all read experiences as employment. A type flag lets each of them skip or specialise it.
- In the CV it renders in a **Projects** section, not in Experience, and only when selected for the job.

### 5.2 Responsibilities become "scope"

External evidence (collected in the appendix, with its limits) supports achievements over duties. Recruiters spend the first scan on titles, employers and dates, then keywords, and survey advice consistently prefers stated results. The most defensible reading is:

- **Achievements** are the evidence.
- **Scope** is one or two lines of context that make the achievements legible (team size, remit, geography, budget). It is optional and is never selected as a bullet.

Scope lives in the role's existing **Overview** text; there is no new column (decision O1). Existing `kind = 'responsibility'` rows that have content are **folded into the Overview** by a reviewed backfill and are not deleted, so nothing is lost and the owner can prune later (decision O2). The new extraction no longer produces responsibilities as peers of achievements (§9).

## 6. Data model changes

One migration per phase, each created with `npm run db:migrate -- --name <name>`.

**Migration A (shape)**

- `Experience.type String @default("employment")`, values `employment | independent`.
- `Project.experienceId` becomes required. Backfill: every project that has an `experienceId` keeps it; every project without one is **reported to the owner and attached only after they choose a role** (default offered: the "Independent projects" experience).
- `RoleActivity.experienceId` becomes required. Backfill: a row with only `projectId` gets that project's `experienceId`. A row with both keeps both (the project label). The `projectId` column stays.
- Add a database check that when `projectId` is set the activity's `experienceId` equals the project's `experienceId`, or enforce it in the action (a check across tables needs a trigger; the action guard already exists, so start there).

**Data backfill (not a schema change), also a dry run first**

- For each experience, the content of its `responsibility` rows is appended to the Overview text under a clear marker, in order, wording unchanged. The report shows every role's before and after for the owner to approve. The rows themselves stay until the owner chooses to remove them.

**Not in migration A**

- No new scope column (decision O1).
- `kind` stays as is.

**Rollback:** all changes are additive or tighten a constraint after a backfill. The backfill is run as a dry-run report first; the owner approves the list before the constraint is applied.

## 7. How the pieces read the model

**Vault and Profile Map** (`src/modules/profile-map`)

- An achievement note always has `contains`/`has` from one experience. Its optional project becomes a property and a `part_of` style link, not a second owner. This removes the "evidence under a project note" special case in `build.ts`.
- Gists keep merging `result` into impact once (`combineImpact`). No change.

**CV generator** (changes are for the generator phase, gated on the owner lifting the pause)

- Select receives a shortlist of achievements with **short handles** (`E1…En`) plus each one's role and project, and returns handles. Code maps handles back to ids and drops anything unknown. This is a response to the invalid-id failures in §2; it needs a logged run first to confirm the cause.
- When several chosen achievements share a project, the writer gets the project name once as shared context and is told to name it in each bullet that otherwise reads as detached. This is a general rule, not a one-person tune.

**Readiness** (`src/modules/profile-readiness`)

| Check | Change |
|---|---|
| `outcome_without_project` | Removed. Replaced by a suggestion on the achievement form: "this mentions *X*, which is a project in this role; link it?" |
| Role/project ownership guards | Simplified: ownership is no longer a decision. |
| `experience_no_evidence`, `thin_narrative`, `role_overview_thin` | Count achievements under the role, including those labelled with a project. |
| Date and gap checks | Skip `type = independent`. |
| `filler_responsibility` | Reconsider with O2. |
| `figure_in_prose`, `conflicting_figures`, certs, education, contact | Unchanged. |

## 8. Where retrieval fits, and where it does not

The question of a vector store came up. Position:

- **Facts are looked up, never retrieved**: identity, roles, dates, eligibility, certifications, location.
- **Selection of achievements** needs a shortlist per job requirement. The first, cheap signals are the capability link graph and lexical overlap, over a table that is now unambiguous.
- **Embeddings** are a possible third signal. Scale does not justify a vector database (a profile is tens to hundreds of items), and bring-your-own-key users on Anthropic have no embeddings API, so it could only be optional. Treat it as a spike after the model is clean: embed one profile and one job offline and compare its shortlist with the link graph. Add it only if it finds things the graph misses.

## 9. Capture flow (what the owner sees)

**Principle (decision O4): capture stays as easy as writing.** The owner writes freely in the role's note, Obsidian style. A clean-and-extract layer turns that into structured achievements, shown as a **draft** the owner can change before it counts as profile data.

1. **Write.** Free text in the role's note. Nothing is required.
2. **Extract and clean.** Today's extraction (`src/modules/profile/extract.ts`: local tag parser, then an LLM for untagged prose, suggestions held in memory, per-item accept, replace or skip, duplicate hints) is the starting point. It needs to change in these ways:
   - Output achievements by default. Duty-like lines go to scope, not to a peer type. The prompt's "when ambiguous, prefer responsibility" is reversed.
   - Propose, per achievement: a cleaned stand-alone first-person claim, a structured result (measure, value, baseline, period) where the text states one, and a project label from the role's projects, or a new project name. Never invent a figure.
   - Check against **all** of the role's achievements, including project-labelled ones, so re-extracting does not duplicate (closes the #443 gap).
3. **Draft.** Suggestions are saved as a draft attached to the note, so they survive leaving the page and a second run updates the draft instead of stacking. Each item shows the original wording beside the cleaned one. The owner edits, accepts, replaces or skips. Only accepted items become achievements. A draft is never read by the generator, the vault or readiness.
4. **Edit later.** An accepted achievement has a form: text, optional result, optional project (dropdown of the role's projects, "new project" inline). Moving an achievement means changing its role; the Move dialog from #443 reduces to a role picker plus the project dropdown.

The extraction runs on the owner's own LLM key and is started by the owner, as today. Running it automatically on save is a possible later option.

Screens that shrink: the project note's own evidence list (it becomes a filtered view of the role's achievements), the Move dialog, and the ownership explanation text.

## 10. Phasing: small PRs, each reviewed

| PR | Content | Needs owner |
|---|---|---|
| 1 | (built: `npm run profile:backfill-report -- --profile <id\|email>`, read-only; migration adds only `Experience.type`) Migration A with a **dry-run backfill report** (projects with no role, activities with only a project, responsibilities to fold into Overview). No constraint tightened yet. | Approves the report |
| 2 | **Overview fold only**: guarded apply script (`npm run profile:backfill-apply`: dry run prints a fingerprint, `--apply --confirm <fingerprint>` writes it in one transaction), near-duplicate responsibilities left out of the fold. Changes only `Experience.summary`; no activity row is touched. | Approves the fingerprint, then runs it |
| 3 | **Role-owns switch**, in five steps 3a–3e (§13). Readers and writers first, then data, then the constraint. | Chooses the experience's name (3d) |
| 3b | Achievement form: project dropdown, grouping on the role page, Move reduced to role picker; project note becomes a filtered view | None |
| 4 | **Clean-and-extract draft layer** (§9): extraction proposes cleaned achievements with result and project, a saved draft with edit, accept and skip, de-duplication against all the role's achievements | None (extraction prompts are profile capture, not generator prompts) |
| 5 | Vault build and readiness: remove `outcome_without_project`, add the link suggestion; CV renders independent work in a Projects section | None |
| 6 | Generator: Select shortlist with handles; project name rule | **Lifts the generator pause** |
| 7 | Optional embeddings spike | Decides after PR 6 |

**Why the assignment waits for PR 3.** Review of the apply script found that giving a project-only activity a role *before* the code expects it breaks things: deleting a role would cascade-delete the achievements of its "kept" projects (`RoleActivity.experience` is `onDelete: Cascade`); moving a project to another role, or merging two projects, would leave activities on the old role; `moveActivity`/`ownedTarget` clear the other owner column; the vault would add the same evidence twice (once through the role, once through the project), doubling readiness counts; archived projects' evidence would reach the generator through the role; and the generator would stop applying its project-evidence cap. PR 3 must handle each of these, with tests, before any row is assigned. The assignment step also guards on `projectId` (an activity moved to another project meanwhile must not be assigned).

Items 4, 5, 6 and 8 of #440 (inline date checks, `Project.product`, results section in the template, certification status) are not blocked by this and are mostly absorbed or made unnecessary: `Project.product` is not needed if the project label and an owner's wording are enough.

## 11. Risks

- **The independent experience leaks into employment logic.** Mitigated by the `type` flag and a test in each date/gap/employer check.
- **Backfill guesses wrong.** Mitigated by the dry-run report and owner approval before any constraint.
- **Extraction duplicates** (re-extracting a role recreates an achievement already labelled with a project). The label makes the check simple: compare against all of the role's achievements. This closes the gap left in #443.
- **Two sources of truth.** The note markdown and the rows can still drift. The draft layer (§9) narrows this: the note is where the owner writes, accepted rows are the profile data, and the draft is the visible bridge between them. A note edited after extraction does not silently change accepted rows.

## 12. Decisions (owner, 2026-11-19)

- **O1. Where does scope live?** Reuse the role's Overview text. No new column.
- **O2. Existing responsibilities.** Wrap any content into the main body (the Overview), so nothing is lost; unpick later. Done by a reviewed backfill (§6).
- **O3. Independent experience.** Timeless (no dates shown). Positioned as a **Projects section after Experience**. The experience's name is still to choose.
- **O4. Capture.** The note stays the capture surface. A clean-and-extract layer, built on the existing extraction, produces a draft the owner can change before anything counts (§9, PR 4).
- **O5. External check.** Deferred. The owner may ask a recruiter later; the evidence below is thin and vendor-heavy. Responsibilities are demoted to scope, not deleted, so the decision is reversible.

## Appendix: external evidence and its limits

- A 2013 [CareerBuilder/Harris Poll of hiring managers](https://plansponsor.com/?p=14511) found achievements and accomplishments valued. A 2010 ResumeBucket survey, reported by the [Christian Science Monitor](https://m.csmonitor.com/Business/2010/1016/Resume-writing-101-Keywords-can-make-you-stand-out), found about half of employers picked résumés on stated results.
- [TheLadders eye-tracking study](https://www.hrdive.com/news/eye-tracking-study-shows-recruiters-look-at-resumes-for-7-seconds/): about 7.4 seconds on the first scan, almost 80% on name, titles, companies, dates and education, then keyword matching. A small lab study (30 recruiters) by a company that sells résumé services.
- Often-quoted percentages ("58% prefer results") trace to vendor blogs with conflicting sources and were **not verified**. They are not used here.
- An "80/20 achievements to responsibilities" split appears as a rule of thumb, not data.

## 13. Plan for PR 3: the role-owns switch

Principle: **make every reader and writer correct for "a role owns it, a project may label it" before any row changes, change the rows, and only then tighten the database.** Each step is its own PR, reviewed, and none is irreversible until 3e. The current code treats the two owners as exclusive in many places (found in review of PR 2), so changing rows first would break them.

### 3a. Tolerant readers (no data change)
- **Vault** (`src/modules/profile-map/build.ts`): the vault keeps the hierarchy role → project → evidence. An activity that names a project is read as that project's evidence (the project sits inside the role), whether or not it also carries the role, so it is added **once** and counted once (readiness counts, the role gist). Rule (`belongsToProject` in `src/modules/profile/ownership.ts`): it is the project's when it has no role of its own or the project's role; if the two roles disagree the activity's own role is trusted and it stays the role's. This is what makes assigning roles invisible to readers. (An earlier draft of this plan put the activity "through the role"; keeping it under the project is what keeps every reader's output identical.)
- **Candidates** (`src/modules/cv-generation/candidates.ts`): the `fromProject` label and the `MAX_PROJECT_ATOMS` cap are derived from the evidence's project label instead of from project-owned notes; archived projects' evidence is left out as today. This is plumbing to keep the generator's input identical, not tuning.
- **Profile UI** (`queries.ts`, role page, project page): a role shows its achievements once, grouped by project label; the project page is a filtered view.
- **Golden test and check:** `src/modules/cv-generation/role-owns.test.ts`, and `npm run profile:golden-check` (read-only) which fingerprints the vault, CV candidates, readiness, profile map and LLM snapshot for a real profile as it is and with the assignment simulated in memory; run it before and after 3c, the "current" fingerprint must not change. Build the candidates for a fixture profile with project-only activities, then again with the same activities assigned to the role (both owners set). The two must be **identical** (same items, labels, caps, order). Also run on the owner's real profile read-only before and after 3c.

Known follow-ups found in review, not in 3a: role extraction (`getExperienceWithSuggestionContext`) still reads all of a role's activities, so after 3c a suggestion could match a project-labelled row (belongs with the draft layer, PR 4); `nextActivityOrder` ignores the project label (ordering only, 3b); the backfill planner treats a responsibility with a role as the role's, which is right for the one-off fold already applied.

### 3b. Safe writers (no data change; one constraint relaxed)
**Found while building 3b:** the database enforces "exactly one owner" with a CHECK constraint (`RoleActivity_exactly_one_owner_check`, migration `20261114004748`), so a row with both a role and a project is impossible today, and the writers below would fail. 3b therefore includes a migration that relaxes it to "at least one owner" (`RoleActivity_at_least_one_owner_check`). Every existing row satisfies it; it only permits the new shape. 3e later replaces it with NOT NULL on the role. Code ships after the migration (the deploy runs it first). New and moved activities that name a project now carry the project's role. **Rollback:** reverting the code is safe (old writers satisfy the new check), but the old constraint cannot be re-added once a row has both owners, without rewriting data first. Writes that delete or move evidence lock the role or project row first, so a concurrent write waits instead of landing between the steps. `npm run profile:roles-check` runs every write against a real local Postgres (the unit tests mock Prisma).

Tests first for each; today's behaviour is kept while a project can still have no role.
- `deleteExperience(…, 'keep')`: before deleting, detach the role from the kept projects' activities, because `RoleActivity.experience` is `onDelete: Cascade` and would otherwise delete them. (After 3e this becomes "move the kept projects and their activities to Independent projects".) The delete dialog's counts say what really happens.
- `saveProjectProperties` (moving a project to another role, or to none): also moves its activities' `experienceId`.
- `mergeProjects`: when the two projects belong to different roles, the merged activities follow the kept project's role.
- `createActivity` from a project note: sets the project's role as well as the project. `moveActivity`/`ownedTarget`: moving to a project keeps the role (the project's); moving to a role clears the project label. No operation may leave an activity whose role disagrees with its project's role.
- Assignment guard: the apply step filters on `projectId` as well as "no role yet", so a concurrent move cannot assign a stale role.

### 3c. Assign the roles (data)
Needs the 3b constraint change (otherwise the database refuses a row with both). Built: the guarded apply script (`npm run profile:backfill-apply`) now gives each project-only activity its project's role (guarded on: still no role, same project, project still has that role; refuses while anything needs the owner's decision) as well as folding notes, under one fingerprint. A responsibility with both a role and its project's role still folds into the *project's* note, so assigning changes nothing about where it folds. Extend the guarded apply script (dry run, fingerprint, `--apply --confirm`, one transaction) to give project-only activities their project's role. Your report lists the 19. Verification: candidates and vault built from production before and after must be identical (3a's golden check, read-only); readiness findings must not change.

### 3d. The independent experience
- `Experience.type = 'independent'`, created on demand, named by the owner (placeholder "Independent projects"), timeless.
- **Reader audit.** About thirty places read experiences as jobs (readiness date/gap/concurrent/thin checks, the vault and Profile Map, `employers.ts` and candidates, header facts, `snapshot.ts`, profile import and commit, the CV PDF and section rail, `master-cv`, `ats-score`, chat context, job-assessment candidate state, the writing-desk fact check, MCP tools). Each is checked and either skips independent experiences or renders them as projects. A test per reader. This is the largest step and is deliberately separate.
- Personal projects can be created under it from the UI.

### 3e. Tighten
- One migration: backfill deterministically (a project-only activity takes its project's role; a profile with a project or activity that still has no role gets an independent experience and they move to it), then `RoleActivity.experienceId` and `Project.experienceId` become NOT NULL. The migration is self-sufficient so the deploy (which runs it automatically) cannot fail or need a manual step. It is tested first against a copy of the production database.
- Remove the legacy project-only paths; the Move dialog becomes a role picker plus the project label; the achievement form gets its project dropdown; `outcome_without_project` is replaced by the link suggestion.

### Order and why
3a, 3b can ship in either order and change no data. 3c needs both. 3d is independent of 3c but must precede 3e (the migration needs somewhere to put orphans). 3e last.

### Risks
- **Generator input drifts.** Guarded by the golden test and the before/after check on production data.
- **A reader missed in 3d.** Mitigated by a grep-driven checklist in the PR and a test per reader.
- **The 3e migration on production.** Dry-run on a database copy; additive backfill before NOT NULL.
- **The generator pause.** 3a touches `candidates.ts` only to preserve its output; no prompt or pipeline behaviour changes. Anything beyond that waits for the owner to lift the pause (PR 6).

### Decisions needed from the owner
1. The independent experience's name (needed by 3d).
2. Deleting a role while keeping its projects: move them to Independent projects (recommended) or refuse unless they are moved or deleted first.
