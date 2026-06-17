# CV Builder Enhancements — Design Spec

**Date:** 2026-06-17
**Issues:** #257 (bug), #258 (enhancement), #259 (enhancement)
**Branch:** `feat/cv-builder-enhancements`
**Scope:** Single PR covering ATS score sync, editable location field, and custom sections

---

## Overview

Three related CV builder issues filed from the same page on the same day. All changes are confined to the CV builder module. The custom section schema change is zero-risk — sections live in the `CVTemplate.content` JSON column, not a typed DB column, so no migration is needed.

---

## Issue #257 — ATS Score Sync (Bug)

### Problem

`ATSScorePanel` owns its own `result: ATSScoreResult | null` and `isPending` state. The `SectionRail` has a disabled stub widget that cannot show or trigger the score because it has no access to this state.

### Design

**State lift into `CvEditor`:**
- `CvEditor` gains `atsResult: ATSScoreResult | null` and `atsRunning: boolean`
- A `handleRunATS()` handler in `CvEditor` calls `runATSScore(cvId)` and updates both fields
- `atsPanelOpen` state already exists in `CvEditor` — used as-is for `onOpenATS`

**`ATSScorePanel` becomes controlled:**
- Remove internal `result`, `isPending`, `startTransition` state
- Accept props: `result: ATSScoreResult | null`, `isPending: boolean`, `onRun: () => void`, `cvId`, `cvTitle`, `cvCompany`, `hasJobDescription`
- All rendering logic stays unchanged — just reads from props instead of local state

**`SectionRail` compact widget goes live:**
New props added to `SectionRail`: `atsResult: ATSScoreResult | null`, `atsRunning: boolean`, `onRunATS: () => void`, `onOpenATS: () => void`

Widget behaviour:
- No result + not running → "Run analysis →" button calls `onRunATS`
- Running → spinner replaces button
- Result present → score number + label + progress bar rendered; clicking the card calls `onOpenATS` to open the full drawer

The dashed "coming soon" border is removed; the widget becomes a live card.

### Files
- `src/app/dashboard/cv-builder/[id]/_components/cv-editor.tsx`
- `src/app/dashboard/cv-builder/[id]/_components/ats-score-panel.tsx`
- `src/app/dashboard/cv-builder/[id]/_components/section-rail.tsx`

---

## Issue #258 — Editable Location/Availability Line in Header

### Problem

`HeaderDataSchema` has no location field. Users targeting specific roles need to surface location keywords ("Based in Dublin · Willing to relocate · Available immediately") near the top of the CV where ATS parsers weight them most.

### Design

**Schema:**
Add `location: z.string().nullish()` as a top-level field on `HeaderDataSchema` (not nested in `contact` — it is display text, not contact metadata).

**Read mode render order:**
```
Name
Headline
Sub-headline (optional)
Location / availability line (optional)     ← new
email · phone · linkedin · website
```
Location renders as its own line using the same `cv-contact` CSS class as the contact row.

**Edit mode:**
Full-width "Location / Availability" text input added to `HeaderBlock` edit grid below the sub-headline input. Placeholder: `"Based in Dublin · Willing to relocate · EU citizen"`.

**Exports:**
- `toMarkdown` and `toText` in `export.ts` include the location line between sub-headline and contact
- `cv-pdf-document.tsx` renders the location line in the same position

### Files
- `src/modules/cv/schema.ts`
- `src/app/dashboard/cv-builder/[id]/_components/blocks/header-block.tsx`
- `src/modules/cv/export.ts`
- `src/app/components/cv-pdf-document.tsx`

---

## Issue #259 — Custom Sections

### Problem

`CVSectionSchema` is a closed discriminated union of 10 fixed types. There is no way to add user-defined sections (e.g. Tools & Software, Publications, Volunteering, Awards) and no UI to create them.

### Design

**Schema addition:**
```ts
CustomDataSchema = z.object({
  heading: z.string(),
  subtype: z.enum(['text', 'list']),
  content: z.string().nullish(),       // populated when subtype === 'text'
  items: z.array(z.string()).nullish(), // populated when subtype === 'list'
})
```
Added as a new variant in `CVSectionSchema` discriminated union: `type: 'custom'`.

**Two render modes in `CustomBlock`:**
- `text` — renders `content` via `MarkdownProse`; edit mode is a full-width textarea. Suited to Publications, Volunteering, Personal statement, Awards prose.
- `list` — renders `items` as a tag/chip list matching the Skills/Tools block pattern; edit mode follows the same add/remove item UX. Suited to Tools & Software, Awards list, References.

**Creation flow:**
`SectionRail` gets a small "+ Add section" button at the bottom of the sections list. Clicking it opens a minimal inline form within the rail: a text input for the section heading and a two-option toggle for type (Text / List). Submitting calls `addCustomSection(cvId, heading, subtype)`.

**`addCustomSection` server action:**
- Validates heading is non-empty
- Reads current CV content, appends a new custom section with `{ heading, subtype, content: '', items: [] }`
- Saves updated content to DB
- Returns the new `CVSection` (with server-assigned `id`) so `CvEditor` appends it to local state on success — not pre-emptively, since the ID is needed

**Wiring:**
- `renderBlock` switch in `cv-editor.tsx` gets a `custom` case → `<CustomBlock />`
- `getSectionLabel` in `section-rail.tsx` returns `section.data.heading` for custom sections
- `SECTION_LABELS` gets `custom: 'Custom'` as a display fallback
- `toMarkdown` and `toText` in `export.ts` handle the custom type (heading as `## Heading`, then content or `• item` list)
- `cv-pdf-document.tsx` renders custom sections

### Files
- `src/modules/cv/schema.ts`
- `src/modules/cv/actions.ts`
- `src/app/dashboard/cv-builder/[id]/_components/cv-editor.tsx`
- `src/app/dashboard/cv-builder/[id]/_components/section-rail.tsx`
- `src/app/dashboard/cv-builder/[id]/_components/blocks/custom-block.tsx` ← new
- `src/modules/cv/export.ts`
- `src/app/components/cv-pdf-document.tsx`

---

## Out of scope

- AI-generated content for custom sections (the LLM pipeline does not need to know about custom sections for this PR)
- Reordering custom sections (drag-and-drop is a separate feature)
- Deleting sections (the existing visibility toggle serves this need for now)
