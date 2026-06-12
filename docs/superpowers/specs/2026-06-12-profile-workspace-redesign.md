# Profile Workspace Redesign

**Date:** 2026-06-12  
**Status:** Approved — ready for implementation planning  
**Branch:** `feat/profile-workspace-redesign`

---

## Overview

Redesign the Professional Profile page from a 2-column read/navigate layout into a 3-column inline editing workspace. The key change: experience notes and project notes are edited directly on the profile page rather than navigating to a separate `/experience/[id]` page. The result is an Obsidian-style writing surface where structured metadata ("frontmatter") sits above a full markdown body, and the AI coach is fed rich profile context from the start.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | 3-column grid | Left = identity, Centre = work history editor, Right = skills/credentials |
| Centre component | Single `ExperienceWorkspace` client component | Left/right columns are independent of centre state |
| Note editing | Click-to-edit (click → textarea, blur → ReactMarkdown) | More natural than explicit toggle buttons; matches Obsidian feel |
| Activities | Collapsible tray at base of editor | Notes dominate; activities stay for CV generation without cluttering the surface |
| Projects | Children of an experience, shared editing surface | Projects panel on the right edge of the centre column context-switches the editor |
| Promotions | Flat tabs per role; CV generator handles merging | Matches LinkedIn import format; no data model change needed |
| Coach context | Global panel unchanged; profile passes upfront summary | Reduces tool calls for baseline context; existing retrieval handles deep dives |
| CV import | Populate `Experience.summary` with narrative draft on import | Prevents blank editor after import |

---

## Layout

### Three-column grid

```
┌──────────────┬──────────────────────────────────────┬──────────────┐
│  LEFT (w-64) │       CENTRE (flex-1)                │  RIGHT (w-72)│
│  sticky      │       ExperienceWorkspace            │  sticky      │
│              │                                      │              │
│  Contact     │  [Tab bar]                           │  Skills      │
│  Profile     │  [Frontmatter strip]                 │  Tools       │
│  Summary     │  ┌─────────────────────┬──────────┐  │  Languages   │
│              │  │  Note editor        │ Projects │  │  Competencies│
│              │  │  (shared surface)   │ panel    │  │  Education   │
│              │  │                     │ (110px)  │  │  Certs       │
│              │  └─────────────────────┴──────────┘  │              │
│              │  [Activities tray ▾]                 │              │
└──────────────┴──────────────────────────────────────┴──────────────┘
```

All three columns are `sticky top-6 max-h-[calc(100vh-6rem)] overflow-y-auto` — IDE-style independent scroll. Same sticky pattern the current left sidebar already uses.

### Responsive

- **≥1280px (xl):** Full 3-column layout as above
- **768–1279px (md–lg):** Centre column full width; left/right columns stack above and below (same as current mobile behaviour)
- **<768px:** Single column stack

Mobile responsive redesign is explicitly **out of scope** for this spec.

---

## Component Architecture

### Server/client boundary

`page.tsx` remains a server component. It loads `getFullProfile()` and `getLLMConfigStatus()` as today and passes the full data down.

```
page.tsx (server)
├── ProfileHeader (existing, unchanged)
└── div.three-column-grid
    ├── LeftColumn            — Contact + ProfileSummaryCard (existing, no changes)
    ├── ExperienceWorkspace   — NEW 'use client', owns centre + projects panel
    └── RightRail             — existing LeftRail moved to right slot, internals unchanged
```

### ExperienceWorkspace state

```typescript
type ActiveContext =
  | { type: 'experience' }
  | { type: 'project'; projectId: string }

// Component state
const [selectedExperienceId, setSelectedExperienceId] = useState(
  experiences[0]?.id ?? ''
)
const [activeContext, setActiveContext] = useState<ActiveContext>(
  { type: 'experience' }
)
```

Switching tabs sets `selectedExperienceId` and resets `activeContext` to `{ type: 'experience' }`. The note editor receives `key={selectedExperienceId + activeContext.type + (activeContext.type === 'project' ? activeContext.projectId : '')}` so React fully remounts it on every context switch — no stale content.

---

## Centre Column: Five Parts

### ① Tab bar

- One tab per experience, sorted by `startDate` descending (newest first)
- Tab label: `{company} · {startYear}`
- Active tab: white background + 2px indigo bottom border (`border-b-2 border-primary`)
- Inactive tabs: muted foreground, hover state
- "+ Add Experience" at the trailing end — opens the existing `ExperienceDialog` (no changes needed)
- No grouping of promotions in the tab bar. Same-company consecutive roles appear as separate tabs. The visual relationship is implied by the shared company name.

### ② Frontmatter strip

Compact metadata row below the tab bar. Two modes:

**Experience mode:** Company · Role · Period · Location/Remote  
Each field renders as a `<span>` with a dashed underline on hover (`border-b border-dashed border-muted-foreground/40`). Click → swaps to an inline `<input>`. Blur → saves via `updateExperience(id, { field: value })`. No dialog.

**Project mode:** Breadcrumb row  
`← {company}` (link back to experience note) › `{projectName}` (badge: `Project`)  
Clicking the back link sets `activeContext` back to `{ type: 'experience' }`.

### ③ Note editor (shared editing surface)

One component used for both experience notes and project notes. Receives `content`, `onSave`, and `placeholder` as props.

**Read mode** (default):  
`<div onClick={() => setIsEditing(true)}>` renders `<ReactMarkdown remarkPlugins={[remarkGfm]}>`. Clicking anywhere activates edit mode. Empty state shows a `placeholder` prompt ("Start writing about this role…").

**Edit mode** (on click):  
Full-height `<textarea>`, monospace font (`font-mono`), `autoFocus`, `resize-none`. Blur → back to read mode. Autosaves on 1500ms debounce — same pattern as `CoverLetterWorkspace`.

**Save targets:**
- Experience note → `updateExperience(experienceId, { summary: content })`
- Project note → `updateProject(projectId, { notes: content })`

Save state indicator (Saving… / Saved / Error) displayed in the frontmatter strip trailing area.

### ④ Activities tray

Pinned to the bottom of the note editor area. Collapsed by default.

**Collapsed state:** Shows badge counts — `3 Resp · 2 Achv`. Click ▾ to expand. "✦ Extract" shortcut visible alongside — clicking it opens the existing AI extraction flow. For now this can link to the `/experience/[id]` page until the extraction panel is folded in as a future enhancement.

**Expanded state:** Inline list of responsibilities and achievements. Add/edit/delete activities without a dialog (inline forms, same actions as today). Collapsible back with ▴.

**Project mode:** Activities tray is replaced with a leaner "Highlights" tray showing the project's highlights array. Same collapsed/expanded behaviour.

### ⑤ Projects panel

Narrow column (`w-[110px]`) on the right edge of the centre column, separated by a `border-l`. Always visible while any experience is selected.

- Lists projects where `project.experienceId === selectedExperienceId`, sorted by `startDate`
- Selected project: highlighted border + coloured background
- Click project → sets `activeContext` to `{ type: 'project', projectId: project.id }`
- "+" button → inline new-project form (name field only; rest is written in the note body)
- Switching experience tab clears project selection automatically (handled by `activeContext` reset)

---

## Schema Changes

Two additions required. Both need a migration.

### 1. `Project.experienceId` — link projects to an experience

```prisma
model Project {
  // ... existing fields ...
  experienceId String?   // NEW — optional so existing projects remain valid
  experience   Experience? @relation(fields: [experienceId], references: [id], onDelete: SetNull)
}

model Experience {
  // ... existing fields ...
  projects  Project[]   // NEW — back-relation
}
```

Existing projects (`experienceId = null`) remain valid — they won't appear in any experience's projects panel but won't break anything. The `ProjectBlock` component on the profile page can continue to show profile-level projects (those without an `experienceId`) as a separate section below the 3-column workspace, or we phase it out in a follow-up.

### 2. `Project.notes` — markdown content field

```prisma
model Project {
  // ... existing fields ...
  notes String @default("")   // NEW — markdown content, replaces blank editor
}
```

The existing `description` field stays as a short summary (used in `ProjectBlock` and CV generation). `notes` is the full narrative writing surface.

---

## Coach Context

`ExperienceWorkspace` calls `useWorkspaceContext` with:

```typescript
useWorkspaceContext({
  type: 'profile',
  profileSummary: buildProfileSummary(profile),
  activeExperienceId: selectedExperienceId,
  activeExperienceName: `${activeExp.role} at ${activeExp.company}`,
})
```

`buildProfileSummary(profile)` is a small utility that produces a compact string (a few hundred tokens):

```
{name} · {headline} · {careerYears} years experience
Skills: {top 6 skills by yearsOfExperience}
Experience: {role} @ {company} ({startYear}–{endYear|present}), ...
Education: {qualification}, {institution}
```

This upfront payload means the coach starts the conversation with baseline context. The existing tool-based retrieval handles any deeper lookups the coach needs — no new tooling required.

---

## CV Import Enhancement

When the profile importer runs (`src/modules/profile-import/commit.ts`), after creating each `Experience` record it should also populate `Experience.summary` with a short narrative generated from the imported activities and any description text. This prevents the note editor from opening blank after an import.

The narrative can be a simple template-driven string (no LLM call needed at import time):

```
{role} at {company} from {startDate} to {endDate|present}.

## Responsibilities
{responsibility bullets}

## Achievements  
{achievement bullets}
```

A blank `summary` after import is a UX failure — the user lands on an empty editor with no starting point.

---

## Routes & Existing Code

### `/dashboard/profile/page.tsx`
Refactored: 2-column layout replaced with 3-column grid. `ExperienceWorkspace` replaces `ExperienceBlock`. Left and right column components are largely carried forward.

### `/dashboard/profile/experience/[id]`
**Kept as-is.** Deep links continue to work. `ExperienceDetailsForm` + `NotesEditor` + `ExtractionPanel` remain on this page. The activities tray's "✦ Extract" shortcut links here until extraction is folded into the workspace in a future enhancement.

### `ExperienceBlock` (`_components/Experience.tsx`)
Replaced by `ExperienceWorkspace`. The `ExperienceDialog` (add experience form) is reused directly.

### `LeftRail` (`_components/LeftRail.tsx`)
Moved to the right column. Component internals unchanged. Renamed to `RightRail` for clarity.

### `ProjectBlock` (`_components/ProjectBlock.tsx`)
Profile-level projects (those without `experienceId`) can remain rendered below the 3-column workspace by the existing `ProjectBlock`. This is a graceful degradation path while projects are migrated to be experience-linked.

---

## Out of Scope

- Mobile responsive layout
- Folding `ExtractionPanel` into the activities tray (kept on `/experience/[id]` for now)
- Right rail (`LeftRail`) internals — no changes to skills/education/certs edit flows
- CV generation changes for promotion chain merging (separate feature)
- Any changes to the CV builder or cover letter pages

---

## Open Questions (resolved during implementation)

1. Verify `getFullProfile()` returns `projects` with the new `experienceId` field after migration
2. Confirm `updateExperience` server action accepts partial updates (it likely does — check `actions.ts`)
3. Add `updateProject(id, { notes })` server action if it doesn't exist
4. Check whether `useWorkspaceContext` type system needs a new `'profile'` variant — existing usages are `'cover_letter'`. If the hook is typed, extend the union; if it accepts any object, no change needed.
5. Activities tray expanded state: current `ActivityManageDialog` is a `<Dialog>`. Confirm the inline form approach (no dialog, forms render inline in the tray) is a full replacement and doesn't leave orphaned dialog code.
