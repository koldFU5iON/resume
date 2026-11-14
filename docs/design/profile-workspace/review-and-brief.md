# Profile workspace: review and design brief

**Date:** 2026-11-13 · **Status:** Discovery and proposal. No product or schema changes made.
**Route:** `/dashboard/profile` and `/dashboard/profile/experience/[id]`
**Companion sketch:** `layout-sketch.html` (static, illustrative content)

## Summary

The profile page already holds the right data and a good retrieval layer (the Profile Map vault). The page on top of it is still a three-column dashboard: the writing area is the smallest thing on screen, one role is edited on three surfaces with three different save behaviours, and none of the vault's linking shows up where you write.

The proposal is to make the profile a **note workspace**: a list of notes, one document open at a time, and a details panel for properties, evidence and links. You start by writing. Classification (experience, project, thought, essay, or left untyped) is a property you set or change later. Structured records (capabilities, education, certifications, languages) stay as compact lists and become link targets.

Recommended first phase: make project achievements real evidence items (a small migration), then rebuild the shell around the existing experience and project notes and share the Writing Desk save machinery. New note types follow immediately in phase 2, which needs one more migration.

## How this was checked

- **Source:** local checkout at `ac7b796` (branch `feat/early-assessment-primary`). It is **67 commits behind `origin/main`**. Profile code is the same on both except one line in `modules/profile/extract.ts`. Writing Desk was read from `origin/main`, because the local copy predates multiple documents (#370, #371).
- **Live:** local dev server, seeded test account, dark theme, 1440×900 and 390×844. Read-only: I opened the note editor and the activities tray and typed nothing.
- **Issues:** fetched fresh from GitHub on 2026-11-13.

- **Update, same day:** work now continues in a worktree cut from `origin/main` (`8c13488`), branch `feat/profile-workspace`. The profile schema and profile-map code there match what this review read. Section 3.11 was added after reading how project achievements are stored.

Gaps in verification are listed in section 7.

---

## 1. Related issues

| Issue | Status | What it asks | Today | Relevance to this brief |
|---|---|---|---|---|
| [#73](https://github.com/koldFU5iON/resume/issues/73) The Writing Desk | Open | A minimal document surface to write anything about yourself, then file it against an experience, a project or the profile | The name was used for job documents instead. The profile has no free capture | **This brief is the original #73.** Its triage questions (what content types, scratch pad or publishing surface) are answered in section 3 |
| [#76](https://github.com/koldFU5iON/resume/issues/76) AI Editor on experience entries | Open | Tidy a brain dump without losing detail | Not built. Extraction exists, editing help does not | Phase 4. Should reuse the Writing Desk draft review, so the tidy-up arrives as a proposal |
| [#281](https://github.com/koldFU5iON/resume/issues/281) Generate from profile (summary) | Open, no detail | "Doesn't seem to be working correctly" | Code path runs: it fills the text box and waits for Save (`ProfileSummaryCard.tsx`). Not reproduced; no AI call was made | Reproduce first. Two things to check: nothing marks the generated text as unsaved, and `maxOutputTokens: 300` (`generate-summary.ts:27`) can come back empty on reasoning models. Both are hypotheses |
| [#166](https://github.com/koldFU5iON/resume/issues/166) Page alignment and consistency | Open | Pages built in silos have drifted | The job side now has a shared shell (#365). The profile does not use it | Direct. Section 3 reuses the job workspace's header, save states and panel behaviour |
| [#273](https://github.com/koldFU5iON/resume/issues/273) Onboarding and progressive enrichment | Open | Import, analyse a real job, then enrich the profile with approval | Gaps are computed (`profile-map/map.ts:65`) but never shown in the profile UI | The Overview note and the suggestions inbox are where enrichment prompts land |
| [#365](https://github.com/koldFU5iON/resume/issues/365) Job workspace navigation | Open (phases 1–3 merged) | Persistent header, named documents, "+" to create | Shipped on `origin/main` (#374, #375, #376, #382) | The pattern to match. One difference: document type is fixed there, see decision D1 |
| [#372](https://github.com/koldFU5iON/resume/issues/372) Softer colour system | Open | Less stark black and white | Not started | Use current tokens. Do not pick colours here |
| [#381](https://github.com/koldFU5iON/resume/issues/381) Career Coach context | Open | What Coach knows per page, streaming lifecycle | Profile context sends a summary and the active experience id | Coach needs the open note's id and standing (section 3.7). Coordinate, don't duplicate |
| [#300](https://github.com/koldFU5iON/resume/issues/300) Can't add certifications manually | Open | Filed from the old CV Builder | Certifications can be added on the profile | Mostly a legacy editor problem; the Records view makes the right place obvious |
| [#26](https://github.com/koldFU5iON/resume/issues/26) Messy-input extraction | Closed May | Hard facts, raw notes, review, accepted data | Shipped for experience: notes, parser plus AI extraction, accept/replace/skip | Still the governing principle: "dump → split → sort → refine → reuse", useful with AI off |
| [#115](https://github.com/koldFU5iON/resume/issues/115) Can't edit experience on mobile | Closed June | — | Editable, but see finding F11: the editor is a 600px box below the fold with 68 of 71 targets under 44px | Not a regression, but not good |
| [#206](https://github.com/koldFU5iON/resume/issues/206) Projects not tied to experience | Closed June | Filter projects by the role in focus | Fixed: the panel filters by `experienceId` | Holds. Unlinked projects now live in a different component at the page bottom (F8) |
| [#149](https://github.com/koldFU5iON/resume/issues/149) Page doesn't re-render after AI change | Closed June | — | Server revalidates. Client sections copy props into state once and never resync (F5) | The same class of bug is still reachable by code reading. Not reproduced live |
| [#224](https://github.com/koldFU5iON/resume/issues/224) Export profile | Closed June | Markdown or JSON export | Works from the header | New note types need an export decision (D6) |
| #370, #371 | Closed | Multiple named documents, create and switch | Shipped | Reuse the save, recovery, conflict and navigation-guard code |

Shipped state of the Profile Map (spec `2026-11-11-profile-map-design.md`), confirmed in code:

- **Shipped:** vault loader and types (`modules/profile-map/`), six profile tools, capability merge into `Skill.kind`, derived exact-mention and `[[wikilink]]` links, stored link decisions (`RoleActivitySkill.status`), AI link suggestions and their review list.
- **Not shipped:** project body merge, provenance column, `RoleActivity.projectId`, dropping `tags`, and all of step 5 (the UI). The old `Tool` and `Competency` tables still exist, unread.
- **No note types exist for thought, essay or untyped notes.** `NoteType` has nine values, all backed by typed tables.

---

## 2. Findings

Priority: P0 damages trust or loses work, P1 is structural friction, P2 is polish. Paths are under `src/app/dashboard/profile/` unless stated.

### P0

**F1. The writing area is the smallest thing on the page.**
Live at 1440×900: the rendered note is **323px wide**. With the activities tray open the textarea is **355×160px**. Cause: a `256px | 1fr | 288px` grid (`page.tsx:58`), then a fixed 220px projects panel inside the centre column (`ProjectsPanel.tsx:182`) and a tray that takes its height from the editor. This contradicts PRODUCT.md principle 1 ("don't let chrome compete with content").

**F2. Three save behaviours for the same text, and none protects against overwrite.**
- Main page note: autosave after 1.5s (`NoteEditor.tsx:75`).
- Detail route, same field: manual Save button (`experience/[id]/_components/NotesEditor.tsx:43`).
- Summary: manual Save. Contact fields: save on blur.
- `updateExperienceNotes` (`modules/profile/actions.ts:145`) writes whatever it receives. Two tabs, the two routes, or a Coach edit: last write wins, silently.
- No leave-page guard, no local recovery copy, and a failure is the words "Save failed" at 10px with no retry.

Writing Desk already has the answer: dirty/saving/saved/failed/conflict states, a local recovery copy keyed to the revision, retry when back online, a conflict dialog, and a navigation guard (`writing-desk.tsx`, `navigation-guard.ts` on `origin/main`).

**F3. Inline fields can show a value that did not save.** *(code reading, not reproduced)*
`InlineField` displays its local draft after blur (`ExperienceFrontmatter.tsx:198`). `saveField` (`:75`) has no error handling. If the save fails, the new company or role stays on screen as if saved.

**F4. Deletes with no confirmation and no undo.**
- Project: a 16px icon that appears on hover, deletes at once (`ProjectsPanel.tsx:55`, `:118`).
- Activity (evidence): same, and a failed delete puts the row back without saying why (`ActivitiesTray.tsx:93`).
- Skills, tools, education and the rest: same pattern in `LeftRail.tsx`.
- Experience delete does confirm. It also removes all its evidence by cascade, which the dialog should say.

**F5. Sections go stale after changes made elsewhere.** *(code reading, not reproduced)*
Every section copies its props into state once: `LeftRail.tsx:153, 281, 387, 489, 586, 731`, `ProfileSummaryCard.tsx:18`, `ExperienceWorkspace.tsx:34–35`, `ActivitiesTray.tsx:26`. A server refresh does not reach them. Examples: "Add" on a suggested capability in Evidence links refreshes the route but the Skills list keeps its old copy; a Coach-applied summary change (`patchProfileField`) will not appear in the summary box. This is the #149 class of bug.

### P1

**F6. One role, three editing surfaces.**
Company and role edit inline. Dates and location need the menu → "Edit details" dialog. Extraction lives on a separate route reached by a 10px "✦ Extract" link inside the activities header (`ActivitiesTray.tsx:135`). That route repeats the details form and the notes, wider (the textarea there is 1153px, far past a readable line).

**F7. The open note has no address.**
Selection is component state (`ExperienceWorkspace.tsx:36`). Reload returns to the first role. Back does nothing. There is no link to "this role" for Coach, search or a gap prompt. Tabs read "Company · year" (`:226`), which is ambiguous for two roles at one company, and the live DOM has no `tablist`/`tab` roles and 12 `div role="button"` elements.

**F8. Projects are second-class and split in two.**
A project under a role is a name and a notes body. Its description, links and dates cannot be edited there. Projects with no role use a different component and a dialog form at the bottom of the page (`ProjectBlock.tsx`). The planned merge of `description` and `notes` into one body has not shipped.

**F9. The linking model is invisible where you write.**
- Capability rows show level and a years gauge, not proven/certified/claimed. That status is computed and used only for a counter.
- "Evidence links" sits in the rail, away from the note whose evidence it is about.
- No backlinks are shown anywhere.
- `[[wikilinks]]` are parsed by the vault, but the editor has no autocomplete and the preview uses plain `ReactMarkdown` (`NoteEditor.tsx:119`), so they should render as literal brackets. *(code reading)*

**F10. Gaps are computed and never shown; empty states don't explain themselves.**
`findGaps` produces good questions ("What did you achieve as…?") that only the AI sees. Live, the empty contact block is six icons each beside a warning triangle, with no text at all.

**F11. Mobile is a stack of the desktop columns.**
Live at 390×844: the note workspace starts at y≈709, below contact and summary. It is a fixed 600px box with its own scroll inside the page scroll. Records start at y≈1325. **68 of 71** targets are under 44px and **15 are under 24px**, the WCAG 2.2 AA minimum ([SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)). Projects open from a floating pill over the text.

**F12. Scroll inside scroll on desktop.**
Live: the page scrolls (1013 in 775), the right rail scrolls separately (1144 in 804), and the editor scrolls inside the centre column.

**F13. Visual drift from DESIGN.md.**
- Emerald, green and amber fills mark projects and the R/A counts. DESIGN.md allows one accent (cyan) and tinted status colours for meaning only.
- Live: 13 text nodes under 12px, down to 8px.
- Writing happens in monospace; reading happens in prose. Clicking the note swaps one for the other and the text jumps.
- Hover-only controls: 14 on the page. Keyboard users reach some of them through focus, touch users through a mobile override, but the rule is inconsistent between components.

### P2

**F14.** Breadcrumb, an H1 "Professional Profile" and the user's name all sit above the content before anything useful.
**F15.** `AlphaBanner` logs a hydration mismatch on every load (dev log). Not profile-specific.
**F16.** The component called `LeftRail` renders on the right. Section help is tooltip-only.

---

## 3. Proposed model

### 3.1 Principles

1. **Write first.** A new note is a title and an empty page. Nothing is required before the first sentence.
2. **Type is a property, not a container.** You can set it later and change it. The body never changes when the type does.
3. **Narratives are documents. Records are lists.** This is the existing "two families" decision; the UI finally follows it.
4. **Links are the structure.** No folders. A capability page is the list of evidence that proves it.
5. **Reflection is not evidence.** What you think and what you can prove are kept apart, visibly, for you and for the AI.
6. **Same hands as Writing Desk.** One editor behaviour, one set of save states, one way to review an AI proposal.

"Obsidian-like" here means document-first, calm, and connected. It does not mean a graph canvas. Nothing below needs one.

### 3.2 Layout

Desktop, three regions with one scroll each:

```
┌ Notes ────────┬ Document ───────────────────────────┬ Details ─────────┐
│ Search / New  │ Snr. PR Manager · Blizzard          │ Properties       │
│               │ [Experience ▾]  Nov 2016 – Mar 2025 │ Evidence (6)     │
│ Overview      │ Saved                               │ Links (4 · 2)    │
│ EXPERIENCE    │                                     │                  │
│ ▸ Blizzard    │ Strategic lead for Blizzard's       │ ● Budget Mgmt    │
│   ▸ EU launch │ European organisation across…       │   proven · 3     │
│ ▸ Unity       │ (65–75 characters per line)         │ Linked from      │
│ NOTES         │                                     │  EU launch       │
│ Why I left PR │                                     │                  │
│ RECORDS       │                                     │                  │
│ Capabilities  │                                     │                  │
│ Credentials   │                                     │                  │
└───────────────┴─────────────────────────────────────┴──────────────────┘
```

- **Notes (about 260px, collapsible).** Search field, "New note", then groups: Overview, Experience (by date, projects nested under their role), Projects with no role, Notes (untyped, thoughts, essays, newest first), Records. A small count beside a note shows suggestions waiting.
- **Document.** Title, a type chip, the two or three key facts for that type, and the save state. Body capped at a readable measure: [50–75 characters per line](https://baymard.com/blog/line-length-readability). Same font for writing and reading; Markdown/Preview toggle as on the Writing Desk.
- **Details (about 320px, collapsible).** Three tabs: Properties, Evidence, Links. Built as real tabs ([APG Tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/): `tablist`, arrow keys).
- **Each note has a URL** (`/dashboard/profile/n/<id>` or equivalent). Reload, Back, Coach and gap prompts all land on the same note.
- The page H1 goes. The note title is the heading.

Below about 1100px the Details panel becomes an overlay opened from the header, the same rule Coach uses in the job workspace.

**Phone.** One region at a time: note list → document → details as a bottom sheet. The document is the page (no fixed-height box). Type chip, save state and a "Details" button stay in a compact header. All targets at least 44px, never under 24px.

### 3.3 Note types and what happens when the type changes

| Type | For | Facts asked when you choose it | Standing (3.6) |
|---|---|---|---|
| Note (untyped) | Anything. The default | None | Reflection |
| Thought | A short reflection, an opinion, a lesson | None | Reflection |
| Essay | Long-form thinking, a brain dump | None | Reflection |
| Experience | A role you held | Company, role, start date | Source |
| Project | A piece of work, inside or outside a role | Name (taken from the title). Optional: parent role | Source |

Changing type, proposed rules:

| From → to | Behaviour |
|---|---|
| Note ↔ Thought ↔ Essay | Instant. Undo from the toast |
| Note, Thought or Essay → Experience | The Properties tab asks for company, role and start date, in place. The body is untouched and the note keeps its id, so links to it still work |
| Note, Thought or Essay → Project | Name defaults to the title. Parent role optional |
| Experience ↔ Project | Later phase. Blocked while the note owns evidence or child projects, with the reason shown |
| Experience or Project → Note, Thought or Essay | Later phase. Blocked while it owns accepted evidence, because that evidence would be orphaned (`RoleActivity` is deleted with its experience today) |

Writing Desk fixed its document type on 12 Nov because type there selects an output format (blocks, PDF layout). Here type is a classification of the same narrative, so changing it is cheap. See D1.

Under the accepted hybrid storage this needs **one new table** for the three reflection types (title, body, kind, revision, timestamps). Experience and Project keep their tables. "Change type to Experience" creates the Experience row with the same id and the same body, and removes the note row, in one transaction. The vault gains matching note types, so every consumer sees one shape. This is a recommendation for phase 2, not a schema design; see D2.

### 3.4 Properties

- Shown as a short key/value list in the Properties tab, the way Obsidian shows [properties](https://obsidian.md/help/properties) above a note. The header repeats only the two or three that identify the note.
- Each type has a fixed set. No free-form custom properties in the first phases (D5).
- One editing surface per fact. The inline fields, the "Edit details" dialog and the detail route form collapse into this tab.
- Every field saves the same way and shows the same states as the body.

### 3.5 Links, backlinks and search

- **Creating links.** Typing `[[` opens suggestions for capabilities first, then notes, as in [Obsidian](https://obsidian.md/help/links). Exact mentions keep linking on their own, as today.
- **Rendering.** A link shows as a quiet inline link in Preview. An unresolved link is dotted and offers "Create capability" or "Create note".
- **Links tab.** "Mentions" (capabilities and notes this note links to, with how: confirmed, exact, wikilink) and "Linked from" (backlinks). Unlinked mentions appear as suggestions to confirm, matching Obsidian's [linked and unlinked mentions](https://obsidian.md/help/plugins/backlinks).
- **Capability page.** Opening a capability shows its level and kind and, as the main content, the evidence and notes that back it. The status chip (proven, certified, claimed) appears on every capability row with a text label, never colour alone.
- **Search and quick open.** The existing ⌘K palette gains profile notes, backed by the vault's `searchVault`. If nothing matches, Enter creates a note with that title, the [quick switcher](https://obsidian.md/help/plugins/quick-switcher) behaviour.
- **Renames.** Note-to-note links should be stored by id so a rename cannot break them. Capability wikilinks match by name today; renaming a capability should offer to update the notes that mention it.

### 3.6 Evidence, and telling reflection from fact

Four standings, shown to the user and passed to the AI:

| Standing | What it is | CV and job-fit use |
|---|---|---|
| **Confirmed** | Accepted evidence atoms; records (capabilities, education, certifications, languages) | The only source of factual claims |
| **Source** | The body of an experience or project: your own account of real work | Context for wording. A claim taken from it should trace to confirmed evidence |
| **Reflection** | Notes, thoughts, essays | Never a source of facts. May inform tone and positioning for Coach or a cover letter, only when explicitly included, and labelled as reflection in the prompt |
| **Suggested** | Anything AI proposed that you have not reviewed | Never used |

How it would hold in code (for the implementation plan, not built here): a `standing` on each vault note; `selectNotes` and the snapshot adapter exclude reflection and suggested by default; renderers put reflections under a labelled heading when a caller opts in; the profile tools and MCP return the standing with every hit.

Evidence review moves into the note:

- The **Evidence tab** lists this note's atoms and has the Extract action. Suggestions appear in the same list with accept, replace and skip, as the current extraction panel does. The separate route becomes a redirect.
- **From a reflection**, extraction can propose evidence, but each accepted item must be filed under an experience or project. A thought cannot own evidence. The link back to the thought is kept as where it came from.
- Body edits never delete accepted evidence (existing rule).
- Link suggestions for the open note show in its Links tab. The profile-wide queue stays reachable from Overview as "Suggestions to review".

### 3.7 AI review and Coach

- **AI Editor (#76).** "Tidy this note" produces a draft beside the original, reviewed with the Writing Desk's draft review (compare, accept, discard). It never edits the body directly.
- **Summary (#281).** The summary becomes the body of the Overview note. "Generate" produces a draft to review, so nothing looks saved when it isn't.
- **Coach (#381).** Page context sends the open note's id, type and standing. Proposed edits arrive as drafts on that note.
- AI actions are plain labelled buttons. No sparkle-heavy treatment (PRODUCT.md: "never breathless about AI").

### 3.8 Saving and recovery

Adopt the Writing Desk machine as one shared piece and use it for every note body and property:

- States: dirty, saving, saved, failed, conflict. Always visible in the header at body-text size, with a Retry on failure.
- A local recovery copy tied to the revision, restored on return.
- A leave-page guard while unsaved; pending text is still sent on Back.
- Conflict dialog ("keep mine" or "use the saved version") instead of silent overwrite. This needs a revision check on experience and project bodies (D3).
- Every delete confirms and says what goes with it ("This also removes 6 evidence items").
- Lists read from server data after a refresh; no component keeps a private copy that can go stale (F5).

### 3.9 Keyboard and accessibility

- ⌘K: open or create a note. A "New note" command in the palette; a single-key shortcut is a later choice.
- Note list: arrow keys move, Enter opens. Details tabs follow the APG pattern.
- No `div role="button"`; use real buttons and links ([SC 2.1.1](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html)).
- Row actions are visible on focus and on touch, not hover-only.
- Minimum text 12px. Status never by colour alone.

### 3.10 Visual direction

Shared with the job workspace, using today's tokens:

- Header and note navigation stay fixed; only the document scrolls.
- One accent (cyan) for selection and focus. Type chips are neutral outline chips with a text label. Status tints only for proven/certified/claimed and save failure.
- Geist Sans for writing and reading. Mono only inside code.
- Borders and spacing do the grouping; no cards inside cards.
- Colour changes wait for #372.

### 3.11 Relations between notes, and project achievements

**What exists today** (schema and code on `origin/main`; production figures follow below):

| Relation | Stored as | Seen by the vault |
|---|---|---|
| Project → experience (parent) | `Project.experienceId`, optional, cleared if the role is deleted | Yes: `contains` link, experience → project |
| Achievement → experience | `RoleActivity.experienceId`, **required** | Yes: an evidence note with its own id |
| Achievement → capability | `RoleActivitySkill` decisions, plus derived mentions | Yes: `demonstrates` |
| **Achievement → project** | **Not a relation.** `Project.highlights` is a text column holding a JSON list of strings | Only as text on the project note |
| Project → capability | `ProjectSkill` table exists and is read, but nothing writes it. Extracted skills go into `Project.tags`, also a JSON string | Only through mentions in the body |

**What that means for the achievements you extracted from projects:**

- They are plain strings. They have no id, no measurable-impact field and no kind.
- They are not scanned for capability mentions (`build.ts` scans the project body only), so they can never make a capability "proven", and "Suggest links" never sees them.
- They do reach CV prompts, as bullet text under the project (`snapshot.ts:279`).
- Extraction reads `Project.description`. The role workspace edits `Project.notes`. A project written inside a role therefore has no way to be extracted at all; the Extract button exists only in the standalone-project dialog.
- Nothing ties a project highlight to the parent role's evidence, so the same win can exist twice in different words.

**Proposed rework**

1. **Project achievements become evidence items owned by the project.** This is the already-decided `RoleActivity.projectId` change, moved forward from phase 5. Each existing highlight becomes one achievement item with the project as its owner. The `highlights` column stays until the copy is checked, then goes.
2. **Evidence has exactly one owner: a role or a project.** `experienceId` becomes optional and a check enforces one of the two. A project's evidence also counts for its parent role in views and in AI selection, without being copied.
3. **One extraction, one review.** The Evidence tab's extract and accept/replace/skip flow runs on any experience or project body. The separate `project-extract` path retires.
4. **Project skills become links.** Extracted skills are matched to capabilities (or offered as new ones) instead of being stored as tag text.
5. **One project body.** Merge `description` and `notes`, as already decided, so extraction and editing read the same text.

**Production check (2026-11-13, read-only).** Counts and shapes only; nothing was written.

- One profile has projects: 12 in total. Four other profiles have none.
- They fall into two groups that never overlap:

| | Count | Body lives in | Highlights | Tags | Dates |
|---|---|---|---|---|---|
| Under a role | 9 | `notes` (39 to 15,740 characters) | none | none | none |
| Standalone | 3 | `description` (1,085 to 8,358 characters) | 14 in total (5, 5, 4) | 42 in total | start date set |

- **The three standalone projects are earlier copies of three role projects.** They were created 2–4 June and extracted on 4 June (three `project-extract` calls, none since). The role versions were created 12–18 June, after the workspace redesign.
  - "Made With Unity Database" ↔ "MWU Database": identical text.
  - "MWU Review Program" ↔ "MWU Review": close but not identical (8,358 vs 8,239 characters).
  - "Unity Awards 2025" ↔ "17th Unity Awards": close but not identical (7,427 vs 7,332 characters).
- **All 14 highlights are well formed**: one sentence each, 117 to 195 characters, valid JSON, with the metric inside the sentence rather than in a separate impact field. None duplicates an existing role achievement.
- **Six role projects have never been extracted**, about 27,800 characters of narrative with no evidence behind it. The largest are "Enemies Demo Campaign" (15,740) and "NBA 2k17 - Italy Cover" (5,528).
- **Role evidence does not reference projects.** Of 70 role evidence items, one mentions a project by name.
- **Tags:** 5 of 42 match an existing capability name. The other 37 are new names.
- `ProjectSkill`, `ExperienceSkill` and `CertificationSkill` are empty. `RoleActivitySkill` holds 148 confirmed links.

**What this changes in the copy plan**

1. The copy is small enough to review by eye: 14 items, 3 projects, 1 profile. No bulk heuristics are needed.
2. Each highlight becomes one achievement item, text unchanged, impact left empty, order kept.
3. **Merge the three pairs instead of keeping both.** The evidence should end up on the role version, which is the one being maintained, and the standalone copy is then removed. For the two pairs whose text differs, show both bodies side by side and let the user choose before anything is deleted. This is a one-off, user-confirmed step, not part of the automatic migration: the migration only copies highlights to evidence on the project that holds them today.
4. Carry the standalone copies' start dates over to the role versions during the merge.
5. Tags: link the 5 that match. Offer the other 37 as suggested capabilities to review; do not create them automatically.
6. After the merge, the six unextracted projects are the first real use of extraction on a project inside a role.

**Relations between notes, generally.** Two kinds, kept distinct:

| Kind | Meaning | Cardinality | Stored | Shown |
|---|---|---|---|---|
| **Part of** | Structural parent. A project is part of a role | At most one parent | Typed column (`Project.experienceId` today) | Nesting in the note list; a "Part of" property; the parent lists its parts |
| **Related** | Any note is connected to any other. A thought is about a role; an essay draws on two projects | Many to many | A small link table keyed by note ids, so renames cannot break it | Links tab on both ends (outgoing and "Linked from") |

- A related link is created by typing `[[` and choosing a note, or from "Add related note" in the Links tab.
- Reflections (note, thought, essay) can also take a "Part of" parent, so a note written about a role can sit under it in the list without becoming evidence.
- Moving a project to another role, or out of any role, is a change to "Part of" in Properties. Its evidence moves with it.
- Deleting a role asks what to do with its projects: keep them as standalone (today's silent behaviour) or delete them too.

---

## 4. Existing records in the new model

| Today | Becomes | Edited in |
|---|---|---|
| Name, headline, contact, summary | **Overview** note, pinned first. Summary is its body; contact details are properties, still kept out of prompts | Document and Properties |
| Experience and its notes | Experience note | Document; facts in Properties |
| Responsibilities and achievements | Evidence items in the note's Evidence tab. Not separate entries in the note list | Evidence tab |
| Projects under a role | Project notes nested under the role ("Part of") | Document |
| Project highlights (extracted achievements) | Evidence items owned by the project (3.11) | Evidence tab |
| Project tags (extracted skills) | Links to capabilities (3.11) | Links tab |
| Projects with no role | Project notes in their own group, same editor | Document |
| Skills, tools, competencies | **Capabilities**: one list, filtered by kind, each row with status and evidence count; each opens a page of backlinks | Records list, compact form |
| Education, certifications, languages | **Credentials**: compact lists | Records list, compact form |
| Completeness and gaps | Shown on Overview as questions, each linking to the note it is about | — |
| Search Context (preferences) | Stays where it is for now, linked from Overview. The November review proposes moving it later | — |
| Career Vertical | A lens over the profile, not profile data. Unchanged | — |
| *(new)* Note, thought, essay | Reflection notes | Document |

---

## 5. Phases

### Phase 1 (recommended first): the note workspace over what exists

Small schema change: evidence can belong to a project (3.11), plus the revision column if D3 is accepted.

Scope:

0. Evidence ownership: `RoleActivity` gains `projectId`; existing project highlights are copied into evidence items; the vault and snapshot read project evidence from there. Ship this as its own PR first, since everything in the Evidence tab depends on it.
1. Three-region layout from 3.2 for experiences and projects (nested and standalone), with a URL per note.
2. One shared editor and save module taken from the Writing Desk; used by profile notes and by Writing Desk.
3. Properties tab replaces inline fields, the "Edit details" dialog and the detail-route form.
4. Evidence tab hosts the list, manual add/edit and the existing extraction review. `/dashboard/profile/experience/[id]` redirects to the note.
5. Links tab shows the note's capability links and its pending link suggestions (read and review only; no autocomplete yet).
6. Overview note: name, headline, summary, contact, plus gaps as questions.
7. Records: Capabilities with kind filter, status chip and evidence count; Credentials. Existing compact forms kept.
8. Confirmed deletes; lists read from server data; phone layout.

Not in phase 1: new note types, type change, `[[` autocomplete, note-to-note links, AI Editor, colour changes.

Acceptance:

- At 1440×900 the body shows 65–75 characters per line, and opening Evidence does not shrink the editor's height.
- One scroll region per pane; none on phone other than the page.
- Reloading or pressing Back returns to the same note.
- Kill the network mid-edit: the state reads "Couldn't save", the text stays, and it saves when the connection returns. Close the tab before saving and reopen: the edits are restored.
- Edit the same note in two tabs: the second save opens a conflict choice; nothing is lost silently.
- Every delete asks first and names what else is removed.
- Accept a suggested capability: it appears in Capabilities without a reload. A Coach-applied summary change appears on Overview without a reload.
- Phone (390×844): open a role, write, add an evidence item and accept a suggestion without horizontal scroll; all targets at least 44px.
- Keyboard only: open a note, edit, move across the Details tabs, accept a suggestion.
- Every existing project highlight appears once as an evidence item under its project, in the same order; none is lost and none is duplicated. Generated CV input for a profile with project highlights contains the same achievement text before and after.
- A project inside a role can be extracted from, and its accepted items show under both the project and the role.
- Moving a project to another role moves its evidence; the note keeps its URL.
- Works with no AI key; AI actions are disabled with a reason, not hidden.
- Writing Desk behaves as before (its tests pass against the shared module).

Dependencies:

- Work in the `feat/profile-workspace` worktree (`/home/devon/dev/worktrees/resume/profile-workspace`), cut from `origin/main`. It still needs `npm install`, an `.env.local` and its own local database before it can run.
- The highlights copy touches 14 items on 3 projects in production (3.11). Rehearse it on a copy and compare the 14 texts before dropping the old column.
- Sharing the editor touches Writing Desk code merged in the last two days (#375–#386). Do the extraction as its own small PR first.
- Uses current colour tokens; #372 can restyle later.

### Phase 2: capture first

"New note", the three reflection types, type change to Experience or Project, "Part of" for reflections, standing in the vault and in AI selection. One migration (new table). Acceptance in brief: create a note with nothing but a title; write; change it to Experience by giving three facts; the body is unchanged and its id still resolves; a thought never appears in a generated CV or in Jev state; export includes or excludes reflections per D6.

### Phase 3: connected

`[[` autocomplete, "Related" links between any two notes (link table), backlinks with unlinked mentions, capability pages, profile notes in ⌘K with create-on-Enter.

### Phase 4: AI help

AI Editor as a reviewed draft (#76), summary generation as a draft (#281), extraction from reflections filed under a role, Coach context for notes (#381).

### Phase 5: finish the reshape

Already-decided items that are still open: project body merge, provenance column, drop `tags` and the old `Tool`/`Competency` tables. Then the remaining type changes (Experience ↔ Project, and back to a reflection).

---

## 6. Decisions needed

| | Decision | Recommendation |
|---|---|---|
| D1 | Can a profile note change type, given Writing Desk types are fixed? | Yes, with the rules in 3.3. Different meaning of "type" |
| D2 | Storage for note, thought and essay | One new table; Experience and Project stay typed; type change keeps the id |
| D3 | Conflict check for experience and project bodies in phase 1 | Add a `revision` column to both (small migration) rather than comparing timestamps |
| D4 | Ship phase 1 and 2 together or apart | Apart as PRs, close together in time. Phase 1 alone fixes trust and layout; phase 2 delivers the capture idea you described |
| D5 | Custom properties and tags | Not yet. Fixed properties per type until a real need appears |
| D6 | Do reflections appear in profile export and through MCP? | Export: yes, under a labelled section. MCP: only when the caller asks for them |
| D7 | Is "Thought" vs "Essay" worth two types, or one "Reflection" with length as the only difference? | Keep both labels as you asked; they behave identically, so merging later is free |
| D8 | Does Search Context move into the profile now? | No. Link it from Overview; revisit after phase 2 |
| D9 | What exactly is wrong in #281? | Needs your reproduction steps or a screen recording |
| D11 | Bring project evidence (`RoleActivity.projectId` and the highlights copy) into phase 1? | Yes. Without it the Evidence tab cannot show what you already extracted from projects |
| D12 | Does a project's evidence count for its parent role? | Yes, shown under both, stored once on the project |
| D13 | When a role is deleted, what happens to its projects? | **Agreed 2026-11-13:** ask each time; default to keeping them as standalone |
| D15 | Merge the three duplicate project pairs found in production? | **Agreed 2026-11-13:** yes, as a guided one-off after the evidence copy, choosing the body per pair |
| D14 | Can a thought or essay be "Part of" a role? | Yes, for filing only. It stays a reflection and owns no evidence |
| D10 | Wording: "Professional Profile" in the sidebar vs a workspace name | Keep the sidebar label; drop the page H1 |

---

## 7. What was not verified

- Screenshots: one desktop capture succeeded. Later captures timed out, so phone and edit-state observations come from DOM measurements, not images.
- Light theme was not checked.
- No live keyboard walk-through; roles and focusability were read from the DOM and source.
- No AI calls were made. #281, the stale-after-Coach case (F5) and wikilink rendering (F9) are from code reading.
- Save failure, offline and two-tab overwrite were not forced live (F2, F3).
- Production project data was read once, read-only, for counts and shapes (3.11). The copy itself has not been rehearsed on a copy of that data.
- The test account has two roles and six skills. Long lists, many roles and long titles were not observed.
- Writing Desk was read from `origin/main` source, not run.
- No formal Impeccable critique was run for this surface; this review follows PRODUCT.md and DESIGN.md directly.

## Sources

- Obsidian Help: [Properties](https://obsidian.md/help/properties), [Internal links](https://obsidian.md/help/links), [Backlinks](https://obsidian.md/help/plugins/backlinks), [Quick switcher](https://obsidian.md/help/plugins/quick-switcher), [Bases](https://obsidian.md/help/bases)
- W3C: [WCAG 2.2 SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [SC 2.1.1 Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html), [ARIA APG Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
- Baymard Institute: [Line length for readability](https://baymard.com/blog/line-length-readability)
- In repo: `PRODUCT.md`, `DESIGN.md`, `docs/superpowers/specs/2026-11-11-profile-map-design.md`, `docs/superpowers/specs/2026-11-11-profile-review-and-profile-map.md`, `docs/design/job-workspace/plan.md`
