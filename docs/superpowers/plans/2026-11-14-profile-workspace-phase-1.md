# Profile workspace, phase 1: implementation plan

**Date:** 2026-11-14 · **Spec:** `docs/design/profile-workspace/review-and-brief.md` (sections 3, 3.11, 5, 6)
**Branch base:** `origin/main` at `afb7871`

Phase 1 turns `/dashboard/profile` into a note workspace over the existing records, after first making project achievements real evidence. It is split into six PRs, each shippable on its own. No PR adds a new note type (that is phase 2).

Agreed decisions this plan relies on: D13 (deleting a role asks about its projects, default keep), D15 (guided merge of the three duplicate project pairs). Other section 6 recommendations are treated as accepted defaults: D3 (a `revision` column for conflict checks), D11 (project evidence lands first), D12 (project evidence shows under its parent role, stored once).

## Order and dependencies

```
PR 1 evidence ownership ─┬─> PR 2 duplicate-pair merge (D15)
                         └─> PR 3 shared editor + revisions ─> PR 4 workspace shell ─> PR 5 details panel ─> PR 6 records + phone
```

PR 2 is a one-off and can land any time after PR 1. PRs 3 to 6 are the visible redesign.

---

## PR 1: evidence can belong to a project

**Why:** 14 project highlights in production are JSON strings. They cannot be linked to capabilities, reviewed, or shown in an Evidence tab (brief 3.11).

### Schema and migration (`prisma/schema/profile.prisma`, one migration via `npm run db:migrate -- --name evidence_project_owner`)

- `RoleActivity.projectId String?` → `Project` (`onDelete: Cascade`), `@@index([projectId])`.
- `RoleActivity.experienceId` becomes optional. Keep `onDelete: Cascade`.
- `Project.activities RoleActivity[]` back-relation.
- Hand-edit the generated SQL to add:
  - `CHECK (("experienceId" IS NOT NULL) <> ("projectId" IS NOT NULL))`: exactly one owner.
  - Data copy: for each project whose `highlights` parses as a JSON array, insert one `RoleActivity` per string element: `kind 'achievement'`, `description` = element unchanged, `impact NULL`, `order` = zero-based index, `projectId` = project id, `tags '[]'`, new cuid-like id (`gen_random_uuid()::text` is acceptable; ids are opaque strings).
  - Skip `''`, `'[]'`, non-array JSON, non-string and blank elements. Malformed JSON must not abort the migration: guard with a `CASE`/`jsonb_typeof` check on a safe cast (`highlights ~ '^\s*\['` then `::jsonb`), or a PL/pgSQL block with an exception handler per row.
  - Idempotent: skip a project that already owns any `RoleActivity` (`NOT EXISTS`).
  - `Project.highlights` is **kept**. Nothing is dropped.

### Vault (`src/modules/profile-map/`)

- `source.ts`: `VAULT_INCLUDE.projects.include` adds `activities` with the same ordering and `skills` include as experience activities.
- `types.ts`: `EvidenceNote.props.parentId` documents that it may be a project id.
- `build.ts`:
  - Build evidence notes for project activities (`parentId` = project id), with derived `demonstrates` links exactly as for experience evidence.
  - Project notes get `has` links to their own evidence.
  - Experience notes keep `has` links to their **own** evidence only (no duplicate edges). Project evidence reaches the role through `contains` → `has`.
  - `ProjectNote.props.highlights` becomes the evidence descriptions when the project has evidence, else the parsed legacy column (fallback for any row the copy skipped).
- `render.ts`:
  - `contextOf` for project-owned evidence returns `Project title — Role at Company` when the project sits under a role.
  - Project render lists its evidence under `### Evidence` (as experience does) and no longer prints the `highlights` list separately when evidence exists.
  - Experience render adds evidence from contained projects under `### Evidence from projects`, so a single role note stays self-contained.
- `map.ts`: the per-role "What did you achieve" gap counts achievements owned by the role or by its contained projects. The near-duplicate evidence check treats a project and its parent role as the same parent.
- `query.ts`: `renderMapText` nests project evidence under the project; search covers project evidence (it already indexes evidence notes).

### Snapshot and CV input (`src/modules/profile/snapshot.ts`)

- `projects[].highlights` comes from the project's evidence descriptions (in order), falling back to the legacy column. The rendered `## Projects` section is byte-for-byte the same for a project whose evidence equals its old highlights. Experience `activities` stay role-owned only, so no achievement appears twice in a CV prompt.

### Ownership on every write path

| Path | Change |
|---|---|
| `modules/profile/actions.ts` `createActivity` | Accept an owner `{ experienceId } \| { projectId }`; verify it belongs to the profile |
| `updateActivity`, `deleteActivity` | Ownership filter becomes `OR: [{ experience: { profileId } }, { project: { profileId } }]` |
| `acceptSuggestions` | Unchanged owner (experience), but verify replaced rows belong to that experience, as today |
| `modules/profile-map/link-store.ts` `ownedPairs`, `listPendingSuggestions` | Same `OR` ownership; the pending-suggestion label reads the project (and its role) when the evidence is project-owned |
| `modules/profile-import/commit.ts` | Nested create under experience; no change needed, confirm |
| `modules/profile/queries.ts` | `getFullProfile` includes project activities so the UI can show them; `getExperienceWithSuggestionContext` unchanged |

A test proves a foreign profile's project or evidence id is refused by each path.

### Role deletion (D13)

- `deleteExperience(id, { projects: 'keep' | 'delete' })` (Zod-validated; no default on the server, the dialog always sends one).
  - `keep`: today's behaviour (`experienceId` set null).
  - `delete`: delete the role's projects (and so their evidence) and the role in one transaction.
- `DeleteExperienceDialog` (`app/dashboard/profile/_components/ExperienceManageDialogs.tsx`): states the role's evidence count and its project count; radio "Keep N projects as standalone" (default) / "Delete them too", with the project-owned evidence count shown on the delete option. The current text, which wrongly says linked projects are removed, is replaced.

### UI touch (minimal, so data is not hidden)

- Projects that own evidence show a read-only list of it in the existing project views (`ProjectsPanel` selection header area or `ProjectBlock` card), in place of the highlights list. Editing project evidence arrives with the Evidence tab (PR 5).
- `ProjectBlock` "Extract" still writes the legacy `highlights` column for now; note as a follow-up. (Changing it is PR 5 scope.)

### Tests

- `build.test.ts`: project evidence notes, `has` links, no duplicate edges on the role, derived links on project evidence, highlights fallback.
- `query.test.ts` / render tests: `contextOf`, role render includes project evidence once.
- `snapshot` test: `## Projects` text unchanged for the copy case.
- Migration copy logic: a pure TypeScript mirror is not enough; rehearse the SQL against a scratch database seeded with: valid 3-item array, `'[]'`, `''`, `'not json'`, `'{"a":1}'`, `'["ok", 3, "  "]'`, and a project that already has evidence. Record before/after counts in the PR.
- Ownership tests for each write path.

### Acceptance

- Production shape (12 projects, 3 with highlights, 14 items, all valid arrays) yields exactly 14 new evidence rows on those 3 projects, order kept, text identical; nothing else changes.
- Running the data step twice adds nothing.
- CV snapshot markdown for projects is unchanged for those 3 projects.
- Deleting a role offers keep/delete, defaults to keep, and the counts are right.
- `npm run typecheck`, `npm run lint`, `npm test` pass.

---

## PR 2: guided merge of duplicate projects (D15)

**Why:** three standalone projects are earlier copies of three role projects (brief 3.11).

- Module `src/modules/profile/project-merge.ts`: `findDuplicateProjects(profileId)` pairs a standalone project with a role project of the same profile when names match after normalisation or bodies share their first 300 characters; `mergeProjects(profileId, { keepId, removeId, body: 'keep' | 'remove' })` moves evidence and capability links to the kept project, copies `startDate`/`endDate`/`url`/`repoUrl` where the kept one is empty, sets the chosen body, deletes the other. One transaction; ownership checked.
- UI: a notice on the profile page when duplicates exist, opening a dialog per pair with both bodies side by side and a body choice. Nothing is merged without a click.
- Tests: pairing rules, evidence moved not copied, ownership, body choice.
- Acceptance: the three production pairs are found; after merging, each role project owns its evidence and the standalone copy is gone; identical-text pair needs no body choice.

## PR 3: shared document editor and revisions

**Why:** three save behaviours, no conflict protection (F2, F3).

- Extract the Writing Desk save machine from `app/dashboard/job-applications/view/[id]/writing/_components/writing-desk.tsx` (states, debounce, recovery copy, `online` retry, conflict, navigation guard via `components/job-workspace/navigation-guard.ts`) into `src/components/document-editor/use-document-save.ts` plus a `SaveStatus` component. Writing Desk switches to it first, with its existing tests unchanged.
- Migration: `revision Int @default(1)` on `Experience` and `Project` (D3).
- `updateExperienceNotes` / `updateProjectNotes` take `expectedRevision` and return `{ ok, revision } | { ok: false, reason: 'conflict', revision, content }`, mirroring `WritingDeskSaveResult`.
- Acceptance: brief section 5 save criteria (offline, reload recovery, two-tab conflict); Writing Desk behaviour unchanged.

## PR 4: workspace shell and note URLs

- Route `src/app/dashboard/profile/n/[id]/page.tsx` (read the Next.js 16 routing docs first); `/dashboard/profile` redirects to the Overview note; `/dashboard/profile/experience/[id]` redirects to `n/[id]`.
- Three regions (notes list, document, details placeholder), one scroll each; note list with Overview, Experience (projects nested), standalone Projects, Records links; real links, arrow-key navigation.
- Document uses the PR 3 editor in Geist Sans at a 65–75 character measure. Page H1 removed.
- Overview note: name, headline, summary body, contact as properties, gaps from `profileMap()` as questions linking to their notes.
- Acceptance: line length, one scroll per pane, reload/Back keep the note, keyboard navigation.

## PR 5: details panel (Properties, Evidence, Links)

- APG tabs. Properties replaces `ExperienceFrontmatter` inline fields and `EditExperienceDialog`; project properties include "Part of" (move between roles, evidence moves with it).
- Evidence tab: list, add/edit/delete with confirmation, and the extraction review from `experience/[id]/_components/ExtractionPanel.tsx`, now for experiences **and** projects (extraction reads the one project body). Retire `project-extract.ts` writes to `highlights`.
- Links tab: the note's capability links with `via`, and pending link suggestions for its evidence; the profile-wide queue moves to Overview.
- Acceptance: one editing surface per fact; extract from a project inside a role; accepted items show under the project and its role.

## PR 6: records and phone

- Capabilities list (kind filter, status chip with text, evidence count) and Credentials lists, reading server data after refresh (fixes F5); every delete confirms.
- Phone: one region at a time, details as a sheet, 44px targets.
- Acceptance: brief section 5 phone and keyboard criteria; stale-after-accept fixed.

---

## Verification for every PR

`npm run typecheck`, `npm run lint`, `npm test`; migrations rehearsed on a scratch local database (never production); browser check at 1440 and 390 for UI PRs. Follow `node_modules/next/dist/docs/` before app-code changes.
