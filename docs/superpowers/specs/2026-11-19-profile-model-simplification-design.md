# Simplifying the profile model: roles own achievements, projects are labels

**Date:** 2026-11-19 · **Status:** Proposal, for the owner's decision. Nothing here is built.
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

- Give each profile an experience of a new `type` (§6) such as `independent`, titled e.g. "Independent projects". Personal projects hang under it. It is created on demand and is never required.
- It must **not** be treated as a job. Today `experience_dates_reversed`, `concurrent_roles`, `employment_gap`, `thin_narrative`, the employer progression line, header right-to-work and the CV's Experience section all read experiences as employment. A type flag lets each of them skip or specialise it.
- In the CV it renders in a **Projects** section, not in Experience, and only when selected for the job.

### 5.2 Responsibilities become "scope"

External evidence (collected in the appendix, with its limits) supports achievements over duties. Recruiters spend the first scan on titles, employers and dates, then keywords, and survey advice consistently prefers stated results. The most defensible reading is:

- **Achievements** are the evidence.
- **Scope** is one or two lines of context that make the achievements legible (team size, remit, geography, budget). It is optional and is never selected as a bullet.

Existing `kind = 'responsibility'` rows are not deleted. See open decision O2.

## 6. Data model changes

One migration per phase, each created with `npm run db:migrate -- --name <name>`.

**Migration A (shape)**

- `Experience.type String @default("employment")`, values `employment | independent`.
- `Project.experienceId` becomes required. Backfill: every project that has an `experienceId` keeps it; every project without one is **reported to the owner and attached only after they choose a role** (default offered: the "Independent projects" experience).
- `RoleActivity.experienceId` becomes required. Backfill: a row with only `projectId` gets that project's `experienceId`. A row with both keeps both (the project label). The `projectId` column stays.
- Add a database check that when `projectId` is set the activity's `experienceId` equals the project's `experienceId`, or enforce it in the action (a check across tables needs a trigger; the action guard already exists, so start there).

**Not in migration A**

- No new scope column yet. Scope reuses the existing role overview text (the `## Overview` section) until O1 is decided.
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

1. Open a role. See its scope line, then its achievements grouped by project, then ungrouped ones.
2. Add an achievement: text, optional result (measure, value, baseline, period, as in #442), optional project from a dropdown of that role's projects, with "new project" inline.
3. Free-text import still proposes achievements from pasted notes. Accepting one asks only "which project, if any".
4. Moving an achievement means changing its role, not choosing between a role and a project. The Move dialog from #443 reduces to a role picker plus the project dropdown.

Screens that shrink: the project note's own evidence list (it becomes a filtered view of the role's achievements), the Move dialog, and the ownership explanation text.

## 10. Phasing: small PRs, each reviewed

| PR | Content | Needs owner |
|---|---|---|
| 1 | Migration A with a **dry-run backfill report** (projects with no role, activities with only a project). No constraint tightened yet. | Approves the report |
| 2 | Apply constraints, `type` flag, "Independent projects" creation, date/gap checks skip it | Decides names (O3) |
| 3 | Achievement form: project dropdown, grouping on the role page, Move reduced to role picker; project note becomes a filtered view | None |
| 4 | Vault build and readiness: remove `outcome_without_project`, add the link suggestion | None |
| 5 | Generator: Select shortlist with handles; project name rule | **Lifts the generator pause** |
| 6 | Optional embeddings spike | Decides after PR 5 |

Items 4, 5, 6 and 8 of #440 (inline date checks, `Project.product`, results section in the template, certification status) are not blocked by this and are mostly absorbed or made unnecessary: `Project.product` is not needed if the project label and an owner's wording are enough.

## 11. Risks

- **The independent experience leaks into employment logic.** Mitigated by the `type` flag and a test in each date/gap/employer check.
- **Backfill guesses wrong.** Mitigated by the dry-run report and owner approval before any constraint.
- **Extraction duplicates** (re-extracting a role recreates an achievement already labelled with a project). The label makes the check simple: compare against all of the role's achievements. This closes the gap left in #443.
- **Two sources of truth.** The note markdown and the rows can still drift. This design does not solve that; it should be raised separately (§12, O4).

## 12. Open decisions

- **O1. Where does scope live?** Reuse the role's Overview text, or add a short `scope` column. Recommendation: reuse Overview, no migration.
- **O2. Existing responsibilities.** Keep as scope text, fold the useful ones into achievements, or hide. Needs the owner to look at their own rows.
- **O3. Independent experience.** Name, and whether dates are shown or hidden in the CV.
- **O4. Should the markdown note stay a capture surface?** If rows are the source of truth, the note could become an import-only view. Separate decision.
- **O5. Verify the external advice.** The research below is thin and vendor-heavy. Worth one pass from a recruiter or hiring manager the owner trusts before dropping responsibilities from CVs entirely.

## Appendix: external evidence and its limits

- A 2013 [CareerBuilder/Harris Poll of hiring managers](https://plansponsor.com/?p=14511) found achievements and accomplishments valued. A 2010 ResumeBucket survey, reported by the [Christian Science Monitor](https://m.csmonitor.com/Business/2010/1016/Resume-writing-101-Keywords-can-make-you-stand-out), found about half of employers picked résumés on stated results.
- [TheLadders eye-tracking study](https://www.hrdive.com/news/eye-tracking-study-shows-recruiters-look-at-resumes-for-7-seconds/): about 7.4 seconds on the first scan, almost 80% on name, titles, companies, dates and education, then keyword matching. A small lab study (30 recruiters) by a company that sells résumé services.
- Often-quoted percentages ("58% prefer results") trace to vendor blogs with conflicting sources and were **not verified**. They are not used here.
- An "80/20 achievements to responsibilities" split appears as a rule of thumb, not data.
