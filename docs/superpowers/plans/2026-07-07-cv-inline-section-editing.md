# CV Inline Section Add & Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add a new custom CV section and drag-reorder sections directly inline in the CV document, and give the LLM coach a matching tool to propose creating a section — fixing issue #302.

**Architecture:** No schema changes — `CVDocumentContent.sections` is already an ordered JSON array, so add/reorder are pure array operations exposed via two `src/modules/cv/actions.ts` functions. The UI relocates section-adding out of the side rail into a new `SectionGap` component rendered between blocks in the document, and adds `@dnd-kit`-powered drag-and-drop directly on the existing per-block hover control bar. The LLM coach gets a new `propose_cv_section_create` tool mirroring the existing `propose_tool_create` pattern.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Vitest, `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` (new dependencies, peer-compatible with React 19).

## Global Constraints

- TypeScript strict throughout — every task must pass `npm run typecheck` with zero errors
- Lint clean — `npm run lint` must pass
- Tests via Vitest (`npm run test`) — this repo has **no component/React-render test infrastructure** (0 `.test.tsx` files exist); only `src/modules/**/*.test.ts` logic tests exist. Do not introduce component tests that don't match this convention — verify UI changes via typecheck + manual browser check instead
- Server actions live in `src/modules/cv/actions.ts` and follow the existing shape: `requireProfile()` → scoped `prisma.cVDocument.findFirst({ where: { id, profileId } })` → mutate → `prisma.cVDocument.update` → `revalidatePath`
- Business logic stays in `src/modules/`; components in `src/app/dashboard/cv-builder/[id]/_components/` stay thin
- Follow existing Tailwind hover-reveal pattern already used in this file tree: `group` on a parent + `opacity-0 group-hover:opacity-100` on the revealed child

---

## Task 1: `addCustomSection` insert-at-index + new `reorderSections` action

**Files:**
- Modify: `src/modules/cv/actions.ts:157-189` (the existing `addCustomSection` function)
- Modify: `src/modules/cv/actions.ts` (add new `reorderSections` function after `addCustomSection`)
- Test: `src/modules/cv/actions.test.ts` (new file)

**Interfaces:**
- Produces: `addCustomSection(cvId: string, heading: string, subtype: 'text' | 'list', insertIndex?: number): Promise<CVSection>` — when `insertIndex` is omitted, behavior is unchanged (append). When provided, clamped to `[0, sections.length]` and spliced in at that position.
- Produces: `reorderSections(cvId: string, orderedSectionIds: string[]): Promise<void>` — throws `Error('Section list out of sync')` if `orderedSectionIds` isn't exactly a permutation of the CV's current section ids. Throws `Error('CV not found')` if the CV doesn't exist/isn't owned by the caller (matches existing actions in this file).

- [ ] **Step 1: Write the failing tests**

Create `src/modules/cv/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  requireProfile: vi.fn().mockResolvedValue({ profile: { id: 'profile-1' } }),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    cVDocument: { findFirst: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { addCustomSection, reorderSections } from './actions'
import { prisma } from '@/lib/db'
import type { CVDocumentContent } from './schema'

const mockFindFirst = vi.mocked(prisma.cVDocument.findFirst)
const mockUpdate = vi.mocked(prisma.cVDocument.update)

function contentWith(sections: CVDocumentContent['sections']): string {
  return JSON.stringify({ version: 1, sections })
}

function savedContent(): CVDocumentContent {
  const call = mockUpdate.mock.calls[0][0]
  return JSON.parse((call.data as { generatedContent: string }).generatedContent)
}

const header = { id: 's1', type: 'header' as const, visible: true, data: { name: 'A', headline: 'B', contact: {} } }
const skills = { id: 's2', type: 'skills' as const, visible: true, data: { items: [] } }
const tools = { id: 's3', type: 'tools' as const, visible: true, data: { items: [] } }

describe('addCustomSection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('appends to the end when no insertIndex is given', async () => {
    mockFindFirst.mockResolvedValue({ id: 'cv-1', generatedContent: contentWith([header]) } as never)
    mockUpdate.mockResolvedValue({} as never)

    await addCustomSection('cv-1', 'Awards', 'list')

    const saved = savedContent()
    expect(saved.sections).toHaveLength(2)
    expect(saved.sections[1].type).toBe('custom')
    expect((saved.sections[1] as { data: { heading: string } }).data.heading).toBe('Awards')
  })

  it('inserts at the given index', async () => {
    mockFindFirst.mockResolvedValue({ id: 'cv-1', generatedContent: contentWith([header, skills]) } as never)
    mockUpdate.mockResolvedValue({} as never)

    await addCustomSection('cv-1', 'Awards', 'text', 1)

    const saved = savedContent()
    expect(saved.sections.map(s => s.id)).toEqual(['s1', saved.sections[1].id, 's2'])
    expect(saved.sections[1].type).toBe('custom')
  })

  it('clamps an out-of-range insertIndex to the end', async () => {
    mockFindFirst.mockResolvedValue({ id: 'cv-1', generatedContent: contentWith([header]) } as never)
    mockUpdate.mockResolvedValue({} as never)

    await addCustomSection('cv-1', 'Awards', 'text', 99)

    const saved = savedContent()
    expect(saved.sections).toHaveLength(2)
    expect(saved.sections[0].id).toBe('s1')
  })

  it('clamps a negative insertIndex to the start', async () => {
    mockFindFirst.mockResolvedValue({ id: 'cv-1', generatedContent: contentWith([header]) } as never)
    mockUpdate.mockResolvedValue({} as never)

    await addCustomSection('cv-1', 'Awards', 'text', -5)

    const saved = savedContent()
    expect(saved.sections[0].type).toBe('custom')
    expect(saved.sections[1].id).toBe('s1')
  })
})

describe('reorderSections', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reorders sections to match the given id order', async () => {
    mockFindFirst.mockResolvedValue({ id: 'cv-1', generatedContent: contentWith([header, skills, tools]) } as never)
    mockUpdate.mockResolvedValue({} as never)

    await reorderSections('cv-1', ['s3', 's1', 's2'])

    const saved = savedContent()
    expect(saved.sections.map(s => s.id)).toEqual(['s3', 's1', 's2'])
  })

  it('throws when the id list is not a permutation of current sections', async () => {
    mockFindFirst.mockResolvedValue({ id: 'cv-1', generatedContent: contentWith([header, skills]) } as never)

    await expect(reorderSections('cv-1', ['s1'])).rejects.toThrow('Section list out of sync')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('throws when the id list contains an unknown id', async () => {
    mockFindFirst.mockResolvedValue({ id: 'cv-1', generatedContent: contentWith([header, skills]) } as never)

    await expect(reorderSections('cv-1', ['s1', 'unknown'])).rejects.toThrow('Section list out of sync')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('throws when the CV is not found', async () => {
    mockFindFirst.mockResolvedValue(null)
    await expect(reorderSections('cv-missing', [])).rejects.toThrow('CV not found')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/modules/cv/actions.test.ts`
Expected: FAIL — `addCustomSection` ignores the 4th argument (insert tests fail on ordering), and `reorderSections` is not exported (import error).

- [ ] **Step 3: Implement `addCustomSection` insert-at-index**

In `src/modules/cv/actions.ts`, replace the existing `addCustomSection` function (lines 157-189) with:

```ts
export async function addCustomSection(
  cvId: string,
  heading: string,
  subtype: 'text' | 'list',
  insertIndex?: number,
): Promise<CVSection> {
  const { profile } = await requireProfile()
  const doc = await prisma.cVDocument.findFirst({
    where: { id: cvId, profileId: profile.id },
    select: { id: true, generatedContent: true },
  })
  if (!doc) throw new Error('CV not found')

  const content = parseCVContent(doc.generatedContent)
  const newSection: CVSection = {
    id: crypto.randomUUID(),
    type: 'custom',
    visible: true,
    data: {
      heading,
      subtype,
      content: subtype === 'text' ? '' : null,
      items: subtype === 'list' ? [] : null,
    },
  }
  const idx = Math.max(0, Math.min(insertIndex ?? content.sections.length, content.sections.length))
  content.sections.splice(idx, 0, newSection)

  await prisma.cVDocument.update({
    where: { id: cvId },
    data: { generatedContent: JSON.stringify(content) },
  })
  revalidatePath(`/dashboard/cv-builder/${cvId}`)
  return newSection
}
```

- [ ] **Step 4: Implement `reorderSections`**

Add this new function to `src/modules/cv/actions.ts`, directly after `addCustomSection`:

```ts
export async function reorderSections(cvId: string, orderedSectionIds: string[]): Promise<void> {
  const { profile } = await requireProfile()
  const doc = await prisma.cVDocument.findFirst({
    where: { id: cvId, profileId: profile.id },
    select: { id: true, generatedContent: true },
  })
  if (!doc) throw new Error('CV not found')

  const content = parseCVContent(doc.generatedContent)
  const byId = new Map(content.sections.map(s => [s.id, s]))
  const isPermutation =
    orderedSectionIds.length === content.sections.length &&
    orderedSectionIds.every(id => byId.has(id))
  if (!isPermutation) throw new Error('Section list out of sync')

  content.sections = orderedSectionIds.map(id => byId.get(id)!)

  await prisma.cVDocument.update({
    where: { id: cvId },
    data: { generatedContent: JSON.stringify(content) },
  })
  revalidatePath(`/dashboard/cv-builder/${cvId}`)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- src/modules/cv/actions.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/modules/cv/actions.ts src/modules/cv/actions.test.ts
git commit -m "feat(cv): support inserting a custom section at a position and reordering sections"
```

---

## Task 2: LLM coach `propose_cv_section_create` tool, end-to-end

**Files:**
- Modify: `src/modules/chat/tools.ts` (add tool definition, ~line 342, right before `propose_cv_update`)
- Modify: `src/components/shell/chat-message.tsx` (import `addCustomSection`, add `buildWriteAction` branch)
- Modify: `src/components/shell/tool-confirmation-card.tsx` (label + proposed-value display)
- Modify: `src/modules/chat/context.ts` (CV page-context prompt text)
- Modify: `src/modules/chat/context.test.ts` (new test)

**Interfaces:**
- Consumes: `addCustomSection(cvId, heading, subtype, insertIndex?)` from Task 1 (called with no `insertIndex` — the coach always appends)
- Produces: a new tool name `propose_cv_section_create` recognized by `buildWriteAction` and `ToolConfirmationCard`

- [ ] **Step 1: Write the failing test**

In `src/modules/chat/context.test.ts`, add this test inside the existing `describe('buildSystemPrompt', ...)` block, after `'includes cv page context'`:

```ts
  it('mentions propose_cv_section_create for cv page context regardless of ATS score', async () => {
    const result = await buildSystemPrompt('profile-1', {
      type: 'cv',
      cvId: 'cv-1',
      title: 'Stripe Application',
      company: 'Stripe',
    })
    expect(result).toContain('propose_cv_section_create')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/modules/chat/context.test.ts`
Expected: FAIL — current `cv` case text never mentions `propose_cv_section_create`.

- [ ] **Step 3: Add the tool definition**

In `src/modules/chat/tools.ts`, insert this new tool immediately before the `propose_cv_update` tool (before line 343):

```ts
    propose_cv_section_create: tool({
      description:
        "Propose adding a new custom section to a CV document. Use when the CV is " +
        "missing a section the user wants (e.g. a section that doesn't map to an " +
        "existing type). The user must confirm before it is applied.",
      inputSchema: zodSchema(
        z.object({
          cvId: z.string(),
          heading: z.string().describe('The heading for the new section'),
          subtype: z.enum(['text', 'list']),
          rationale: z.string().describe('Why this section should be added'),
        }),
      ),
    }),

```

- [ ] **Step 4: Wire it in `chat-message.tsx`**

Change the import line:
```ts
import { patchCVSectionData } from '@/modules/cv/actions'
```
to:
```ts
import { patchCVSectionData, addCustomSection } from '@/modules/cv/actions'
```

Then add this branch in `buildWriteAction`, directly after the `propose_cv_update` branch:

```ts
  if (toolName === 'propose_cv_section_create') {
    return async () => {
      await addCustomSection(args.cvId as string, args.heading as string, args.subtype as 'text' | 'list')
    }
  }
```

- [ ] **Step 5: Add the confirmation card label and display**

In `src/components/shell/tool-confirmation-card.tsx`, add to `TOOL_LABELS` (after the `propose_cv_update` entry):

```ts
  propose_cv_section_create: 'Add CV section',
```

Then extend the generic "proposed value" fallback (the `display` const inside the IIFE, currently reading `args.name`/`args.category`):

```ts
        const display = args.proposedValue ?? args.proposedContent ??
          (args.name != null ? `${args.name}${args.category ? ` · ${args.category}` : ''}` : undefined) ??
          (args.heading != null ? `${args.heading} (${args.subtype ?? 'text'})` : undefined)
```

- [ ] **Step 6: Update the CV page-context prompt**

In `src/modules/chat/context.ts`, replace the `case 'cv':` block inside `formatPageContext`:

```ts
    case 'cv': {
      const text =
        `User is reviewing CV: "${ctx.title}"${ctx.company ? ` (for ${ctx.company})` : ''}\n` +
        `CV ID: ${ctx.cvId} — use this with get_cv_document to fetch full content\n` +
        `Use propose_cv_update to edit an existing section, or propose_cv_section_create if ` +
        `the CV is missing a section entirely.`
      if (ctx.atsScore) {
        return text +
          `\n\n<ats_score>\n${ctx.atsScore}\n</ats_score>\n` +
          `The user has run an ATS check on this CV. Reference the breakdown above when advising ` +
          `on CV improvements. Only recommend adding content that exists in the user's profile — ` +
          `do not suggest fabricating skills or experience the candidate does not have.`
      }
      return text
    }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test -- src/modules/chat/context.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 8: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add src/modules/chat/tools.ts src/components/shell/chat-message.tsx src/components/shell/tool-confirmation-card.tsx src/modules/chat/context.ts src/modules/chat/context.test.ts
git commit -m "feat(chat): let the LLM coach propose creating a new CV section"
```

---

## Task 3: Remove the side-rail "+ Add section" control

**Files:**
- Modify: `src/app/dashboard/cv-builder/[id]/_components/section-rail.tsx` (remove add-section state/JSX/prop)
- Modify: `src/app/dashboard/cv-builder/[id]/_components/cv-editor.tsx:427` (stop passing `onAddCustomSection` to `SectionRail`)

**Interfaces:**
- Produces: `SectionRail` props no longer include `onAddCustomSection`
- Consumes: nothing new (this task only removes)

- [ ] **Step 1: Rewrite `section-rail.tsx`**

Replace the full contents of `src/app/dashboard/cv-builder/[id]/_components/section-rail.tsx` with:

```tsx
'use client'

import { Eye, EyeOff, Loader2 } from 'lucide-react'
import type { CVSection } from '@/modules/cv/schema'
import type { ATSScoreResult } from '@/modules/cv/ats-score-schema'

const SECTION_LABELS: Record<CVSection['type'], string> = {
  header: 'Header',
  profile: 'Profile',
  competencies: 'Competencies',
  capabilities: 'Capabilities',
  experience: 'Experience',
  education: 'Education',
  certification: 'Certifications',
  skills: 'Skills',
  tools: 'Tools',
  languages: 'Languages',
  custom: 'Custom',
}

const LABEL_COLORS: Record<string, string> = {
  excellent: 'text-emerald-600',
  strong:    'text-green-600',
  good:      'text-amber-600',
  fair:      'text-orange-500',
  poor:      'text-red-500',
}

function getSectionLabel(section: CVSection): string {
  if (section.type === 'experience') return section.data.company || 'Experience'
  if (section.type === 'education') return section.data.institution || 'Education'
  if (section.type === 'certification') return section.data.name || 'Certification'
  if (section.type === 'custom') return section.data.heading || 'Custom'
  return SECTION_LABELS[section.type] ?? section.type
}

type Props = {
  sections: CVSection[]
  onToggleVisibility: (id: string) => void
  atsResult: ATSScoreResult | null
  atsRunning: boolean
  onRunATS: () => void
  onOpenATS: () => void
  hasJobDescription: boolean
}

export function SectionRail({ sections, onToggleVisibility, atsResult, atsRunning, onRunATS, onOpenATS, hasJobDescription }: Props) {
  return (
    <div className="hidden md:block w-48 shrink-0 overflow-y-auto border-l border-border bg-muted/20 p-4 print:hidden">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Sections
      </p>
      <div className="flex flex-col gap-1">
        {sections.map(section => (
          <div
            key={section.id}
            className="group flex items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-muted"
          >
            <span className={section.visible ? 'text-foreground' : 'text-muted-foreground line-through'}>
              {getSectionLabel(section)}
            </span>
            <button
              onClick={() => onToggleVisibility(section.id)}
              className="opacity-0 transition-opacity group-hover:opacity-100"
              title={section.visible ? 'Hide' : 'Show'}
            >
              {section.visible
                ? <EyeOff className="size-3 text-muted-foreground" />
                : <Eye className="size-3 text-muted-foreground" />
              }
            </button>
          </div>
        ))}
      </div>

      {/* ATS compact widget */}
      <div className="mt-6 rounded-md border border-border p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">ATS Score</p>
        {atsResult ? (
          <button onClick={onOpenATS} className="w-full text-left">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-bold tabular-nums">{atsResult.breakdown.finalScore}</span>
              <span className={`text-xs font-medium capitalize ${LABEL_COLORS[atsResult.breakdown.label] ?? ''}`}>
                {atsResult.breakdown.label}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-foreground/70 transition-all"
                style={{ width: `${atsResult.breakdown.finalScore}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">View full report →</p>
          </button>
        ) : (
          <button
            type="button"
            onClick={onRunATS}
            disabled={atsRunning || !hasJobDescription}
            title={!hasJobDescription ? 'Attach a job description to enable ATS scoring' : undefined}
            className="flex w-full items-center justify-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {atsRunning
              ? <><Loader2 className="size-3 animate-spin" />Checking…</>
              : 'Run analysis →'}
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Remove the prop pass-through in `cv-editor.tsx`**

In `src/app/dashboard/cv-builder/[id]/_components/cv-editor.tsx`, find the `<SectionRail ... />` call (around line 420) and delete the `onAddCustomSection={handleAddCustomSection}` line from it. Leave `handleAddCustomSection` itself defined — Task 4 wires it into the new inline control.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors (would fail with an excess-property error if the prop removal in Step 1 and Step 2 are mismatched)

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/cv-builder/\[id\]/_components/section-rail.tsx src/app/dashboard/cv-builder/\[id\]/_components/cv-editor.tsx
git commit -m "refactor(cv): remove redundant add-section control from the side rail"
```

---

## Task 4: Inline "+ Add section" control (`SectionGap`)

**Files:**
- Create: `src/app/dashboard/cv-builder/[id]/_components/section-gap.tsx`
- Modify: `src/app/dashboard/cv-builder/[id]/_components/cv-editor.tsx` (`handleAddCustomSection` signature, render loop, empty state)

**Interfaces:**
- Consumes: `addCustomSection(cvId, heading, subtype, insertIndex?)` from Task 1
- Produces: `SectionGap({ onAdd: (heading: string, subtype: 'text' | 'list') => Promise<void> })` — a hoverable insert affordance
- Produces: `handleAddCustomSection(heading: string, subtype: 'text' | 'list', insertIndex?: number): Promise<void>` (extends the existing function's signature — callers that omit `insertIndex` keep today's append behavior)

- [ ] **Step 1: Create `SectionGap`**

Create `src/app/dashboard/cv-builder/[id]/_components/section-gap.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'

type Props = {
  onAdd: (heading: string, subtype: 'text' | 'list') => Promise<void>
}

export function SectionGap({ onAdd }: Props) {
  const [open, setOpen] = useState(false)
  const [heading, setHeading] = useState('')
  const [subtype, setSubtype] = useState<'text' | 'list'>('text')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    if (!heading.trim()) return
    setSubmitting(true)
    try {
      await onAdd(heading.trim(), subtype)
      setHeading('')
      setSubtype('text')
      setOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  if (open) {
    return (
      <div className="mx-[30px] my-2 flex flex-col gap-1.5 rounded-md border border-border bg-background p-2 print:hidden">
        <input
          autoFocus
          value={heading}
          onChange={e => setHeading(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') setOpen(false) }}
          placeholder="Section name"
          className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex gap-1">
          {(['text', 'list'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setSubtype(t)}
              className={`flex-1 rounded px-2 py-0.5 text-xs capitalize transition-colors ${subtype === t ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={handleSubmit} disabled={submitting} className="flex-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            Add
          </button>
          <button type="button" onClick={() => setOpen(false)} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
            <X className="size-3" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="group/gap relative h-2 print:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute inset-x-[30px] -top-2.5 flex h-5 items-center justify-center gap-1 rounded text-[10px] text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover/gap:opacity-100"
      >
        <Plus className="size-3" />
        Add section
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Update `handleAddCustomSection` in `cv-editor.tsx`**

Replace the existing function (around line 137):

```ts
  async function handleAddCustomSection(heading: string, subtype: 'text' | 'list', insertIndex?: number) {
    try {
      const newSection = await addCustomSection(cv.id, heading, subtype, insertIndex)
      setContent(c => {
        const idx = Math.max(0, Math.min(insertIndex ?? c.sections.length, c.sections.length))
        const sections = [...c.sections]
        sections.splice(idx, 0, newSection)
        return { ...c, sections }
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add section')
    }
  }
```

- [ ] **Step 3: Add the `Fragment` and `SectionGap` imports**

At the top of `cv-editor.tsx`, change:
```ts
import { useState, useTransition, useEffect } from 'react'
```
to:
```ts
import { useState, useTransition, useEffect, Fragment } from 'react'
```

Add, alongside the other local component imports (near `import { SectionRail } from './section-rail'`):
```ts
import { SectionGap } from './section-gap'
```

- [ ] **Step 4: Interleave `SectionGap` into the render loop**

Replace the section-list JSX block (lines ~316-338):

```tsx
              {content.sections.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <p className="text-sm font-medium text-muted-foreground">No content yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Click Regenerate to generate your CV.
                  </p>
                </div>
              ) : (
                content.sections.map((section, index) => {
                  const prevVisible = content.sections.slice(0, index).filter(s => s.visible).at(-1)
                  const showHeading = prevVisible?.type !== section.type
                  return (
                    <CvBlock
                      key={section.id}
                      section={section}
                      onToggleVisibility={() => handleToggleVisibility(section.id)}
                      onCopy={() => handleCopySection(section)}
                    >
                      {renderBlock(section, handleUpdateSection, showHeading)}
                    </CvBlock>
                  )
                })
              )}
```

with:

```tsx
              {content.sections.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <p className="text-sm font-medium text-muted-foreground">No content yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Click Regenerate to generate your CV, or add a section below.
                  </p>
                  <div className="mt-4 w-full">
                    <SectionGap onAdd={(heading, subtype) => handleAddCustomSection(heading, subtype, 0)} />
                  </div>
                </div>
              ) : (
                <>
                  <SectionGap onAdd={(heading, subtype) => handleAddCustomSection(heading, subtype, 0)} />
                  {content.sections.map((section, index) => {
                    const prevVisible = content.sections.slice(0, index).filter(s => s.visible).at(-1)
                    const showHeading = prevVisible?.type !== section.type
                    return (
                      <Fragment key={section.id}>
                        <CvBlock
                          section={section}
                          onToggleVisibility={() => handleToggleVisibility(section.id)}
                          onCopy={() => handleCopySection(section)}
                        >
                          {renderBlock(section, handleUpdateSection, showHeading)}
                        </CvBlock>
                        <SectionGap onAdd={(heading, subtype) => handleAddCustomSection(heading, subtype, index + 1)} />
                      </Fragment>
                    )
                  })}
                </>
              )}
```

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/cv-builder/\[id\]/_components/section-gap.tsx src/app/dashboard/cv-builder/\[id\]/_components/cv-editor.tsx
git commit -m "feat(cv): add inline, position-aware 'add section' control in the document"
```

---

## Task 5: Drag-and-drop reordering (`@dnd-kit`)

**Files:**
- Modify: `package.json` (add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`)
- Modify: `src/app/dashboard/cv-builder/[id]/_components/cv-block.tsx` (drag handle + `useSortable`)
- Modify: `src/app/dashboard/cv-builder/[id]/_components/cv-editor.tsx` (`DndContext`/`SortableContext`, `handleDragEnd`)

**Interfaces:**
- Consumes: `reorderSections(cvId, orderedSectionIds)` from Task 1
- Consumes: `CvBlock`'s existing props are unchanged externally — `useSortable` is wired internally using `section.id`, no new prop needed

- [ ] **Step 1: Install dependencies**

Run: `npm install @dnd-kit/core@^6.3.1 @dnd-kit/sortable@^10.0.0 @dnd-kit/utilities@^3.2.2`
Expected: `package.json`/`package-lock.json` updated, install succeeds with no peer-dependency errors (both packages declare `react: '>=16.8.0'`, compatible with this repo's React 19.2.4)

- [ ] **Step 2: Add the drag handle to `CvBlock`**

Replace the full contents of `src/app/dashboard/cv-builder/[id]/_components/cv-block.tsx` with:

```tsx
'use client'

import { createContext, useContext, useState } from 'react'
import { Eye, EyeOff, Copy, Pencil, GripVertical } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import type { CVSection } from '@/modules/cv/schema'

// Blocks consume this to respond when the Edit button in the control bar is clicked.
// Each CvBlock provides its own value, so only the hovered block's child enters edit mode.
export const BlockEditTrigger = createContext<number>(0)

export function useBlockEditTrigger() {
  return useContext(BlockEditTrigger)
}

type Props = {
  section: CVSection
  onToggleVisibility: () => void
  onCopy: () => void
  children: React.ReactNode
}

export function CvBlock({ section, onToggleVisibility, onCopy, children }: Props) {
  const [editTrigger, setEditTrigger] = useState(0)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  if (!section.visible) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="group flex items-center justify-between border-b border-border/30 px-[30px] py-2.5 opacity-40 last:border-b-0 print:hidden"
      >
        <span className="text-xs italic text-muted-foreground capitalize">
          {section.type} — hidden
        </span>
        <button
          onClick={onToggleVisibility}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
        >
          <Eye className="size-3" />
          Show
        </button>
      </div>
    )
  }

  return (
    <BlockEditTrigger.Provider value={editTrigger}>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          'cv-document-block group relative border-b border-border/30 px-[30px] last:border-b-0 hover:bg-muted/20 print:hover:bg-transparent',
          section.type === 'certification' ? 'py-1.5' : 'py-3',
          isDragging && 'z-20 bg-background shadow-md',
        )}
      >
        {/* Controls — Drag / Edit / Copy / Hide, shown together on hover (always visible on mobile) */}
        <div className="absolute right-3 top-2.5 flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 print:hidden">
          <button
            {...attributes}
            {...listeners}
            className="flex items-center rounded p-1.5 text-muted-foreground hover:bg-muted cursor-grab active:cursor-grabbing touch-none"
            title="Drag to reorder"
          >
            <GripVertical className="size-3" />
          </button>
          <button
            onClick={() => setEditTrigger(t => t + 1)}
            className="flex items-center rounded p-1.5 text-muted-foreground hover:bg-muted"
            title="Edit section"
          >
            <Pencil className="size-3" />
          </button>
          <button
            onClick={onCopy}
            className="flex items-center rounded p-1.5 text-muted-foreground hover:bg-muted"
            title="Copy section"
          >
            <Copy className="size-3" />
          </button>
          <button
            onClick={onToggleVisibility}
            className="flex items-center rounded p-1.5 text-muted-foreground hover:bg-muted"
            title="Hide section"
          >
            <EyeOff className="size-3" />
          </button>
        </div>

        {children}
      </div>
    </BlockEditTrigger.Provider>
  )
}
```

- [ ] **Step 3: Wire `DndContext`/`SortableContext` into `cv-editor.tsx`**

Add these imports:
```ts
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
```

Update the actions import to include `reorderSections`:
```ts
import { updateSection, toggleVisibility, regenerateCVContent, addCustomSection, reorderSections } from '@/modules/cv/actions'
```

Inside the `CvEditor` component, add the sensors setup near the other hooks (after `const { openPanel } = usePageContext()` etc.):

```ts
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
```

Add a `handleDragEnd` function, next to `handleAddCustomSection`:

```ts
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = content.sections.findIndex(s => s.id === active.id)
    const newIndex = content.sections.findIndex(s => s.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const prev = content
    const reordered = arrayMove(content.sections, oldIndex, newIndex)
    setContent(c => ({ ...c, sections: reordered }))
    startTransition(async () => {
      try {
        await reorderSections(cv.id, reordered.map(s => s.id))
      } catch {
        setContent(prev)
        toast.error('Failed to reorder sections. Please try again.')
      }
    })
  }
```

Wrap the section-list JSX (the block built in Task 4, Step 4) in `DndContext` + `SortableContext`:

```tsx
              <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                <SortableContext items={content.sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
                  {content.sections.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <p className="text-sm font-medium text-muted-foreground">No content yet</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Click Regenerate to generate your CV, or add a section below.
                      </p>
                      <div className="mt-4 w-full">
                        <SectionGap onAdd={(heading, subtype) => handleAddCustomSection(heading, subtype, 0)} />
                      </div>
                    </div>
                  ) : (
                    <>
                      <SectionGap onAdd={(heading, subtype) => handleAddCustomSection(heading, subtype, 0)} />
                      {content.sections.map((section, index) => {
                        const prevVisible = content.sections.slice(0, index).filter(s => s.visible).at(-1)
                        const showHeading = prevVisible?.type !== section.type
                        return (
                          <Fragment key={section.id}>
                            <CvBlock
                              section={section}
                              onToggleVisibility={() => handleToggleVisibility(section.id)}
                              onCopy={() => handleCopySection(section)}
                            >
                              {renderBlock(section, handleUpdateSection, showHeading)}
                            </CvBlock>
                            <SectionGap onAdd={(heading, subtype) => handleAddCustomSection(heading, subtype, index + 1)} />
                          </Fragment>
                        )
                      })}
                    </>
                  )}
                </SortableContext>
              </DndContext>
```

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors

- [ ] **Step 5: Run full test suite**

Run: `npm run test`
Expected: all tests pass, including Task 1 and Task 2's new tests

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/app/dashboard/cv-builder/\[id\]/_components/cv-block.tsx src/app/dashboard/cv-builder/\[id\]/_components/cv-editor.tsx
git commit -m "feat(cv): drag-and-drop section reordering inline in the document"
```

---

## Task 6: End-to-end verification in the browser

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (or use this repo's `run`/`verify` skill if invoked interactively, since it knows how to launch and drive this specific app)

- [ ] **Step 2: Manual check — insert at various positions**

Sign in as `test@example.com` / `password`, open an existing CV (or create one), and:
- Hover the gap before the first section → confirm "+ Add section" appears → add a text section → confirm it lands at the top
- Hover a gap in the middle → add a list section → confirm it lands exactly between the two blocks it was between
- Hover the gap after the last section → confirm it appends at the end

- [ ] **Step 3: Manual check — drag reorder**

- Hover any section → confirm the grip handle appears in the control bar alongside Edit/Copy/Hide
- Drag a section to a new position → confirm the list reflows live during the drag
- Refresh the page → confirm the new order persisted (reads from `reorderSections`, not just local state)

- [ ] **Step 4: Manual check — side rail**

- Confirm `SectionRail` no longer shows an "+ Add section" control
- Confirm the section list and ATS widget in the rail still work (visibility toggle, ATS run/report)

- [ ] **Step 5: Manual check — LLM coach**

- Open the chat assistant on a CV page, ask it to add a section the CV is missing (e.g. "Add a Volunteering section listing my work at [X]")
- Confirm a `propose_cv_section_create` confirmation card appears with an "Add CV section" label and a heading/subtype preview
- Accept it → confirm the section appears (appended at the end) and the card's accept flow doesn't error

- [ ] **Step 6: No commit for this task** — this is a verification pass only. If any check fails, return to the relevant task above, fix, and re-run its tests before re-verifying here.
