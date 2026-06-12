# Profile Workspace Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2-column profile page with a 3-column inline editing workspace — a sticky left column (contact + summary), a centre column (experience tabs + click-to-edit markdown + collapsible activities tray + projects panel), and a right column (skills, education, certs).

**Architecture:** `page.tsx` remains a server component. A new `ExperienceWorkspace` client component owns the entire centre column and manages `selectedExperienceId` + `activeContext` state. Left and right columns are independent client components carried forward with minimal changes. Two schema additions (`Project.experienceId`, `Project.notes`) link projects to experiences and give them a markdown surface.

**Tech stack:** Next.js 16 App Router, Prisma 7, Tailwind CSS v4, shadcn/ui, ReactMarkdown + remark-gfm, Vitest, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-06-12-profile-workspace-redesign.md`

---

## File Map

**Create:**
- `src/app/dashboard/profile/_components/NoteEditor.tsx`
- `src/app/dashboard/profile/_components/ExperienceFrontmatter.tsx`
- `src/app/dashboard/profile/_components/ActivitiesTray.tsx`
- `src/app/dashboard/profile/_components/ProjectsPanel.tsx`
- `src/app/dashboard/profile/_components/ExperienceWorkspace.tsx`
- `src/lib/profile-summary.ts`
- `src/lib/profile-summary.test.ts`

**Modify:**
- `prisma/schema/profile.prisma` — add `Project.experienceId`, `Project.notes`, `Experience.projects` back-relation
- `src/app/types/profile.ts` — add `experienceId` and `notes` to `Project` type
- `src/modules/profile/actions.ts` — add `updateProjectNotes`, extend `createProject` to accept `experienceId`
- `src/modules/chat/schema.ts` — add `'profile'` variant to `PageContextSchema`
- `src/app/dashboard/profile/_components/Experience.tsx` — export `ExperienceDialog`
- `src/app/dashboard/profile/page.tsx` — replace 2-column layout with 3-column grid
- `src/modules/profile-import/commit.ts` — populate `summary` from activities when blank

---

## Task 1: Schema migration — Project.experienceId + Project.notes

**Files:**
- Modify: `prisma/schema/profile.prisma`

- [ ] **Step 1: Edit the schema**

Open `prisma/schema/profile.prisma`. Find the `Project` model and add two fields. Also add the back-relation to `Experience`.

In the `Project` model, add after `status`:
```prisma
  experienceId String?
  notes        String  @default("")

  experience Experience? @relation(fields: [experienceId], references: [id], onDelete: SetNull)
```

Also add the `@@index`:
```prisma
  @@index([experienceId])
```

In the `Experience` model, add after `activities RoleActivity[]`:
```prisma
  projects  Project[]
```

The `Project` model's `profile` relation line stays unchanged. The full Project model should now look like:
```prisma
model Project {
  id           String    @id @default(cuid())
  profileId    String
  experienceId String?
  name         String
  description  String
  notes        String    @default("")
  url          String?
  repoUrl      String?
  startDate    DateTime?
  endDate      DateTime?
  status       String    @default("active")
  highlights   String    @default("[]")
  tags         String    @default("[]")
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  profile    Profile     @relation(fields: [profileId], references: [id], onDelete: Cascade)
  experience Experience? @relation(fields: [experienceId], references: [id], onDelete: SetNull)
  skills     ProjectSkill[]

  @@index([profileId])
  @@index([experienceId])
}
```

- [ ] **Step 2: Run the migration**

```bash
npm run db:migrate -- --name add_project_experience_link_and_notes
```

Expected: creates `prisma/migrations/[timestamp]_add_project_experience_link_and_notes/migration.sql` and applies it to the local Docker DB. No errors.

- [ ] **Step 3: Verify typecheck passes**

```bash
npm run typecheck
```

Expected: no errors (the schema regenerates the Prisma client, so the new fields are available).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema/profile.prisma prisma/migrations/
git commit -m "feat: add Project.experienceId and Project.notes schema fields"
```

---

## Task 2: Update types and Project actions

**Files:**
- Modify: `src/app/types/profile.ts`
- Modify: `src/modules/profile/actions.ts`

- [ ] **Step 1: Update the Project domain type**

In `src/app/types/profile.ts`, the `Project` type currently is:
```typescript
export type Project = Omit<ProjectRow, "highlights" | "tags"> & {
  highlights: string[]
  tags: string[]
}
```

Replace with:
```typescript
export type Project = Omit<ProjectRow, "highlights" | "tags"> & {
  highlights: string[]
  tags: string[]
  // experienceId and notes are inherited from ProjectRow (no transformation needed)
}
```

No change needed to the type body — `experienceId` and `notes` come through from `ProjectRow` automatically since they're plain scalar fields. But verify `getFullProfile` passes them through. Open `src/modules/profile/queries.ts` and confirm the `projects` include maps correctly:
```typescript
projects: row.projects.map(p => ({
  ...p,
  highlights: parseJsonField<string[]>(p.highlights, []),
  tags: parseJsonField<string[]>(p.tags, []),
})),
```
The spread `...p` includes `experienceId` and `notes`. No change needed here. ✅

- [ ] **Step 2: Add updateProjectNotes action**

In `src/modules/profile/actions.ts`, find the `// ── Projects` section. After the existing `updateProject` function, add:

```typescript
export async function updateProjectNotes(id: string, notes: string) {
  const { profile } = await requireProfile()
  const project = await prisma.project.update({
    where: { id, profileId: profile.id },
    data: { notes },
  })
  revalidatePath('/dashboard/profile')
  return project
}
```

- [ ] **Step 3: Update createProject to accept experienceId**

Find the `ProjectData` type in `src/modules/profile/actions.ts`:
```typescript
type ProjectData = {
  name: string
  description: string
  url?: string
  repoUrl?: string
  startDate?: Date
  endDate?: Date
  status?: string
  highlights?: string[]
  tags?: string[]
}
```

Add `experienceId`:
```typescript
type ProjectData = {
  name: string
  description: string
  experienceId?: string
  url?: string
  repoUrl?: string
  startDate?: Date
  endDate?: Date
  status?: string
  highlights?: string[]
  tags?: string[]
}
```

Then find `createProject` and update it to pass `experienceId` to Prisma:
```typescript
export async function createProject(data: ProjectData) {
  const { profile } = await requireProfile()
  const { highlights, tags, ...rest } = data
  const project = await prisma.project.create({
    data: {
      ...rest,
      profileId: profile.id,
      highlights: JSON.stringify(highlights ?? []),
      tags: JSON.stringify(tags ?? []),
    },
  })
  revalidatePath('/dashboard/profile')
  return project
}
```

(`experienceId` is now part of `rest` and gets spread into the create data automatically.)

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/types/profile.ts src/modules/profile/actions.ts
git commit -m "feat: add updateProjectNotes action and experienceId to createProject"
```

---

## Task 3: Add 'profile' variant to PageContextSchema

**Files:**
- Modify: `src/modules/chat/schema.ts`

The coach's `useWorkspaceContext` takes a `PageContext` value. `PageContext` is a Zod discriminated union. We need a `'profile'` variant so `ExperienceWorkspace` can pass profile context to the coach.

- [ ] **Step 1: Add the new variant**

Open `src/modules/chat/schema.ts`. The current `PageContextSchema` is a `z.discriminatedUnion('type', [...])`. Add a new object to the array:

```typescript
z.object({
  type: z.literal('profile'),
  profileSummary: z.string(),
  activeExperienceId: z.string().optional(),
  activeExperienceName: z.string().optional(),
}),
```

The full updated `PageContextSchema` array will have 6 entries (existing 5 + this new one).

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. The `PageContext` type is inferred from the schema, so the new variant is automatically available.

- [ ] **Step 3: Commit**

```bash
git add src/modules/chat/schema.ts
git commit -m "feat: add profile PageContext variant for coach workspace context"
```

---

## Task 4: buildProfileSummary utility

**Files:**
- Create: `src/lib/profile-summary.ts`
- Create: `src/lib/profile-summary.test.ts`

Pure function that serialises `FullProfile` into a compact coach-readable string.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/profile-summary.test.ts`:

```typescript
import { expect, test } from 'vitest'
import { buildProfileSummary } from './profile-summary'
import type { FullProfile } from '@/app/types/profile'

function makeProfile(overrides: Partial<FullProfile> = {}): FullProfile {
  return {
    id: 'p1', userId: 'u1',
    name: 'Devon Stanton', headline: 'Senior Engineer',
    email: null, phone: null, location: null, website: null, linkedIn: null, github: null,
    summary: null, createdAt: new Date(), updatedAt: new Date(),
    experiences: [],
    skills: [],
    educations: [],
    certifications: [],
    competencies: [],
    languages: [],
    tools: [],
    projects: [],
    ...overrides,
  } as unknown as FullProfile
}

test('includes name and headline', () => {
  const result = buildProfileSummary(makeProfile())
  expect(result).toContain('Devon Stanton')
  expect(result).toContain('Senior Engineer')
})

test('includes top 6 skills by yearsOfExperience', () => {
  const skills = Array.from({ length: 8 }, (_, i) => ({
    id: `s${i}`, profileId: 'p1', name: `Skill${i}`, category: 'Tech',
    level: 'Advanced', yearsOfExperience: i, tags: [], createdAt: new Date(), updatedAt: new Date(),
  }))
  const result = buildProfileSummary(makeProfile({ skills: skills as any }))
  expect(result).toContain('Skill7')
  expect(result).toContain('Skill6')
  expect(result).not.toContain('Skill0')
  expect(result).not.toContain('Skill1')
})

test('formats experience as role @ company (year–year)', () => {
  const experiences = [{
    id: 'e1', profileId: 'p1', company: 'Acme', role: 'Lead Engineer',
    startDate: new Date('2021-01-01'), endDate: null,
    location: null, remote: false, summary: '', tags: [], activities: [],
    notesUpdatedAt: null, createdAt: new Date(), updatedAt: new Date(),
  }]
  const result = buildProfileSummary(makeProfile({ experiences: experiences as any }))
  expect(result).toContain('Lead Engineer @ Acme (2021–present)')
})

test('includes education when present', () => {
  const educations = [{
    id: 'ed1', profileId: 'p1', institution: 'Leeds', qualification: 'BSc Computer Science',
    field: null, startDate: new Date('2008-09-01'), endDate: new Date('2011-06-01'),
    grade: null, tags: [], createdAt: new Date(), updatedAt: new Date(),
  }]
  const result = buildProfileSummary(makeProfile({ educations: educations as any }))
  expect(result).toContain('BSc Computer Science, Leeds')
})

test('handles empty profile gracefully', () => {
  const result = buildProfileSummary(makeProfile({ name: null } as any))
  expect(typeof result).toBe('string')
  expect(result.length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test -- profile-summary
```

Expected: all 5 tests fail with "Cannot find module './profile-summary'".

- [ ] **Step 3: Implement buildProfileSummary**

Create `src/lib/profile-summary.ts`:

```typescript
import type { FullProfile } from '@/app/types/profile'

export function buildProfileSummary(profile: FullProfile): string {
  const topSkills = [...profile.skills]
    .sort((a, b) => (b.yearsOfExperience ?? 0) - (a.yearsOfExperience ?? 0))
    .slice(0, 6)
    .map(s => s.name)
    .join(', ')

  const experienceLines = profile.experiences
    .map(e => {
      const start = new Date(e.startDate).getFullYear()
      const end = e.endDate ? new Date(e.endDate).getFullYear() : 'present'
      return `${e.role} @ ${e.company} (${start}–${end})`
    })
    .join(', ')

  const educationLine = profile.educations[0]
    ? `${profile.educations[0].qualification}, ${profile.educations[0].institution}`
    : ''

  const careerYears = profile.experiences.length > 0
    ? new Date().getFullYear() - Math.min(...profile.experiences.map(e => new Date(e.startDate).getFullYear()))
    : 0

  const lines = [
    `${profile.name ?? 'Unknown'} · ${profile.headline ?? ''} · ${careerYears} years experience`,
    topSkills ? `Skills: ${topSkills}` : '',
    experienceLines ? `Experience: ${experienceLines}` : '',
    educationLine ? `Education: ${educationLine}` : '',
  ]

  return lines.filter(Boolean).join('\n')
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test -- profile-summary
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/profile-summary.ts src/lib/profile-summary.test.ts
git commit -m "feat: add buildProfileSummary utility for coach context"
```

---

## Task 5: NoteEditor component

**Files:**
- Create: `src/app/dashboard/profile/_components/NoteEditor.tsx`

Shared click-to-edit markdown editor. Click → textarea (monospace). Blur → rendered ReactMarkdown. 1500ms debounced autosave.

- [ ] **Step 1: Create the component**

Create `src/app/dashboard/profile/_components/NoteEditor.tsx`:

```typescript
'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

type Props = {
  initialContent: string
  onSave: (content: string) => Promise<unknown>
  onSaveStateChange?: (state: SaveState) => void
  placeholder?: string
  className?: string
}

export function NoteEditor({
  initialContent,
  onSave,
  onSaveStateChange,
  placeholder = 'Click to start writing…',
  className,
}: Props) {
  const [content, setContent] = useState(initialContent)
  const [isEditing, setIsEditing] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  useEffect(() => {
    if (isEditing) textareaRef.current?.focus()
  }, [isEditing])

  const save = useCallback(
    async (value: string) => {
      onSaveStateChange?.('saving')
      try {
        await onSave(value)
        if (mountedRef.current) onSaveStateChange?.('saved')
      } catch {
        if (mountedRef.current) onSaveStateChange?.('error')
      }
    },
    [onSave, onSaveStateChange],
  )

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value
    setContent(value)
    onSaveStateChange?.('idle')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void save(value), 1500)
  }

  function handleBlur() {
    setIsEditing(false)
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
      void save(content)
    }
  }

  return (
    <div className={cn('flex-1 overflow-hidden', className)}>
      {isEditing ? (
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onBlur={handleBlur}
          className="h-full w-full resize-none bg-transparent p-4 font-mono text-sm leading-relaxed outline-none placeholder:text-muted-foreground/40"
          placeholder={placeholder}
        />
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={() => setIsEditing(true)}
          onKeyDown={e => { if (e.key === 'Enter') setIsEditing(true) }}
          className="h-full cursor-text overflow-y-auto p-4"
          aria-label="Click to edit"
        >
          {content ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm italic text-muted-foreground/50">{placeholder}</p>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/profile/_components/NoteEditor.tsx
git commit -m "feat: add NoteEditor shared click-to-edit markdown component"
```

---

## Task 6: ExperienceFrontmatter component

**Files:**
- Create: `src/app/dashboard/profile/_components/ExperienceFrontmatter.tsx`

Compact metadata strip below the tab bar. Experience mode: four inline-editable fields (company, role, dates, location). Project mode: breadcrumb with back link.

- [ ] **Step 1: Create the component**

Create `src/app/dashboard/profile/_components/ExperienceFrontmatter.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { updateExperienceDetails } from '@/modules/profile/actions'
import type { ExperienceWithActivities } from '@/app/types/profile'
import type { SaveState } from './NoteEditor'

type Props = {
  experience: ExperienceWithActivities
  saveState: SaveState
  projectName?: string
  onBack?: () => void
}

const fmtDate = (d: Date) =>
  new Date(d).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

function getDetailsFields(exp: ExperienceWithActivities) {
  return {
    company: exp.company,
    role: exp.role,
    location: exp.location ?? undefined,
    remote: exp.remote,
    startDate: new Date(exp.startDate),
    endDate: exp.endDate ? new Date(exp.endDate) : undefined,
  }
}

export function ExperienceFrontmatter({ experience, saveState, projectName, onBack }: Props) {
  const router = useRouter()

  if (projectName !== undefined) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs">
        <button
          type="button"
          onClick={onBack}
          className="text-primary hover:underline"
        >
          ← {experience.company}
        </button>
        <span className="text-muted-foreground">›</span>
        <span className="font-semibold">{projectName}</span>
        <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
          Project
        </span>
        <div className="ml-auto">
          <SaveIndicator state={saveState} />
        </div>
      </div>
    )
  }

  async function saveField(field: keyof ReturnType<typeof getDetailsFields>, value: string | boolean) {
    const current = getDetailsFields(experience)
    await updateExperienceDetails(experience.id, { ...current, [field]: value })
    router.refresh()
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b bg-muted/30 px-3 py-2 text-xs">
      <InlineField
        label="Company"
        value={experience.company}
        onSave={v => saveField('company', v)}
      />
      <InlineField
        label="Role"
        value={experience.role}
        onSave={v => saveField('role', v)}
      />
      <span className="text-muted-foreground">
        {fmtDate(experience.startDate)} –{' '}
        {experience.endDate ? fmtDate(experience.endDate) : 'Present'}
      </span>
      {experience.location && (
        <span className="text-muted-foreground">
          {experience.location}
          {experience.remote && ' · Remote'}
        </span>
      )}
      <div className="ml-auto">
        <SaveIndicator state={saveState} />
      </div>
    </div>
  )
}

function InlineField({
  label,
  value,
  onSave,
}: {
  label: string
  value: string
  onSave: (v: string) => Promise<unknown>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  async function handleBlur() {
    setEditing(false)
    if (draft.trim() && draft !== value) await onSave(draft.trim())
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          className="border-b border-primary bg-transparent text-xs font-semibold outline-none"
        />
      </div>
    )
  }

  return (
    <div
      className="group flex cursor-pointer flex-col gap-0.5"
      onClick={() => setEditing(true)}
    >
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="border-b border-dashed border-muted-foreground/40 font-semibold transition-colors group-hover:border-foreground/60">
        {draft}
      </span>
    </div>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null
  return (
    <span
      className={cn(
        'text-[10px]',
        state === 'saving' && 'text-muted-foreground',
        state === 'saved' && 'text-emerald-600 dark:text-emerald-400',
        state === 'error' && 'text-destructive',
      )}
    >
      {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Save failed'}
    </span>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/profile/_components/ExperienceFrontmatter.tsx
git commit -m "feat: add ExperienceFrontmatter inline-editable metadata strip"
```

---

## Task 7: ActivitiesTray component

**Files:**
- Create: `src/app/dashboard/profile/_components/ActivitiesTray.tsx`

Collapsible tray at the bottom of the note editor. Shows activity counts when collapsed. Expands to show inline add/edit/delete forms. Replaces the `ActivityManageDialog` for the workspace flow.

- [ ] **Step 1: Create the component**

Create `src/app/dashboard/profile/_components/ActivitiesTray.tsx`:

```typescript
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  createActivity, updateActivity, deleteActivity,
} from '@/modules/profile/actions'
import { RoleActivityKind } from '@/app/types/profile'
import type { RoleActivity, RoleActivityKindType } from '@/app/types/profile'
import { cn } from '@/lib/utils'

type Props = {
  experienceId: string
  initialActivities: RoleActivity[]
}

export function ActivitiesTray({ experienceId, initialActivities }: Props) {
  const [activities, setActivities] = useState(initialActivities)
  const [expanded, setExpanded] = useState(false)
  const [formVisible, setFormVisible] = useState(false)
  const [editing, setEditing] = useState<RoleActivity | null>(null)
  const [kind, setKind] = useState<RoleActivityKindType>(RoleActivityKind.Responsibility)
  const [description, setDescription] = useState('')
  const [impact, setImpact] = useState('')

  const responsibilities = activities.filter(a => a.kind === RoleActivityKind.Responsibility)
  const achievements = activities.filter(a => a.kind === RoleActivityKind.Achievement)

  function openAdd() {
    setEditing(null)
    setKind(RoleActivityKind.Responsibility)
    setDescription('')
    setImpact('')
    setFormVisible(true)
    setExpanded(true)
  }

  function openEdit(a: RoleActivity) {
    setEditing(a)
    setKind(a.kind)
    setDescription(a.description)
    setImpact(a.impact ?? '')
    setFormVisible(true)
  }

  function closeForm() {
    setFormVisible(false)
    setEditing(null)
  }

  async function handleSave() {
    if (!description.trim()) return
    const data = { kind, description: description.trim(), impact: impact.trim() || undefined }
    try {
      if (editing) {
        const updated = await updateActivity(editing.id, data)
        setActivities(prev =>
          prev.map(a => a.id === editing.id ? updated as unknown as RoleActivity : a)
        )
      } else {
        const created = await createActivity(experienceId, data)
        setActivities(prev => [...prev, created as unknown as RoleActivity])
      }
      closeForm()
    } catch {}
  }

  async function handleDelete(id: string) {
    const prev = activities
    setActivities(prev => prev.filter(a => a.id !== id))
    try { await deleteActivity(id) } catch { setActivities(prev) }
  }

  return (
    <div className="shrink-0 border-t">
      {/* Header row — always visible */}
      <div
        className="flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors hover:bg-muted/50"
        onClick={() => setExpanded(v => !v)}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Activities
        </span>
        {responsibilities.length > 0 && (
          <span className="rounded bg-green-100 px-1.5 py-0.5 text-[9px] font-bold text-green-800 dark:bg-green-900/40 dark:text-green-400">
            {responsibilities.length}R
          </span>
        )}
        {achievements.length > 0 && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-400">
            {achievements.length}A
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <Link
            href={`/dashboard/profile/experience/${experienceId}`}
            className="text-[10px] text-primary/70 hover:text-primary"
            onClick={e => e.stopPropagation()}
          >
            ✦ Extract
          </Link>
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="space-y-0.5 px-3 pb-3">
          {activities.map(a => (
            <ActivityRow
              key={a.id}
              activity={a}
              onEdit={() => openEdit(a)}
              onDelete={() => handleDelete(a.id)}
            />
          ))}

          {activities.length === 0 && !formVisible && (
            <p className="py-2 text-center text-xs text-muted-foreground">No activities yet.</p>
          )}

          {formVisible ? (
            <div className="mt-2 space-y-2 rounded-md border p-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">
                  {editing ? 'Edit Activity' : 'New Activity'}
                </span>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={closeForm}>
                  <X size={11} />
                </Button>
              </div>
              <Select value={kind} onValueChange={v => setKind(v as RoleActivityKindType)}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={RoleActivityKind.Responsibility}>Responsibility</SelectItem>
                  <SelectItem value={RoleActivityKind.Achievement}>Achievement</SelectItem>
                </SelectContent>
              </Select>
              <Textarea
                rows={2}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What did you do?"
                className="text-xs"
              />
              <Input
                value={impact}
                onChange={e => setImpact(e.target.value)}
                placeholder="Measurable outcome (optional)"
                className="h-7 text-xs"
              />
              <div className="flex justify-end gap-1">
                <Button variant="secondary" size="sm" className="h-6 text-xs" onClick={closeForm}>
                  Cancel
                </Button>
                <Button size="sm" className="h-6 text-xs" onClick={handleSave}>
                  {editing ? 'Save' : 'Add'}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-6 w-full gap-1 text-xs"
              onClick={openAdd}
            >
              <Plus size={10} /> Add Activity
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function ActivityRow({
  activity,
  onEdit,
  onDelete,
}: {
  activity: RoleActivity
  onEdit: () => void
  onDelete: () => void
}) {
  const isAchievement = activity.kind === RoleActivityKind.Achievement
  return (
    <div className="group flex items-start gap-1.5 rounded px-1 py-1 hover:bg-muted/50">
      <div
        className={cn(
          'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
          isAchievement ? 'bg-amber-400' : 'bg-green-400',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-relaxed">{activity.description}</p>
        {activity.impact && (
          <p className="text-[10px] text-muted-foreground">↳ {activity.impact}</p>
        )}
      </div>
      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onEdit} aria-label="Edit activity">
          <Pencil size={9} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 hover:text-destructive"
          onClick={onDelete}
          aria-label="Delete activity"
        >
          <Trash2 size={9} />
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/profile/_components/ActivitiesTray.tsx
git commit -m "feat: add ActivitiesTray collapsible inline activities component"
```

---

## Task 8: ProjectsPanel component

**Files:**
- Create: `src/app/dashboard/profile/_components/ProjectsPanel.tsx`

Narrow 110px panel on the right edge of the centre column. Lists projects linked to the active experience. Handles create and delete inline.

- [ ] **Step 1: Create the component**

Create `src/app/dashboard/profile/_components/ProjectsPanel.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createProject, deleteProject } from '@/modules/profile/actions'
import type { Project } from '@/app/types/profile'
import { cn } from '@/lib/utils'

type Props = {
  experienceId: string
  initialProjects: Project[]
  selectedProjectId: string | null
  onSelect: (projectId: string) => void
  onProjectCreated: (project: Project) => void
}

export function ProjectsPanel({
  experienceId,
  initialProjects,
  selectedProjectId,
  onSelect,
  onProjectCreated,
}: Props) {
  const [projects, setProjects] = useState(initialProjects)
  const [addingNew, setAddingNew] = useState(false)
  const [newName, setNewName] = useState('')

  async function handleCreate() {
    if (!newName.trim()) return
    try {
      const created = await createProject({
        name: newName.trim(),
        description: '',
        experienceId,
      })
      const project = created as unknown as Project
      setProjects(prev => [...prev, project])
      setAddingNew(false)
      setNewName('')
      onProjectCreated(project)
      onSelect(created.id)
    } catch {}
  }

  async function handleDelete(id: string) {
    const prev = projects
    setProjects(p => p.filter(p => p.id !== id))
    try { await deleteProject(id) } catch { setProjects(prev) }
  }

  return (
    <div className="flex w-[110px] shrink-0 flex-col border-l">
      <div className="flex items-center justify-between border-b px-2 py-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Projects
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-4 w-4"
          onClick={() => setAddingNew(true)}
          aria-label="Add project"
        >
          <Plus size={10} />
        </Button>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto p-1.5">
        {projects.map(project => (
          <div
            key={project.id}
            className={cn(
              'group relative cursor-pointer rounded px-1.5 py-1 text-[11px] leading-snug transition-colors',
              selectedProjectId === project.id
                ? 'border border-emerald-300 bg-emerald-50 font-semibold text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                : 'border border-transparent text-muted-foreground hover:bg-muted',
            )}
            onClick={() => onSelect(project.id)}
          >
            <span className="block break-words pr-4">{project.name}</span>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0.5 top-0.5 h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
              onClick={e => { e.stopPropagation(); void handleDelete(project.id) }}
              aria-label={`Delete ${project.name}`}
            >
              <Trash2 size={8} />
            </Button>
          </div>
        ))}

        {addingNew && (
          <div className="space-y-1">
            <Input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void handleCreate()
                if (e.key === 'Escape') { setAddingNew(false); setNewName('') }
              }}
              placeholder="Project name"
              className="h-6 px-1.5 text-[11px]"
            />
            <div className="flex gap-1">
              <Button size="sm" className="h-5 flex-1 text-[10px]" onClick={() => void handleCreate()}>
                Add
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-5 flex-1 text-[10px]"
                onClick={() => { setAddingNew(false); setNewName('') }}
              >
                ✕
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/profile/_components/ProjectsPanel.tsx
git commit -m "feat: add ProjectsPanel experience-linked projects list component"
```

---

## Task 9: ExperienceWorkspace orchestrator

**Files:**
- Modify: `src/app/dashboard/profile/_components/Experience.tsx` — export `ExperienceDialog`
- Create: `src/app/dashboard/profile/_components/ExperienceWorkspace.tsx`

- [ ] **Step 1: Export ExperienceDialog from Experience.tsx**

Open `src/app/dashboard/profile/_components/Experience.tsx`. Find `function ExperienceDialog` and change it to `export function ExperienceDialog`.

The current line is:
```typescript
function ExperienceDialog({
```

Change to:
```typescript
export function ExperienceDialog({
```

- [ ] **Step 2: Create ExperienceWorkspace**

Create `src/app/dashboard/profile/_components/ExperienceWorkspace.tsx`:

```typescript
'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useWorkspaceContext } from '@/lib/context/page-context'
import { buildProfileSummary } from '@/lib/profile-summary'
import {
  updateExperienceNotes,
  updateProjectNotes,
  createExperience,
} from '@/modules/profile/actions'
import type { FullProfile, Project } from '@/app/types/profile'
import { NoteEditor } from './NoteEditor'
import type { SaveState } from './NoteEditor'
import { ExperienceFrontmatter } from './ExperienceFrontmatter'
import { ActivitiesTray } from './ActivitiesTray'
import { ProjectsPanel } from './ProjectsPanel'
import { ExperienceDialog } from './Experience'

type ActiveContext =
  | { type: 'experience' }
  | { type: 'project'; projectId: string }

type Props = {
  profile: FullProfile
}

export function ExperienceWorkspace({ profile }: Props) {
  const router = useRouter()
  const [experiences, setExperiences] = useState(profile.experiences)
  const [allProjects, setAllProjects] = useState(profile.projects)
  const [selectedExperienceId, setSelectedExperienceId] = useState(
    profile.experiences[0]?.id ?? '',
  )
  const [activeContext, setActiveContext] = useState<ActiveContext>({ type: 'experience' })
  const [addOpen, setAddOpen] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')

  const selectedExperience = experiences.find(e => e.id === selectedExperienceId)
  const experienceProjects = allProjects.filter(
    p => p.experienceId === selectedExperienceId,
  )
  const selectedProject =
    activeContext.type === 'project'
      ? allProjects.find(p => p.id === activeContext.projectId) ?? null
      : null

  const profileSummary = useMemo(() => buildProfileSummary(profile), []) // eslint-disable-line react-hooks/exhaustive-deps

  useWorkspaceContext({
    type: 'profile',
    profileSummary,
    activeExperienceId: selectedExperienceId || undefined,
    activeExperienceName: selectedExperience
      ? `${selectedExperience.role} at ${selectedExperience.company}`
      : undefined,
  })

  function selectExperience(id: string) {
    setSelectedExperienceId(id)
    setActiveContext({ type: 'experience' })
    setSaveState('idle')
  }

  function selectProject(projectId: string) {
    setActiveContext({ type: 'project', projectId })
    setSaveState('idle')
  }

  async function handleAddExperience(data: Parameters<typeof createExperience>[0]) {
    setAddOpen(false)
    const created = await createExperience(data)
    setExperiences(prev => [created as unknown as typeof prev[0], ...prev])
    selectExperience(created.id)
    router.refresh()
  }

  function handleProjectCreated(project: Project) {
    setAllProjects(prev => [...prev, project])
  }

  // Derive note content and save action from active context
  const noteKey =
    selectedExperienceId +
    '-' +
    (activeContext.type === 'project' ? activeContext.projectId : 'exp')

  const noteContent =
    activeContext.type === 'project'
      ? (selectedProject?.notes ?? '')
      : (selectedExperience?.summary ?? '')

  const noteSave =
    activeContext.type === 'project'
      ? (content: string) => updateProjectNotes(activeContext.projectId, content)
      : (content: string) => updateExperienceNotes(selectedExperienceId, content)

  const notePlaceholder =
    activeContext.type === 'project'
      ? 'Click to start writing about this project…'
      : 'Click to start writing about this role…'

  if (experiences.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border">
        <p className="text-sm text-muted-foreground">No experience added yet.</p>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus size={13} className="mr-1" /> Add Experience
        </Button>
        {addOpen && (
          <ExperienceDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            onSave={handleAddExperience}
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border">
      {/* Tab bar */}
      <div className="flex shrink-0 overflow-x-auto border-b bg-muted/50">
        {experiences.map(exp => (
          <button
            key={exp.id}
            type="button"
            onClick={() => selectExperience(exp.id)}
            className={cn(
              'whitespace-nowrap border-b-2 px-3 py-2 text-xs transition-colors',
              exp.id === selectedExperienceId
                ? '-mb-px border-primary bg-background font-semibold text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {exp.company} · {new Date(exp.startDate).getFullYear()}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="ml-auto whitespace-nowrap px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
        >
          + Add
        </button>
      </div>

      {/* Frontmatter */}
      {selectedExperience && (
        <ExperienceFrontmatter
          experience={selectedExperience}
          saveState={saveState}
          projectName={selectedProject?.name}
          onBack={() => setActiveContext({ type: 'experience' })}
        />
      )}

      {/* Main body: note editor + projects panel */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Note + activities column */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <NoteEditor
            key={noteKey}
            initialContent={noteContent}
            onSave={noteSave}
            onSaveStateChange={setSaveState}
            placeholder={notePlaceholder}
            className="flex-1"
          />
          {selectedExperience && (
            <ActivitiesTray
              experienceId={selectedExperienceId}
              initialActivities={selectedExperience.activities}
            />
          )}
        </div>

        {/* Projects panel */}
        {selectedExperience && (
          <ProjectsPanel
            experienceId={selectedExperienceId}
            initialProjects={experienceProjects}
            selectedProjectId={
              activeContext.type === 'project' ? activeContext.projectId : null
            }
            onSelect={selectProject}
            onProjectCreated={handleProjectCreated}
          />
        )}
      </div>

      {addOpen && (
        <ExperienceDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          onSave={handleAddExperience}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/profile/_components/Experience.tsx \
        src/app/dashboard/profile/_components/ExperienceWorkspace.tsx
git commit -m "feat: add ExperienceWorkspace 3-pane inline editor orchestrator"
```

---

## Task 10: Page refactor — 3-column layout

**Files:**
- Modify: `src/app/dashboard/profile/page.tsx`

Replace the 2-column `flex` layout with a 3-column CSS grid. Left column: Contact + ProfileSummaryCard. Centre column: ExperienceWorkspace. Right column: existing LeftRail.

- [ ] **Step 1: Rewrite page.tsx**

Replace the entire `src/app/dashboard/profile/page.tsx` with:

```typescript
import { ContentContainer } from "@/app/components/ContentContainer"
import { getFullProfile } from "@/modules/profile/queries"
import { ContactBlock } from "./_components/Contact"
import { ProfileHeader } from "./_components/ProfileHeader"
import { LeftRail } from "./_components/LeftRail"
import { ProfileSummaryCard } from "./_components/ProfileSummaryCard"
import { ExperienceWorkspace } from "./_components/ExperienceWorkspace"
import { ProjectBlock } from "./_components/ProjectBlock"
import { getLLMConfigStatus } from "@/modules/llm/client"
import { requireProfile } from "@/lib/session"

export default async function Page() {
  const { profile: sessionProfile } = await requireProfile()
  const [profile, { configured: hasLLMKey }] = await Promise.all([
    getFullProfile(),
    getLLMConfigStatus(sessionProfile.id),
  ])

  const currentYear = new Date().getFullYear()
  const earliestYear =
    profile.experiences.length > 0
      ? Math.min(
          ...profile.experiences.map(e => new Date(e.startDate).getFullYear()),
        )
      : currentYear - 10
  const careerYears = Math.max(currentYear - earliestYear, 1)

  const contact = {
    phone: profile.phone ?? undefined,
    email: profile.email ?? undefined,
    site: profile.website ?? undefined,
    profile: profile.linkedIn ?? undefined,
    location: profile.location ?? undefined,
  }

  // Profile-level projects (not linked to a specific experience) for the legacy block
  const profileLevelProjects = profile.projects.filter(p => !p.experienceId)

  return (
    <ContentContainer title="Professional Profile" fullWidth>
      <ProfileHeader name={profile.name} headline={profile.headline ?? undefined} />

      {/* 3-column workspace grid */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[256px_1fr_288px]">

        {/* Left column — identity */}
        <aside className="space-y-4 xl:sticky xl:top-6 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
          <ContactBlock contact={contact} />
          <ProfileSummaryCard
            initialSummary={profile.summary}
            hasLLMKey={hasLLMKey}
          />
        </aside>

        {/* Centre column — experience workspace */}
        <div className="flex min-h-[600px] flex-col xl:sticky xl:top-6 xl:h-[calc(100vh-6rem)]">
          <ExperienceWorkspace profile={profile} />
        </div>

        {/* Right column — skills, education, credentials */}
        <aside className="xl:sticky xl:top-6 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
          <LeftRail
            skills={profile.skills}
            tools={profile.tools}
            languages={profile.languages}
            competencies={profile.competencies}
            educations={profile.educations}
            certifications={profile.certifications}
            careerYears={careerYears}
          />
        </aside>
      </div>

      {/* Profile-level projects (not linked to an experience) */}
      {profileLevelProjects.length > 0 && (
        <div className="mt-8">
          <ProjectBlock initial={profileLevelProjects} hasLLMKey={hasLLMKey} />
        </div>
      )}
    </ContentContainer>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Start dev server and verify the layout**

```bash
npm run dev
```

Open `http://localhost:3000/dashboard/profile`. Verify:
- Three columns render on a wide screen (≥1280px)
- Experience tabs show at the top of the centre column
- Clicking a tab switches the experience (frontmatter updates)
- Click the note body → textarea appears, monospace font
- Blur the textarea → renders as markdown
- Activities tray collapses/expands
- Projects panel shows on the right edge of the centre column
- Skills/education/certs appear in the right column
- Contact + profile summary appear in the left column

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/profile/page.tsx
git commit -m "feat: replace 2-column profile layout with 3-column workspace grid"
```

---

## Task 11: CV import enhancement — populate summary from activities

**Files:**
- Modify: `src/modules/profile-import/commit.ts`

When importing a CV, populate `Experience.summary` with a structured markdown note built from the imported activities. This prevents a blank note editor after import.

- [ ] **Step 1: Write the failing test**

The existing test file is `src/modules/profile-import/plan.test.ts`. Add a new test file for the commit summary builder:

Create `src/modules/profile-import/summary-builder.test.ts`:

```typescript
import { expect, test } from 'vitest'
import { buildImportSummary } from './summary-builder'

test('returns empty string when no activities', () => {
  const result = buildImportSummary({
    role: 'Engineer',
    company: 'Acme',
    startDate: new Date('2021-01-01'),
    endDate: null,
    activities: [],
  })
  expect(result).toBe('')
})

test('builds responsibilities section', () => {
  const result = buildImportSummary({
    role: 'Engineer',
    company: 'Acme',
    startDate: new Date('2021-01-01'),
    endDate: null,
    activities: [
      { kind: 'responsibility', description: 'Led platform team' },
      { kind: 'responsibility', description: 'Owned CI/CD pipeline' },
    ],
  })
  expect(result).toContain('## Responsibilities')
  expect(result).toContain('- Led platform team')
  expect(result).toContain('- Owned CI/CD pipeline')
})

test('builds achievements section', () => {
  const result = buildImportSummary({
    role: 'Engineer',
    company: 'Acme',
    startDate: new Date('2021-01-01'),
    endDate: null,
    activities: [
      { kind: 'achievement', description: 'Reduced deploy time 70%' },
    ],
  })
  expect(result).toContain('## Achievements')
  expect(result).toContain('- Reduced deploy time 70%')
  expect(result).not.toContain('## Responsibilities')
})

test('includes both sections when both kinds present', () => {
  const result = buildImportSummary({
    role: 'Engineer',
    company: 'Acme',
    startDate: new Date('2021-01-01'),
    endDate: null,
    activities: [
      { kind: 'responsibility', description: 'Led team' },
      { kind: 'achievement', description: 'Shipped feature' },
    ],
  })
  expect(result).toContain('## Responsibilities')
  expect(result).toContain('## Achievements')
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test -- summary-builder
```

Expected: all 4 tests fail with "Cannot find module './summary-builder'".

- [ ] **Step 3: Create summary-builder module**

Create `src/modules/profile-import/summary-builder.ts`:

```typescript
type Activity = { kind: string; description: string }

type ExperienceInput = {
  role: string
  company: string
  startDate: Date
  endDate: Date | null
  activities: Activity[]
}

export function buildImportSummary(exp: ExperienceInput): string {
  if (exp.activities.length === 0) return ''

  const responsibilities = exp.activities.filter(a => a.kind === 'responsibility')
  const achievements = exp.activities.filter(a => a.kind === 'achievement')

  const sections: string[] = []

  if (responsibilities.length > 0) {
    sections.push('## Responsibilities')
    responsibilities.forEach(a => sections.push(`- ${a.description}`))
  }

  if (achievements.length > 0) {
    sections.push('## Achievements')
    achievements.forEach(a => sections.push(`- ${a.description}`))
  }

  return sections.join('\n')
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test -- summary-builder
```

Expected: all 4 tests pass.

- [ ] **Step 5: Wire into commit.ts**

Open `src/modules/profile-import/commit.ts`. Add the import at the top:

```typescript
import { buildImportSummary } from './summary-builder'
```

Find the `plan.experiences.map(...)` section. The current code is:
```typescript
...plan.experiences.map((e) =>
  prisma.experience.create({
    data: {
      profileId: profile.id,
      company: e.company,
      role: e.role,
      startDate: e.startDate,
      endDate: e.endDate ?? undefined,
      location: e.location ?? undefined,
      remote: e.remote,
      summary: e.summary ?? "",
      tags: "[]",
      activities: {
        create: e.activities.map((a, i) => ({
```

Change `summary: e.summary ?? "",` to:

```typescript
      summary: e.summary || buildImportSummary({
        role: e.role,
        company: e.company,
        startDate: new Date(e.startDate),
        endDate: e.endDate ? new Date(e.endDate) : null,
        activities: e.activities,
      }),
```

- [ ] **Step 6: Run all tests**

```bash
npm run test
```

Expected: all tests pass, including the new summary-builder tests and existing profile-import tests.

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/modules/profile-import/summary-builder.ts \
        src/modules/profile-import/summary-builder.test.ts \
        src/modules/profile-import/commit.ts
git commit -m "feat: populate experience summary from activities on CV import"
```

---

## Final verification

- [ ] **Run the full test suite**

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Start dev server and do a full smoke test**

```bash
npm run dev
```

Test the following flows:
1. Navigate to `/dashboard/profile` — 3-column layout renders
2. Click each experience tab — frontmatter updates, note loads correctly
3. Click the note body — enters edit mode (monospace textarea, autofocused)
4. Type content — autosaves after 1.5s (check DB or watch "Saved" indicator)
5. Blur the textarea — renders as markdown
6. Click a frontmatter field (company/role) — inline input appears, type new value, blur → saves
7. Expand activities tray — shows list, inline add/edit/delete work
8. Click "+" in projects panel — add a project by name
9. Click the project in the panel — editor switches to project note, breadcrumb shows
10. Click "← {company}" breadcrumb — switches back to experience note
11. Open AI coach → coach is aware of active experience context

- [ ] **Commit if any fixes were needed during smoke test, then push**

```bash
git push origin HEAD
```
