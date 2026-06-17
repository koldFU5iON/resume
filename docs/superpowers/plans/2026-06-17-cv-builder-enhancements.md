# CV Builder Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve issues #257 (ATS score sync), #258 (editable location line), and #259 (custom sections) in the CV builder as a single PR.

**Architecture:** ATS state is lifted from `ATSScorePanel` into `CvEditor` so both the drawer and the `SectionRail` compact widget share one score. Location is added as a nullable top-level field on `HeaderDataSchema` (JSON, no DB migration). Custom sections extend `CVSectionSchema` with a `custom` type carrying a `text | list` subtype discriminator.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7, Tailwind CSS v4, Zod, Vitest, TypeScript strict

---

## Setup

- [ ] **Create branch**

```bash
git fetch origin
git switch -c feat/cv-builder-enhancements origin/main
```

---

## Task 1: ATS Score sync — lift state into CvEditor (#257)

**Files:**
- Modify: `src/app/dashboard/cv-builder/[id]/_components/ats-score-panel.tsx`
- Modify: `src/app/dashboard/cv-builder/[id]/_components/cv-editor.tsx`
- Modify: `src/app/dashboard/cv-builder/[id]/_components/section-rail.tsx`

### Step 1.1 — Make `ATSScorePanel` controlled

Replace the component's internal state and fetch logic with controlled props. The parent will own the score result and trigger the run.

```tsx
// src/app/dashboard/cv-builder/[id]/_components/ats-score-panel.tsx
'use client'

import { useState } from 'react'
import { ShieldCheck, Loader2, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react'
import { serializeATSScoreForContext } from '@/modules/cv/ats-score-schema'
import { usePageContext } from '@/lib/context/page-context'
import type { ATSScoreResult } from '@/modules/cv/ats-score-schema'

type Props = {
  cvId: string
  cvTitle: string
  cvCompany?: string | null
  hasJobDescription: boolean
  result: ATSScoreResult | null
  isPending: boolean
  onRun: () => void
}

const LABEL_COLORS: Record<string, string> = {
  excellent: 'text-emerald-600',
  strong:    'text-green-600',
  good:      'text-amber-600',
  fair:      'text-orange-500',
  poor:      'text-red-500',
}

const DIMENSION_LABELS: Record<string, string> = {
  keywordCoverage:     'Keyword Coverage',
  titleAlignment:      'Title Alignment',
  sectionCompleteness: 'Section Completeness',
  senioritySignal:     'Seniority Signal',
}

export function ATSScorePanel({ cvId, cvTitle, cvCompany, hasJobDescription, result, isPending, onRun }: Props) {
  const [showDetail, setShowDetail] = useState(false)
  const { setContext, openPanel } = usePageContext()

  function handleDiscussWithCoach() {
    if (!result) return
    setContext({
      type: 'cv',
      cvId,
      title: cvTitle,
      company: cvCompany ?? undefined,
      atsScore: serializeATSScoreForContext(result),
    })
    openPanel()
  }

  const { breakdown } = result ?? {}

  return (
    <div className="flex flex-col gap-3">
      {/* Trigger */}
      <div className="flex items-center gap-2">
        <button
          onClick={onRun}
          disabled={isPending || !hasJobDescription}
          title={!hasJobDescription ? 'Attach a job description to enable ATS scoring' : undefined}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isPending
            ? <Loader2 className="size-3.5 animate-spin" />
            : <ShieldCheck className="size-3.5" />}
          {isPending ? 'Checking…' : result ? 'Re-check ATS' : 'Run ATS Check'}
        </button>

        {result && (
          <button
            onClick={handleDiscussWithCoach}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            <MessageSquare className="size-3.5" />
            Discuss with coach
          </button>
        )}
      </div>

      {/* Score display */}
      {breakdown && (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold tabular-nums">{breakdown.finalScore}</span>
              <span className="text-sm text-muted-foreground">/100</span>
              <span className={`text-sm font-medium capitalize ${LABEL_COLORS[breakdown.label] ?? ''}`}>
                {breakdown.label}
              </span>
            </div>
            <button
              onClick={() => setShowDetail(v => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {showDetail ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              {showDetail ? 'Hide' : 'Details'}
            </button>
          </div>

          {/* Score bar */}
          <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-foreground/70 transition-all"
              style={{ width: `${breakdown.finalScore}%` }}
            />
          </div>

          {/* Dimension breakdown */}
          {showDetail && (
            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
              {(Object.entries(breakdown.dimensions) as [keyof typeof breakdown.dimensions, (typeof breakdown.dimensions)[keyof typeof breakdown.dimensions]][]).map(([key, dim]) => (
                <div key={key}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{DIMENSION_LABELS[key]}</span>
                    <span className="font-medium tabular-nums">{Math.round(dim.score)}</span>
                  </div>
                  <div className="mt-0.5 h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-foreground/50"
                      style={{ width: `${Math.round(dim.score)}%` }}
                    />
                  </div>
                </div>
              ))}

              {breakdown.dimensions.keywordCoverage.missingRequired.length > 0 && (
                <div className="mt-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    Missing required keywords
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {breakdown.dimensions.keywordCoverage.missingRequired.map(kw => (
                      <span
                        key={kw}
                        className="rounded-sm bg-destructive/10 px-1.5 py-0.5 text-[11px] text-destructive"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {result?.interpretation && (
                <div className="mt-1 border-t border-border pt-2">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {result.interpretation.summary}
                  </p>
                  {result.interpretation.profileOpportunities.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                        Profile opportunities
                      </p>
                      {result.interpretation.profileOpportunities.map((opp, i) => (
                        <p key={i} className="text-xs text-muted-foreground leading-relaxed">
                          <span className="font-medium">{opp.asset}</span> → {opp.targetSection}: {opp.rationale}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 1.2 — Verify it compiles**

```bash
npm run typecheck
```

Expected: no errors in `ats-score-panel.tsx`.

### Step 1.3 — Lift ATS state into `CvEditor`

Add `atsResult` / `atsRunning` state and `handleRunATS` to `CvEditor`. Update both the panel and rail call-sites.

In `cv-editor.tsx`:

1. Add imports near the top with the other imports:
```ts
import { runATSScore } from '@/modules/cv/ats-score-action'
import type { ATSScoreResult } from '@/modules/cv/ats-score-schema'
```

2. Add state inside `CvEditor` (after existing `useState` declarations):
```ts
const [atsResult, setAtsResult] = useState<ATSScoreResult | null>(null)
const [atsRunning, setAtsRunning] = useState(false)
```

3. Add handler (after existing handler functions):
```ts
async function handleRunATS() {
  setAtsRunning(true)
  const res = await runATSScore(cv.id)
  if (res.ok) {
    setAtsResult(res.result)
  } else {
    toast.error(res.message)
  }
  setAtsRunning(false)
}
```

4. Update `ATSScorePanel` usage in the JSX (inside the `atsPanelOpen` drawer):
```tsx
<ATSScorePanel
  cvId={cv.id}
  cvTitle={cv.jobTitle ?? 'CV'}
  cvCompany={cv.company}
  hasJobDescription={!!(cv.jobApplication?.jobDescription)}
  result={atsResult}
  isPending={atsRunning}
  onRun={handleRunATS}
/>
```

5. Update `SectionRail` usage in the JSX (below the body div):
```tsx
<SectionRail
  sections={content.sections}
  onToggleVisibility={handleToggleVisibility}
  atsResult={atsResult}
  atsRunning={atsRunning}
  onRunATS={handleRunATS}
  onOpenATS={() => setAtsPanelOpen(true)}
/>
```

- [ ] **Step 1.4 — Activate the SectionRail compact widget**

Replace `section-rail.tsx` entirely:

```tsx
// src/app/dashboard/cv-builder/[id]/_components/section-rail.tsx
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
  return SECTION_LABELS[section.type] ?? section.type
}

type Props = {
  sections: CVSection[]
  onToggleVisibility: (id: string) => void
  atsResult: ATSScoreResult | null
  atsRunning: boolean
  onRunATS: () => void
  onOpenATS: () => void
}

export function SectionRail({ sections, onToggleVisibility, atsResult, atsRunning, onRunATS, onOpenATS }: Props) {
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
            onClick={onRunATS}
            disabled={atsRunning}
            className="flex w-full items-center justify-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
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

- [ ] **Step 1.5 — Typecheck and commit**

```bash
npm run typecheck
```

Expected: no errors.

```bash
git add src/app/dashboard/cv-builder/\[id\]/_components/ats-score-panel.tsx \
         src/app/dashboard/cv-builder/\[id\]/_components/cv-editor.tsx \
         src/app/dashboard/cv-builder/\[id\]/_components/section-rail.tsx
git commit -m "fix(cv): sync ATS score state between drawer and section rail (#257)"
```

---

## Task 2: Editable location / availability line in header (#258)

**Files:**
- Modify: `src/modules/cv/schema.ts`
- Modify: `src/app/dashboard/cv-builder/[id]/_components/blocks/header-block.tsx`
- Modify: `src/modules/cv/export.ts`
- Modify: `src/app/components/cv-pdf-document.tsx`

### Step 2.1 — Write a failing export test for location

In `src/modules/cv/export.test.ts`, add a test that the location line appears between sub-headline and contact in markdown output. (Look at existing test structure in the file and add alongside it.)

```ts
it('includes location between sub-headline and contact', () => {
  const doc: CVDocumentContent = {
    version: 1,
    sections: [{
      id: '1',
      type: 'header',
      visible: true,
      data: {
        name: 'Ada Lovelace',
        headline: 'Engineer',
        subHeadline: 'PhD',
        location: 'London · Willing to relocate',
        contact: { email: 'ada@example.com', phone: null, linkedin: null, website: null },
      },
    }],
  }
  const md = toMarkdown(doc)
  const lines = md.split('\n')
  const locationIdx = lines.findIndex(l => l.includes('London'))
  const contactIdx = lines.findIndex(l => l.includes('ada@example.com'))
  expect(locationIdx).toBeGreaterThan(-1)
  expect(locationIdx).toBeLessThan(contactIdx)
})
```

- [ ] **Step 2.2 — Run test to confirm it fails**

```bash
npx vitest run src/modules/cv/export.test.ts
```

Expected: FAIL — `location` is not a known field on `HeaderDataSchema`.

### Step 2.3 — Add `location` to `HeaderDataSchema`

In `src/modules/cv/schema.ts`, update `HeaderDataSchema`:

```ts
export const HeaderDataSchema = z.object({
  name: z.string(),
  headline: z.string(),
  subHeadline: z.string().nullish(),
  location: z.string().nullish(),
  contact: z.object({
    email: z.string().nullish(),
    phone: z.string().nullish(),
    linkedin: z.string().nullish(),
    website: z.string().nullish(),
  }),
})
```

- [ ] **Step 2.4 — Add location to `sectionToMarkdown` in `export.ts`**

Update the `"header"` case in `sectionToMarkdown`:

```ts
case "header": {
  const { name, headline, subHeadline, location, contact } = section.data
  const contactLine = [contact.email, contact.phone, contact.linkedin, contact.website]
    .filter(Boolean).join(" · ")
  return [
    `# ${name}`,
    headline,
    subHeadline,
    location,
    contactLine,
  ].filter(Boolean).join("\n")
}
```

- [ ] **Step 2.5 — Run test to confirm it passes**

```bash
npx vitest run src/modules/cv/export.test.ts
```

Expected: PASS.

### Step 2.6 — Add location to `HeaderBlock`

Replace `src/app/dashboard/cv-builder/[id]/_components/blocks/header-block.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { useBlockEditTrigger } from '../cv-block'
import type { CVSection, HeaderData } from '@/modules/cv/schema'

type Props = {
  section: CVSection & { type: 'header'; data: HeaderData }
  onUpdate: (section: CVSection) => void
}

export function HeaderBlock({ section, onUpdate }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(section.data)
  const editTrigger = useBlockEditTrigger()

  const [seenTrigger, setSeenTrigger] = useState(editTrigger)
  if (seenTrigger !== editTrigger) {
    setSeenTrigger(editTrigger)
    if (editTrigger > 0) setEditing(true)
  }

  function save() {
    onUpdate({ ...section, data: draft })
    setEditing(false)
  }

  function cancel() {
    setDraft(section.data)
    setEditing(false)
  }

  const { name, headline, subHeadline, location, contact } = section.data

  const contactItems = [
    contact.email,
    contact.phone,
    contact.linkedin,
    contact.website,
  ].filter(Boolean)

  if (!editing) {
    return (
      <div className="space-y-0.5">
        <h1 className="cv-name">{name}</h1>
        <p className="cv-headline">{headline}</p>
        {subHeadline && (
          <p className="cv-headline font-medium">{subHeadline}</p>
        )}
        {location && (
          <p className="cv-contact pt-0.5">{location}</p>
        )}
        {contactItems.length > 0 && (
          <p className="cv-contact pt-1">
            {contactItems.join(' · ')}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {([
          ['Name', 'name', draft.name],
          ['Headline', 'headline', draft.headline],
        ] as const).map(([label, field, value]) => (
          <div key={field} className="space-y-1">
            <label className="text-xs text-muted-foreground">{label}</label>
            <input
              value={value}
              onChange={e => setDraft({ ...draft, [field]: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        ))}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Sub-headline (optional)</label>
          <input
            value={draft.subHeadline ?? ''}
            onChange={e => setDraft({ ...draft, subHeadline: e.target.value || undefined })}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="col-span-2 space-y-1">
          <label className="text-xs text-muted-foreground">Location / Availability (optional)</label>
          <input
            value={draft.location ?? ''}
            onChange={e => setDraft({ ...draft, location: e.target.value || undefined })}
            placeholder="Based in Dublin · Willing to relocate · EU citizen"
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {([
          ['Email', 'email'],
          ['Phone', 'phone'],
          ['LinkedIn', 'linkedin'],
          ['Website', 'website'],
        ] as const).map(([label, field]) => (
          <div key={field} className="space-y-1">
            <label className="text-xs text-muted-foreground">{label}</label>
            <input
              value={draft.contact[field] ?? ''}
              onChange={e => setDraft({ ...draft, contact: { ...draft.contact, [field]: e.target.value || undefined } })}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={save} className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90">
          <Check className="size-3" />Save
        </button>
        <button onClick={cancel} className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted">
          <X className="size-3" />Cancel
        </button>
      </div>
    </div>
  )
}
```

### Step 2.7 — Add location to `CVPDFDocument`

In `src/app/components/cv-pdf-document.tsx`, in the header render block (inside the `CVPDFDocument` function), add a location line after the sub-headline:

```tsx
{d.subHeadline ? <Text style={s.subheadline}>{d.subHeadline}</Text> : null}
{d.location ? <Text style={s.contact}>{d.location}</Text> : null}
{contactItems.length > 0 ? <Text style={s.contact}>{contactItems.join(' · ')}</Text> : null}
```

The `d` variable is typed as `HeaderData` via `header.data as HeaderData` — TypeScript will now include `location` after the schema update.

- [ ] **Step 2.8 — Typecheck and commit**

```bash
npm run typecheck
```

Expected: no errors.

```bash
git add src/modules/cv/schema.ts \
         src/app/dashboard/cv-builder/\[id\]/_components/blocks/header-block.tsx \
         src/modules/cv/export.ts \
         src/modules/cv/export.test.ts \
         src/app/components/cv-pdf-document.tsx
git commit -m "feat(cv): editable location/availability line in CV header (#258)"
```

---

## Task 3: Custom sections — schema and server action (#259a)

**Files:**
- Modify: `src/modules/cv/schema.ts`
- Modify: `src/modules/cv/schema.test.ts`
- Modify: `src/modules/cv/actions.ts`

### Step 3.1 — Write a failing schema test for custom sections

In `src/modules/cv/schema.test.ts`, add:

```ts
it('parses a custom text section', () => {
  const raw = JSON.stringify({
    version: 1,
    sections: [{
      id: 'abc',
      type: 'custom',
      visible: true,
      data: { heading: 'Publications', subtype: 'text', content: 'My paper.', items: null },
    }],
  })
  const result = parseCVContent(raw)
  expect(result.sections).toHaveLength(1)
  expect(result.sections[0].type).toBe('custom')
})

it('parses a custom list section', () => {
  const raw = JSON.stringify({
    version: 1,
    sections: [{
      id: 'xyz',
      type: 'custom',
      visible: true,
      data: { heading: 'Tools', subtype: 'list', content: null, items: ['Figma', 'Notion'] },
    }],
  })
  const result = parseCVContent(raw)
  expect(result.sections[0].type).toBe('custom')
  if (result.sections[0].type === 'custom') {
    expect(result.sections[0].data.items).toEqual(['Figma', 'Notion'])
  }
})
```

- [ ] **Step 3.2 — Run tests to confirm they fail**

```bash
npx vitest run src/modules/cv/schema.test.ts
```

Expected: FAIL — `custom` is not a valid discriminated union member.

### Step 3.3 — Add `custom` type to `CVSectionSchema`

In `src/modules/cv/schema.ts`, add after `LanguagesDataSchema`:

```ts
export const CustomDataSchema = z.object({
  heading: z.string(),
  subtype: z.enum(['text', 'list']),
  content: z.string().nullish(),
  items: z.array(z.string()).nullish(),
})
```

Add to the `CVSectionSchema` discriminated union array (after `languages`):

```ts
z.object({ id: z.string(), type: z.literal("custom"), visible: z.boolean(), data: CustomDataSchema }),
```

Also export the inferred type at the bottom of the file alongside the other types:

```ts
export type CustomData = z.infer<typeof CustomDataSchema>
```

- [ ] **Step 3.4 — Run tests to confirm they pass**

```bash
npx vitest run src/modules/cv/schema.test.ts
```

Expected: PASS.

### Step 3.5 — Add `addCustomSection` server action

In `src/modules/cv/actions.ts`, add at the end of the file:

```ts
export async function addCustomSection(
  cvId: string,
  heading: string,
  subtype: 'text' | 'list',
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
  content.sections.push(newSection)

  await prisma.cVDocument.update({
    where: { id: cvId },
    data: { generatedContent: JSON.stringify(content) },
  })
  revalidatePath(`/dashboard/cv-builder/${cvId}`)
  return newSection
}
```

- [ ] **Step 3.6 — Typecheck and commit**

```bash
npm run typecheck
```

Expected: no errors.

```bash
git add src/modules/cv/schema.ts \
         src/modules/cv/schema.test.ts \
         src/modules/cv/actions.ts
git commit -m "feat(cv): add custom section schema type and addCustomSection action (#259)"
```

---

## Task 4: CustomBlock component (#259b)

**Files:**
- Create: `src/app/dashboard/cv-builder/[id]/_components/blocks/custom-block.tsx`

### Step 4.1 — Write a failing export test for custom sections

In `src/modules/cv/export.test.ts`, add:

```ts
it('serialises a custom text section to markdown', () => {
  const doc: CVDocumentContent = {
    version: 1,
    sections: [{
      id: '1',
      type: 'custom',
      visible: true,
      data: { heading: 'Publications', subtype: 'text', content: 'My paper on ML.', items: null },
    }],
  }
  const md = toMarkdown(doc)
  expect(md).toContain('## Publications')
  expect(md).toContain('My paper on ML.')
})

it('serialises a custom list section to markdown', () => {
  const doc: CVDocumentContent = {
    version: 1,
    sections: [{
      id: '2',
      type: 'custom',
      visible: true,
      data: { heading: 'Tools', subtype: 'list', content: null, items: ['Figma', 'Notion'] },
    }],
  }
  const md = toMarkdown(doc)
  expect(md).toContain('## Tools')
  expect(md).toContain('- Figma')
  expect(md).toContain('- Notion')
})
```

- [ ] **Step 4.2 — Run export tests to confirm they fail**

```bash
npx vitest run src/modules/cv/export.test.ts
```

Expected: FAIL — no `custom` case in `sectionToMarkdown`.

### Step 4.3 — Add `custom` case to `export.ts`

In `src/modules/cv/export.ts`, add a `custom` case to `sectionToMarkdown` (after the `languages` case):

```ts
case "custom": {
  const { heading, subtype, content, items } = section.data
  if (subtype === 'text') {
    return `## ${heading}\n\n${content ?? ''}`
  }
  return `## ${heading}\n\n${(items ?? []).map(i => `- ${i}`).join("\n")}`
}
```

- [ ] **Step 4.4 — Run export tests to confirm they pass**

```bash
npx vitest run src/modules/cv/export.test.ts
```

Expected: PASS.

### Step 4.5 — Create `CustomBlock` component

Create `src/app/dashboard/cv-builder/[id]/_components/blocks/custom-block.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Check, X, Plus, Trash2 } from 'lucide-react'
import { useBlockEditTrigger } from '../cv-block'
import { MarkdownProse } from '@/components/ui/markdown-prose'
import type { CVSection } from '@/modules/cv/schema'

type Props = {
  section: CVSection & { type: 'custom' }
  onUpdate: (section: CVSection) => void
  showHeading?: boolean
}

export function CustomBlock({ section, onUpdate, showHeading = true }: Props) {
  const [editing, setEditing] = useState(false)
  const [draftHeading, setDraftHeading] = useState(section.data.heading)
  const [draftContent, setDraftContent] = useState(section.data.content ?? '')
  const [draftItems, setDraftItems] = useState(section.data.items ?? [])
  const editTrigger = useBlockEditTrigger()

  const [seenTrigger, setSeenTrigger] = useState(editTrigger)
  if (seenTrigger !== editTrigger) {
    setSeenTrigger(editTrigger)
    if (editTrigger > 0) setEditing(true)
  }

  function save() {
    onUpdate({
      ...section,
      data: {
        ...section.data,
        heading: draftHeading,
        content: section.data.subtype === 'text' ? draftContent : null,
        items: section.data.subtype === 'list' ? draftItems.filter(Boolean) : null,
      },
    })
    setEditing(false)
  }

  function cancel() {
    setDraftHeading(section.data.heading)
    setDraftContent(section.data.content ?? '')
    setDraftItems(section.data.items ?? [])
    setEditing(false)
  }

  if (!editing) {
    return (
      <div>
        {showHeading && (
          <div className="mb-2 border-b border-border pb-1">
            <h2 className="cv-section-heading">{section.data.heading}</h2>
          </div>
        )}
        {section.data.subtype === 'text' ? (
          <MarkdownProse content={section.data.content ?? ''} />
        ) : (
          <p className="cv-body">{(section.data.items ?? []).join(' · ')}</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Section Heading</label>
        <input
          value={draftHeading}
          onChange={e => setDraftHeading(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {section.data.subtype === 'text' ? (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Content</label>
          <textarea
            value={draftContent}
            onChange={e => setDraftContent(e.target.value)}
            rows={6}
            className="w-full resize-y rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      ) : (
        <div className="space-y-2">
          {draftItems.map((item, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={item}
                onChange={e => setDraftItems(draftItems.map((d, j) => j === i ? e.target.value : d))}
                className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                onClick={() => setDraftItems(draftItems.filter((_, j) => j !== i))}
                className="rounded p-1.5 text-muted-foreground hover:bg-muted"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          <button
            onClick={() => setDraftItems([...draftItems, ''])}
            className="flex items-center gap-1 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
          >
            <Plus className="size-3" />Add
          </button>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={save} className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90">
          <Check className="size-3" />Save
        </button>
        <button onClick={cancel} className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted">
          <X className="size-3" />Cancel
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4.6 — Typecheck and commit**

```bash
npm run typecheck
```

Expected: no errors.

```bash
git add src/app/dashboard/cv-builder/\[id\]/_components/blocks/custom-block.tsx \
         src/modules/cv/export.ts \
         src/modules/cv/export.test.ts
git commit -m "feat(cv): CustomBlock component and custom section export serialisation (#259)"
```

---

## Task 5: Wire custom sections into editor, rail, and PDF (#259c)

**Files:**
- Modify: `src/app/dashboard/cv-builder/[id]/_components/cv-editor.tsx`
- Modify: `src/app/dashboard/cv-builder/[id]/_components/section-rail.tsx`
- Modify: `src/app/components/cv-pdf-document.tsx`

### Step 5.1 — Wire `CustomBlock` into `CvEditor`

In `src/app/dashboard/cv-builder/[id]/_components/cv-editor.tsx`:

1. Add import:
```ts
import { CustomBlock } from './blocks/custom-block'
import { addCustomSection } from '@/modules/cv/actions'
```

2. Add handler inside `CvEditor` (after `handleToggleVisibility`):
```ts
async function handleAddCustomSection(heading: string, subtype: 'text' | 'list') {
  try {
    const newSection = await addCustomSection(cv.id, heading, subtype)
    setContent(c => ({ ...c, sections: [...c.sections, newSection] }))
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to add section')
  }
}
```

3. Update `SectionRail` usage to pass the new prop:
```tsx
<SectionRail
  sections={content.sections}
  onToggleVisibility={handleToggleVisibility}
  atsResult={atsResult}
  atsRunning={atsRunning}
  onRunATS={handleRunATS}
  onOpenATS={() => setAtsPanelOpen(true)}
  onAddCustomSection={handleAddCustomSection}
/>
```

4. Add `custom` case to the `renderBlock` function at the bottom of the file:
```ts
case 'custom': return <CustomBlock section={section} onUpdate={onUpdate} showHeading={showHeading} />
```

### Step 5.2 — Add "+ Add section" form to `SectionRail`

In `src/app/dashboard/cv-builder/[id]/_components/section-rail.tsx`:

1. Add `useState` import, extend `SECTION_LABELS` with the `custom` entry, add `custom` case to `getSectionLabel`, and add `onAddCustomSection` to `Props`:

```ts
import { useState } from 'react'
```

Add `custom: 'Custom'` to `SECTION_LABELS` (the `custom` type is now valid after Task 3):
```ts
const SECTION_LABELS: Record<CVSection['type'], string> = {
  // ...existing entries...
  custom: 'Custom',
}
```

Add to `getSectionLabel` (before the final `return`):
```ts
if (section.type === 'custom') return section.data.heading || 'Custom'
```

Update the `Props` type:
```ts
type Props = {
  sections: CVSection[]
  onToggleVisibility: (id: string) => void
  atsResult: ATSScoreResult | null
  atsRunning: boolean
  onRunATS: () => void
  onOpenATS: () => void
  onAddCustomSection: (heading: string, subtype: 'text' | 'list') => void
}
```

2. Add state inside `SectionRail`:
```ts
const [addingSection, setAddingSection] = useState(false)
const [newHeading, setNewHeading] = useState('')
const [newSubtype, setNewSubtype] = useState<'text' | 'list'>('text')

function handleSubmit() {
  if (!newHeading.trim()) return
  onAddCustomSection(newHeading.trim(), newSubtype)
  setNewHeading('')
  setNewSubtype('text')
  setAddingSection(false)
}
```

3. Add the inline form below the sections list `<div>` and before the ATS widget:
```tsx
{/* Add custom section */}
<div className="mt-3">
  {addingSection ? (
    <div className="flex flex-col gap-1.5 rounded-md border border-border p-2">
      <input
        autoFocus
        value={newHeading}
        onChange={e => setNewHeading(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') setAddingSection(false) }}
        placeholder="Section name"
        className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="flex gap-1">
        {(['text', 'list'] as const).map(t => (
          <button
            key={t}
            onClick={() => setNewSubtype(t)}
            className={`flex-1 rounded px-2 py-0.5 text-xs capitalize transition-colors ${newSubtype === t ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        <button onClick={handleSubmit} className="flex-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90">
          Add
        </button>
        <button onClick={() => setAddingSection(false)} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
          ✕
        </button>
      </div>
    </div>
  ) : (
    <button
      onClick={() => setAddingSection(true)}
      className="w-full rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted text-left"
    >
      + Add section
    </button>
  )}
</div>
```

### Step 5.3 — Add `custom` to `CVPDFDocument`

In `src/app/components/cv-pdf-document.tsx`:

1. Add `CustomData` to the schema import:
```ts
import type { CVSection, HeaderData, ExperienceData, EducationData, CertificationData, LanguagesData, CustomData } from '@/modules/cv/schema'
```

2. Add a `getSectionLabel` helper above `SectionBody`:
```ts
function getSectionLabel(section: CVSection): string | undefined {
  if (section.type === 'custom') return (section.data as CustomData).heading
  return SECTION_LABELS[section.type]
}
```

3. In `SectionBody`, add a `custom` case before the `default`:
```tsx
case 'custom': {
  const d = section.data as CustomData
  return d.subtype === 'text'
    ? <Text>{d.content ?? ''}</Text>
    : (
      <View>
        {(d.items ?? []).map((item, i) => (
          <View key={i} style={s.bullet}>
            <Text style={s.bulletDash}>-</Text>
            <Text style={s.bulletText}>{item}</Text>
          </View>
        ))}
      </View>
    )
}
```

4. In the `body.map(...)` render loop, replace the `label` assignment line:
```ts
const label = getSectionLabel(section)
```

(This replaces `const label = SECTION_LABELS[section.type]`.)

- [ ] **Step 5.4 — Run all tests and typecheck**

```bash
npx vitest run
npm run typecheck
```

Expected: all tests pass, no type errors.

- [ ] **Step 5.5 — Commit**

```bash
git add src/app/dashboard/cv-builder/\[id\]/_components/cv-editor.tsx \
         src/app/dashboard/cv-builder/\[id\]/_components/section-rail.tsx \
         src/app/components/cv-pdf-document.tsx
git commit -m "feat(cv): wire custom sections into editor, rail, and PDF (#259)"
```

---

## Final verification

- [ ] **Run the dev server and manually verify:**

```bash
npm run dev
```

1. Open a CV with a linked job application
2. In the section rail: click "Run analysis →" — score should appear in the rail and be consistent with the full ATS drawer
3. Click the score card in the rail — the ATS drawer should open
4. Edit the CV header — the "Location / Availability" field should appear in edit mode and render on the CV
5. Click "+ Add section" in the rail — enter a heading, choose Text or List, click Add — the section should appear in the CV and be editable
6. Export to markdown — custom section and location should appear

- [ ] **Open PR**

```bash
gh pr create --title "feat(cv): ATS sync, location field, custom sections (#257, #258, #259)" --body "$(cat <<'EOF'
## Summary
- Lifts ATS score state into CvEditor so the section rail widget and the full ATS drawer share a single score run (#257)
- Adds a free-text Location / Availability field to the CV header, rendering between sub-headline and contact details, included in markdown/text/PDF exports (#258)
- Adds a `custom` section type with text and list subtypes; users can add named custom sections via the section rail; wired into the editor, exports, and PDF (#259)

## Test plan
- [ ] Run analysis from the section rail compact widget — score populates and clicking opens the full drawer
- [ ] Re-run ATS from the drawer — rail widget updates with the new score
- [ ] Edit CV header, add a location string — renders on the CV and in exported markdown
- [ ] Add a custom text section, type content — renders and exports correctly
- [ ] Add a custom list section, add items — renders and exports correctly
- [ ] `npm run typecheck` passes clean
- [ ] `npx vitest run` passes clean

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
