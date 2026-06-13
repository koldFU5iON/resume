# Profile Projects + Markdown Rendering Bugs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs — projects in the profile side panel not scoping to the active experience tab (#206), and job descriptions in CV builder and cover letter panels rendering raw markdown instead of styled HTML (#191).

**Architecture:** #191 is a two-step fix: move the existing `MarkdownProse` component from a route-specific folder to `src/components/ui/`, then replace the broken `prose-xs` inline divs in two panels. #206 is a state-lift: `ProjectsPanel` drops its own project list state and becomes a controlled component driven by `ExperienceWorkspace`, which already owns the full project list and derives the per-experience filter on every render.

**Tech Stack:** Next.js 16 App Router, React, ReactMarkdown + remark-gfm, Tailwind CSS, Prisma 7, TypeScript strict

---

## Bug #191 — MarkdownProse shared component

### Task 1: Move MarkdownProse to shared components

**Files:**
- Create: `src/components/ui/markdown-prose.tsx`
- Delete: `src/app/dashboard/job-applications/view/[id]/_components/markdown-prose.tsx`
- Modify: `src/app/dashboard/job-applications/view/[id]/_components/job-details-card.tsx:5`
- Modify: `src/app/dashboard/job-applications/view/[id]/_components/job-fit.tsx` (import line)

- [ ] **Step 1: Create the shared component**

Create `src/components/ui/markdown-prose.tsx` with this exact content (moved verbatim from the old location):

```tsx
'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

const components: Components = {
  // Remap heading levels so markdown h1/h2 can't override the page h1
  h1: ({ children }) => <h3 className="text-base font-semibold mt-5 mb-2 text-foreground">{children}</h3>,
  h2: ({ children }) => <h4 className="text-sm font-semibold mt-4 mb-1.5 text-foreground">{children}</h4>,
  h3: ({ children }) => <h5 className="text-sm font-medium mt-3 mb-1 text-foreground">{children}</h5>,
  p: ({ children }) => <p className="text-sm leading-relaxed mb-3 text-foreground last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="text-sm leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:no-underline">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-4 text-muted-foreground italic my-3">
      {children}
    </blockquote>
  ),
  code: ({ children, className, ...props }) => (
    <code
      className={`bg-muted px-1.5 py-0.5 rounded text-xs font-mono ${className ?? ''}`}
      {...props}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="bg-muted rounded-lg p-4 my-3 overflow-x-auto text-xs font-mono">
      {children}
    </pre>
  ),
  hr: () => <hr className="border-border my-4" />,
}

export function MarkdownProse({ content }: { content: string }) {
  return (
    <div className="max-w-[72ch]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
```

- [ ] **Step 2: Update job-details-card.tsx import**

In `src/app/dashboard/job-applications/view/[id]/_components/job-details-card.tsx`, change line 5:

```ts
// Before
import { MarkdownProse } from "./markdown-prose"

// After
import { MarkdownProse } from "@/components/ui/markdown-prose"
```

- [ ] **Step 3: Update job-fit.tsx import**

Find the MarkdownProse import in `src/app/dashboard/job-applications/view/[id]/_components/job-fit.tsx` and change it to:

```ts
import { MarkdownProse } from "@/components/ui/markdown-prose"
```

- [ ] **Step 4: Delete the old file**

```bash
rm "src/app/dashboard/job-applications/view/[id]/_components/markdown-prose.tsx"
```

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/markdown-prose.tsx
git add "src/app/dashboard/job-applications/view/[id]/_components/job-details-card.tsx"
git add "src/app/dashboard/job-applications/view/[id]/_components/job-fit.tsx"
git rm "src/app/dashboard/job-applications/view/[id]/_components/markdown-prose.tsx"
git commit -m "refactor: move MarkdownProse to src/components/ui for shared use"
```

---

### Task 2: Fix markdown rendering in CV builder job panel

**Files:**
- Modify: `src/app/dashboard/cv-builder/[id]/_components/cv-editor.tsx` (~lines 341–349)

- [ ] **Step 1: Add MarkdownProse import**

In `src/app/dashboard/cv-builder/[id]/_components/cv-editor.tsx`, add this import near the top with the other component imports:

```ts
import { MarkdownProse } from '@/components/ui/markdown-prose'
```

- [ ] **Step 2: Replace the broken inline div**

Find the job description rendering block (~line 341). It currently looks like:

```tsx
{cv.jobApplication.jobDescription && (
  <div className="mt-3">
    <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
      Job Description
    </p>
    <div className="prose prose-xs dark:prose-invert max-w-none text-xs [&_*]:text-muted-foreground [&_li]:my-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{cv.jobApplication.jobDescription}</ReactMarkdown>
    </div>
  </div>
)}
```

Replace with:

```tsx
{cv.jobApplication.jobDescription && (
  <div className="mt-3">
    <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
      Job Description
    </p>
    <MarkdownProse content={cv.jobApplication.jobDescription} />
  </div>
)}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/dashboard/cv-builder/[id]/_components/cv-editor.tsx"
git commit -m "fix: render job description as markdown in CV builder job panel (closes #191 partial)"
```

---

### Task 3: Fix markdown rendering in Cover Letter job context panel

**Files:**
- Modify: `src/app/dashboard/cover-letters/[id]/_components/cover-letter-workspace.tsx` (two sites in the job context panel)

- [ ] **Step 1: Add MarkdownProse import**

In `src/app/dashboard/cover-letters/[id]/_components/cover-letter-workspace.tsx`, add with the other component imports:

```ts
import { MarkdownProse } from '@/components/ui/markdown-prose'
```

- [ ] **Step 2: Replace both broken inline divs**

In the job context panel section (`panelOpen && job &&`), there are two sites that render `job.jobDescription` with the broken `prose-xs` wrapper.

**Site 1** — inside the `analysis` branch (renders `job.jobDescription` when AI analysis is present). Find:

```tsx
<div className="prose prose-xs dark:prose-invert max-w-none text-xs [&_*]:text-muted-foreground [&_li]:my-0">
  <ReactMarkdown remarkPlugins={[remarkGfm]}>{job.jobDescription}</ReactMarkdown>
</div>
```

Replace with:

```tsx
<MarkdownProse content={job.jobDescription} />
```

**Site 2** — the no-analysis fallback branch. Find the identical pattern:

```tsx
<div className="prose prose-xs dark:prose-invert max-w-none text-xs [&_*]:text-muted-foreground [&_li]:my-0">
  <ReactMarkdown remarkPlugins={[remarkGfm]}>{job.jobDescription}</ReactMarkdown>
</div>
```

Replace with:

```tsx
<MarkdownProse content={job.jobDescription} />
```

Note: leave the existing `ReactMarkdown` and `remarkGfm` imports in place — they are still used for the cover letter preview textarea renderer elsewhere in this file.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/dashboard/cover-letters/[id]/_components/cover-letter-workspace.tsx"
git commit -m "fix: render job description as markdown in cover letter job panel (closes #191)"
```

---

## Bug #206 — Projects scoped to active experience

### Task 4: Lift project list state to ExperienceWorkspace

**Files:**
- Modify: `src/app/dashboard/profile/_components/ProjectsPanel.tsx`
- Modify: `src/app/dashboard/profile/_components/ExperienceWorkspace.tsx`

- [ ] **Step 1: Update ProjectsPanel props type**

In `src/app/dashboard/profile/_components/ProjectsPanel.tsx`, replace the `Props` type (lines 12–18):

```ts
// Before
type Props = {
  experienceId: string
  initialProjects: Project[]
  selectedProjectId: string | null
  onSelect: (projectId: string) => void
  onProjectCreated: (project: Project) => void
}
```

With:

```ts
// After
type Props = {
  experienceId: string
  projects: Project[]
  selectedProjectId: string | null
  onSelect: (projectId: string) => void
  onProjectCreated: (project: Project) => void
  onProjectDeleted: (projectId: string) => void
}
```

- [ ] **Step 2: Update the component signature and remove local list state**

Replace the function signature and the four `useState` lines (lines 20–30):

```ts
// Before
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
  const [mobileOpen, setMobileOpen] = useState(false)
```

With:

```ts
// After
export function ProjectsPanel({
  experienceId,
  projects,
  selectedProjectId,
  onSelect,
  onProjectCreated,
  onProjectDeleted,
}: Props) {
  const [addingNew, setAddingNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
```

- [ ] **Step 3: Update handleCreate — remove local state mutation**

Replace `handleCreate` (lines 32–53):

```ts
// Before
  async function handleCreate() {
    if (!newName.trim()) return
    try {
      const created = await createProject({
        name: newName.trim(),
        description: '',
        experienceId,
      })
      const project: Project = {
        ...created,
        highlights: JSON.parse(created.highlights ?? '[]') as string[],
        tags: JSON.parse(created.tags ?? '[]') as string[],
      }
      setProjects(prev => [...prev, project])
      setAddingNew(false)
      setNewName('')
      onProjectCreated(project)
      onSelect(created.id)
    } catch {
      toast.error('Failed to create project. Please try again.')
    }
  }
```

With (remove `setProjects` call — parent handles it via `onProjectCreated`):

```ts
// After
  async function handleCreate() {
    if (!newName.trim()) return
    try {
      const created = await createProject({
        name: newName.trim(),
        description: '',
        experienceId,
      })
      const project: Project = {
        ...created,
        highlights: JSON.parse(created.highlights ?? '[]') as string[],
        tags: JSON.parse(created.tags ?? '[]') as string[],
      }
      setAddingNew(false)
      setNewName('')
      onProjectCreated(project)
      onSelect(created.id)
    } catch {
      toast.error('Failed to create project. Please try again.')
    }
  }
```

- [ ] **Step 4: Update handleDelete — remove optimistic local state, use callback**

Replace `handleDelete` (lines 55–59):

```ts
// Before
  async function handleDelete(id: string) {
    const prev = projects
    setProjects(prev => prev.filter(item => item.id !== id))
    try { await deleteProject(id) } catch { setProjects(prev) }
  }
```

With (non-optimistic: server action first, then notify parent):

```ts
// After
  async function handleDelete(id: string) {
    try {
      await deleteProject(id)
      onProjectDeleted(id)
    } catch {
      toast.error('Failed to delete project. Please try again.')
    }
  }
```

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: TypeScript will now error on the `<ProjectsPanel>` call in `ExperienceWorkspace.tsx` because the prop names changed. That's expected — fix it in the next step.

- [ ] **Step 7: Update ExperienceWorkspace to match new props**

In `src/app/dashboard/profile/_components/ExperienceWorkspace.tsx`:

**Add `handleProjectDeleted`** immediately after `handleProjectCreated` (after line 119):

```ts
  function handleProjectDeleted(projectId: string) {
    setAllProjects(prev => prev.filter(p => p.id !== projectId))
  }
```

**Update the `<ProjectsPanel>` call site** (lines 282–290). Replace:

```tsx
          <ProjectsPanel
            experienceId={selectedExperienceId}
            initialProjects={experienceProjects}
            selectedProjectId={
              activeContext.type === 'project' ? activeContext.projectId : null
            }
            onSelect={selectProject}
            onProjectCreated={handleProjectCreated}
          />
```

With:

```tsx
          <ProjectsPanel
            experienceId={selectedExperienceId}
            projects={experienceProjects}
            selectedProjectId={
              activeContext.type === 'project' ? activeContext.projectId : null
            }
            onSelect={selectProject}
            onProjectCreated={handleProjectCreated}
            onProjectDeleted={handleProjectDeleted}
          />
```

- [ ] **Step 8: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/app/dashboard/profile/_components/ProjectsPanel.tsx
git add src/app/dashboard/profile/_components/ExperienceWorkspace.tsx
git commit -m "fix: lift project list state to ExperienceWorkspace so panel scopes to active experience (closes #206)"
```

---

### Task 5: Manual verification

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify #206 — projects scope to active experience**

1. Sign in as `test@example.com` / `password`
2. Navigate to `/dashboard/profile`
3. If no experiences exist, create two
4. Add a project to experience A
5. Switch to experience B — verify the projects panel is empty (not showing experience A's project)
6. Switch back to experience A — verify the project reappears
7. Delete a project — verify it disappears immediately and does not reappear on tab switch

- [ ] **Step 3: Verify #191 — markdown renders in CV builder**

1. Navigate to a CV that has a linked job application with a job description
2. Open the "Job ▸" panel
3. Verify: headers, bold, lists, and other markdown render as styled HTML (not raw `**text**` or `## heading`)

- [ ] **Step 4: Verify #191 — markdown renders in cover letter panel**

1. Navigate to a cover letter linked to a job application
2. Click the "Job ▸" button to open the job context panel
3. Verify: job description markdown renders as styled HTML

---

### Task 6: Create PR

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin HEAD
gh pr create \
  --title "fix: project experience scoping + markdown rendering in job panels (closes #206, #191)" \
  --body "$(cat <<'EOF'
## Summary

**#206 — Projects not scoped to active experience:**
- `ProjectsPanel` was copying `initialProjects` into local state on mount and never syncing when the experience tab changed
- Fix: lift the project list to `ExperienceWorkspace` (already the authoritative owner of `allProjects`). `ProjectsPanel` is now a controlled component — it receives `projects` as a prop and calls `onProjectDeleted` instead of managing its own list
- Bonus: deletes are now reflected in the parent's `allProjects` immediately (previously, deleted projects could reappear on re-mount)

**#191 — Markdown not rendering in job description panels:**
- Both the CV builder and cover letter job panels used `prose-xs`, which is not a valid Tailwind Typography size — silently ignored, leaving raw markdown visible
- Fix: move the existing `MarkdownProse` shared component from a route-specific folder to `src/components/ui/`, and replace the broken inline divs in both panels

## Test plan

- [ ] Switch experience tabs — projects panel shows only projects for the active experience
- [ ] Add a project to one experience — it does not appear in other experience tabs
- [ ] Delete a project — it disappears without needing a page reload
- [ ] CV builder job panel renders markdown (bold, lists, headers) correctly
- [ ] Cover letter job context panel renders markdown correctly
- [ ] `npm run typecheck` passes

Closes #206
Closes #191

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
