# Simplifying the profile model: roles own achievements, projects are labels

**Date:** 2026-11-19 · **Status:** PR 5 merged. The owner approved short Select references and recorded project naming for PR 6, implemented on the PR 6 branch. Broader generator tuning still needs approval.
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

## 4. Model before the role-owns switch

- `Experience`: company, role, dates, location, a markdown `summary` note (Overview / Responsibilities / Achievements / Skills headings that feed extraction), tags.
- `Project`: `experienceId` is **nullable** (`onDelete: SetNull`), name, description, markdown `notes`, status, dates, urls.
- `RoleActivity`: `experienceId` and `projectId` are **both nullable**. `kind` is `responsibility | achievement`. `description`, free-text `impact`, structured `result` (Json), `highlighted`, `order`, skill links.
- Exactly-one-owner was enforced in code and by a database check.
- The same content can live in the note markdown, the extracted `RoleActivity` rows, and the project `highlights` column.

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

- Personal projects belong to an experience with `type = independent`, titled "Independent projects". It is created on demand. It is **timeless**: no start or end date is shown anywhere, and the date columns are not read for it.
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

**Role ownership (built)**

- `Experience.type String @default("employment")`, values `employment | independent`.
- `Project.experienceId` is required. Projects keep their recorded role. Projects without a role go to the oldest existing Independent projects experience in their profile, or a new one if needed.
- `RoleActivity.experienceId` is required. A project-only activity takes its project’s role after project backfill. Existing roles and project labels are preserved. Missing or cross-profile provenance aborts the migration.
- Create, edit and move check that a selected project belongs to the selected role. A direct role delete is refused while projects reference it. Whole-profile deletion can still cascade.

**Data backfill (not a schema change), also a dry run first**

- For each experience, the content of its `responsibility` rows is appended to the Overview text under a clear marker, in order, wording unchanged. The report shows every role's before and after for the owner to approve. The rows themselves stay until the owner chooses to remove them.

**Scope and activity kinds**

- No new scope column (decision O1).
- `kind` stays as is.

**Deployment order.** Merge and deploy [the compatibility writer (#455)](https://github.com/koldFU5iON/resume/pull/455) first. It turns the old Properties “No role” selection into Independent projects and works with both schemas. Only after that deployment is serving should step 3e be merged: the build applies migrations before the new app is ready, so the serving app must already avoid null owners. Keep the 3e PR in draft until the prerequisite is deployed.

**Rollback.** Prefer rolling the app back to the compatibility deployment (#455); it works with the tightened schema and preserves all backfilled owners. A rollback to earlier null-writing code must relax the schema first. On a disposable local database, the compatibility Properties writer passed after applying 3e. The following relaxation preserved all assigned owners, and the original nullable writes then passed:

```sql
BEGIN;
ALTER TABLE "RoleActivity" ALTER COLUMN "experienceId" DROP NOT NULL;
ALTER TABLE "RoleActivity" ADD CONSTRAINT "RoleActivity_at_least_one_owner_check"
  CHECK ("experienceId" IS NOT NULL OR "projectId" IS NOT NULL);
ALTER TABLE "Project" DROP CONSTRAINT "Project_experienceId_fkey";
ALTER TABLE "Project" ALTER COLUMN "experienceId" DROP NOT NULL;
ALTER TABLE "Project" ADD CONSTRAINT "Project_experienceId_fkey"
  FOREIGN KEY ("experienceId") REFERENCES "Experience"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
COMMIT;
```

This is an emergency schema relaxation, not an automatic down migration. It does not clear owners or remove the 3e migration history entry. Re-tightening after such a rollback requires a new reviewed migration that backfills any new null owners. Do not mark the old migration rolled back or simply redeploy expecting its SQL to run again.

## 7. How the pieces read the model

**Vault and Profile Map** (`src/modules/profile-map`)

- An achievement is shown once. A matching project label groups it under that project in the vault. The recorded role determines ownership.
- Gists keep merging `result` into impact once (`combineImpact`). No change.

**CV generator (PR 6)**

- Select receives the existing candidate menu with short, section-specific handles, including the current employer and supporting activity/project references. Code validates each reference and restores IDs before the existing selection rules. Version 8 invalidates earlier reuse keys. Those stored selections still read with their original IDs.
- Chosen achievements that share a project carry its saved label into the writer and Review even without a separate project pick. A bullet names its project where attribution would otherwise be unclear. Code can add a missing name when all citations agree and the name fits with the existing claim. Mixed or uncertain attribution is logged. Review keeps supported names with the claims they identify.

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
2. **Extract and clean.** PR 4 extends the local tag parser and optional LLM pass into a saved review flow. See the [extraction contract](../../profile-extraction.md).
   - Output achievements by default. Duty-like lines go to scope, not to a peer type. The prompt's "when ambiguous, prefer responsibility" is reversed.
   - Propose, per achievement: a cleaned stand-alone first-person claim, a structured result (measure, value, baseline, period) where the text states one, and a project label from the role's projects, or a new project name. Never invent a figure.
   - Check against **all** of the role's achievements, including project-labelled ones, so re-extracting does not duplicate (closes the #443 gap).
3. **Draft.** Suggestions are saved as a draft attached to the note, so they survive leaving the page and a second run updates the draft instead of stacking. Each item shows the original wording beside the cleaned one. The owner edits, accepts, replaces or skips. Only accepted items become achievements. A draft is never read by the generator, the vault or readiness.
4. **Edit later (built in 3e).** The form has text, an optional result, a role picker and an optional dropdown of that role’s projects. Move uses the same two ownership fields. If the wording names a project in the role, the form offers to link it.

The extraction runs on the owner's own LLM key and is started by the owner, as today. Running it automatically on save is a possible later option.

The role note groups labelled evidence by project. The project note shows the evidence in that role with the matching label.

## 10. Phasing: small PRs, each reviewed

| PR | Content | Needs owner |
|---|---|---|
| 1 | (built: `npm run profile:backfill-report -- --profile <id\|email>`, read-only; migration adds only `Experience.type`) Add a **dry-run backfill report** (projects with no role, activities with only a project, responsibilities to fold into Overview). No constraint tightened yet. | Approves the report |
| 2 | **Overview fold only**: guarded apply script (`npm run profile:backfill-apply`: dry run prints a fingerprint, `--apply --confirm <fingerprint>` writes it in one transaction), near-duplicate responsibilities left out of the fold. Changes only `Experience.summary`; no activity row is touched. | Approves the fingerprint, then runs it |
| 3 | **Role-owns switch** (built through 3e, §13). Includes the achievement form, role grouping, project-filtered view, Move, and the inline project suggestion that replaces the readiness finding. | Decisions recorded in §12 |
| 4 | **Clean-and-extract draft layer** (implemented) (§9): extraction proposes cleaned achievements with result and project, a saved draft with edit, accept and skip, de-duplication against all the role's achievements | None (extraction prompts are profile capture, not generator prompts) |
| 5 | Render selected independent projects after Experience. | Merged in #458 |
| 6 | Section-specific Select handles and a shared rule for recorded project names. | Owner approved these two changes. Implemented on the PR 6 branch. |
| 7 | Optional embeddings spike | Decides after PR 6 |

The role-aware readers and writers shipped before the constraints. They account for project archiving, evidence ordering and the existing generator project-evidence cap.

Items 4, 5, 6 and 8 of #440 (inline date checks, `Project.product`, results section in the template, certification status) are outside PR 6 and retain their own status. This PR uses the existing project label and evidence text.

## 11. Risks

- **The independent experience leaks into employment logic.** Mitigated by the `type` flag and a test in each date/gap/employer check.
- **Unresolved provenance.** The migration rejects missing or cross-profile references and preserves existing role assignments when a same-profile label differs.
- **Extraction duplicates** (re-extracting a role recreates an achievement already labelled with a project). The label makes the check simple: compare against all of the role's achievements. This closes the gap left in #443.
- **Two sources of truth.** The note markdown and the rows can still drift. The draft layer (§9) narrows this: the note is where the owner writes, accepted rows are the profile data, and the draft is the visible bridge between them. A note edited after extraction does not silently change accepted rows.

## 12. Decisions (owner, 2026-11-19)

- **O1. Where does scope live?** Reuse the role's Overview text. No new column.
- **O2. Existing responsibilities.** Wrap any content into the main body (the Overview), so nothing is lost; unpick later. Done by a reviewed backfill (§6).
- **O3. Independent experience.** Timeless (no dates shown). Positioned as a **Projects section after Experience**. The shipped name is **Independent projects**. Keeping projects when deleting a role moves them and their evidence there.
- **O4. Capture.** The note stays the capture surface. A clean-and-extract layer, built on the existing extraction, produces a draft the owner can change before anything counts (§9, PR 4).
- **O5. External check.** Deferred. The owner may ask a recruiter later; the evidence below is thin and vendor-heavy. Responsibilities are demoted to scope, not deleted, so the decision is reversible.

## Appendix: external evidence and its limits

- A 2013 [CareerBuilder/Harris Poll of hiring managers](https://plansponsor.com/?p=14511) found achievements and accomplishments valued. A 2010 ResumeBucket survey, reported by the [Christian Science Monitor](https://m.csmonitor.com/Business/2010/1016/Resume-writing-101-Keywords-can-make-you-stand-out), found about half of employers picked résumés on stated results.
- [TheLadders eye-tracking study](https://www.hrdive.com/news/eye-tracking-study-shows-recruiters-look-at-resumes-for-7-seconds/): about 7.4 seconds on the first scan, almost 80% on name, titles, companies, dates and education, then keyword matching. A small lab study (30 recruiters) by a company that sells résumé services.
- Often-quoted percentages ("58% prefer results") trace to vendor blogs with conflicting sources and were **not verified**. They are not used here.
- An "80/20 achievements to responsibilities" split appears as a rule of thumb, not data.

## 13. Plan for PR 3: the role-owns switch

### 3a. Tolerant readers
Built. The vault shows each activity once. Activities labelled with a project in their own role sit under that project. When a historical label disagrees, readers trust the activity’s role. The generator still uses the project label for evidence caps and archiving. Legacy fixtures and the golden check cover the transition from project-only to role-owned evidence.

### 3b. Safe writers
Built. The at-least-one-owner check shipped first so both references could be set. Project moves, merges and deletes account for both references, and the role and project notes consume the role-aware evidence groups.

### 3c. Assign existing project evidence
Built. The guarded apply script assigned project-only activity to its project's role while the old schema allowed it. Step 3e handles any remaining null owners. The apply script now handles the Overview fold only.

### 3d. Independent projects
Built. Independent projects has a separate type and is created on demand. Profile and employment readers account for the type. Creating a personal project or deleting an employment role and keeping its projects uses this home. Project locks are acquired in id order when keeping projects during a role delete.

### 3e. Require roles
Built on the feature branch. One migration performs the backfill, sets both role columns to NOT NULL, replaces the project foreign key’s delete behavior with NO ACTION, and removes the redundant activity check. It preserves existing rows and fields outside the two owner assignments. Profile ownership changes are serialized, and an activity keeps its own role when a different role’s project label is removed.

The role note groups evidence by project and the project note filters that evidence by label. Add, Edit and Move use a role and an optional same-role project label. Independent projects is available on demand, and its unlabelled evidence can be opened from the Independent projects section. The achievement form suggests a label when the wording names a project in the selected role.

The migration was validated first on an isolated production snapshot and then against synthetic legacy rows. PR 4 adds saved extraction drafts.

## 14. PR 5 CV output

An existing Select pick whose project belongs to an independent experience renders under Projects, after Professional Experience and Earlier Experience. The generator uses the saved project name and accepted bullets with their results. Projects without accepted atoms can use a bounded digest of saved context. Review can cite the sources and flag concerns. The section is read-only during Review and editable in the writing desk.

Independent achievements without a project label remain outside the Select menu. PR 6 keeps the independent Projects rendering and Review rules from PR 5.
