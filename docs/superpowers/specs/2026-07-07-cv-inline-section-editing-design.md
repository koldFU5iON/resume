# CV Inline Section Add & Reorder — Design Spec
_Date: 2026-07-07_

## Overview

Fixes issue #302: users cannot add a new CV section, and the LLM coach has no way to
propose one either. Investigation found the manual "+ Add section" control already
exists, but only inside the right-rail `SectionRail` — not where users expect it, which
is inline in the CV document itself, alongside drag-to-reorder (deferred as Phase 2 in
the original [CV builder spec](./2026-06-03-cv-builder-design.md#phase-2-entry-points-stubs-in-phase-1)).
This spec relocates section-adding into the document and adds real drag-and-drop
reordering, plus a matching `propose_cv_section_create` tool for the LLM coach.

---

## Goals

- Add a new custom section at a specific position directly in the CV document — no side panel
- Reorder sections via drag-and-drop, inline in the document
- Give the LLM coach a tool to propose a new section, mirroring `propose_tool_create`
- Remove the now-redundant "+ Add section" control from `SectionRail`, keep its section list + ATS widget

## Non-Goals

- Adding structured section types (another Experience/Education/Certification entry) inline — custom (heading + text/list) only, matching today's capability
- Position-aware inserts from the LLM coach — it always appends; only the manual UI is insert-at-position
- Any change to CV generation, export, or ATS scoring

---

## Data Model & Server Actions

No schema migration — `CVDocumentContent.sections` (`src/modules/cv/schema.ts`) is already
an ordered array; reordering and inserting are array operations only.

Changes to `src/modules/cv/actions.ts`:

- **`addCustomSection(cvId, heading, subtype, insertIndex?)`** — add an optional
  `insertIndex`. When provided, clamp to `[0, sections.length]` and `splice(insertIndex, 0, newSection)`.
  Omitted (default) keeps today's append behavior, so the LLM coach's call site is unaffected.
- **`reorderSections(cvId, orderedSectionIds: string[])`** (new) — validates
  `orderedSectionIds` is exactly a permutation of the current section ids (same length,
  every id found); throws `Section list out of sync` otherwise. Rebuilds `content.sections`
  in the given order, writes back, `revalidatePath`. Follows the same
  find-by-id-then-mutate shape as `updateSection`/`toggleVisibility`.

---

## Components & UI

### Drag handle (reorder)

- Add `@dnd-kit/core` + `@dnd-kit/sortable` (no existing DnD library in the repo).
- `cv-editor.tsx`: wrap the `content.sections.map(...)` block list in `DndContext` +
  `SortableContext` (`items` = section ids, `strategy=verticalListSortingStrategy`).
- `cv-block.tsx`: add a `GripVertical` handle to the existing hover control bar
  (next to Edit/Copy/Hide, `cv-block.tsx:50-72`), wired to `useSortable`'s `attributes`/`listeners`
  — spread only onto the handle button, not the whole block, so text selection inside a
  section is unaffected.
- `onDragEnd`: reorder local `content.sections` state optimistically, call
  `reorderSections(cvId, newOrderIds)`; on rejection, revert local state and toast an error.

### Insert control (add)

- New `SectionGap` component renders between every adjacent pair of visible `CvBlock`s
  (and before the first / after the last, including in the empty-document state).
- Default: a thin, barely-visible strip. On hover: reveals a centered "+ Add section" affordance.
- Click: expands in place into the heading/subtype form currently in `SectionRail`
  (moved, not duplicated) — calls `handleAddCustomSection(heading, subtype, insertIndex)`
  with the gap's index.
- Empty-document state (`cv-editor.tsx:316-322`, currently "No content yet / Click
  Regenerate") gains a single `SectionGap` too, so a user can start a CV from a blank
  custom section without regenerating.

### Side rail

- `section-rail.tsx`: remove the "+ Add section" button/form (lines ~94-136) and the
  `onAddCustomSection` prop from its interface. Section list (with visibility toggles)
  and the ATS widget are unchanged.

---

## LLM Coach Tool

New tool in `src/modules/chat/tools.ts`, mirroring `propose_tool_create`:

```ts
propose_cv_section_create: tool({
  description:
    "Propose adding a new custom section to a CV document. Use when the CV is " +
    "missing a section the user wants (e.g. a section that doesn't map to an " +
    "existing type). The user must confirm before it is applied.",
  inputSchema: zodSchema(z.object({
    cvId: z.string(),
    heading: z.string().describe('The heading for the new section'),
    subtype: z.enum(['text', 'list']),
    rationale: z.string().describe('Why this section should be added'),
  })),
}),
```

No `execute` — same client-confirms pattern as the other `propose_*` tools.

- **`chat-message.tsx`** `buildWriteAction`: new branch calling
  `addCustomSection(args.cvId, args.heading, args.subtype)` (no `insertIndex` — the
  coach always appends since it has no spatial context for "between which two sections").
- **`tool-confirmation-card.tsx`**: add `propose_cv_section_create: 'Add CV section'` to
  `TOOL_LABELS`; extend the existing generic "proposed value" fallback (currently checks
  `args.name`/`args.category` for `propose_tool_create`) to also handle
  `args.heading`/`args.subtype`.
- **`context.ts:136`**: append a sentence noting the coach can use
  `propose_cv_section_create` when the CV is missing a section the user wants, not just
  patch existing ones.

---

## Error Handling & Edge Cases

- `reorderSections` rejects any non-permutation of current ids (stale client, e.g. two
  tabs open) — client reverts the optimistic reorder and toasts an error prompting a refresh.
- `reorderSections`/network failure — rollback-and-toast, matching the existing pattern
  in `handleAddCustomSection`.
- `addCustomSection` insert-index out of current bounds (e.g. a section was deleted by
  another session between render and click) — clamped, not thrown; an insert is additive
  so a slightly-off position is harmless, unlike reorder which must be exact.
- Coach proposing a section that conceptually already exists — out of scope; same trust
  model as other `propose_*` tools (rationale shown, user accepts/declines).

---

## What This Does Not Cover

- Structured section types via inline add (Experience/Education/Certification instances) — future work
- LLM coach position-aware section insertion
- Mobile drag-and-drop touch ergonomics beyond what `@dnd-kit`'s pointer sensor provides by default
- Any redesign of `SectionRail`'s ATS widget or visibility-toggle list
