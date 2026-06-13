# Profile Projects + Markdown Rendering Bugs — Design Spec

**Date:** 2026-06-13
**Issues:** #206, #191
**Status:** Approved

---

## Bug #206 — Projects not scoped to active experience

### Root Cause

`ProjectsPanel` initialises its project list via `useState(initialProjects)`. React only uses that value on first mount — subsequent renders with a different `initialProjects` prop (triggered by switching experience tabs) are silently ignored. The stale list from the first-mounted experience persists.

A secondary gap: `handleDelete` in `ProjectsPanel` prunes the local list but never notifies `ExperienceWorkspace`, so deleted projects remain in `allProjects` and can reappear if the panel remounts.

### Fix — Lift project list state to `ExperienceWorkspace`

`ExperienceWorkspace` already owns `allProjects: Project[]` and derives `experienceProjects` via filter on every render. The fix makes `ProjectsPanel` a controlled component: it receives its list as a prop and calls parent callbacks for mutations.

**`ProjectsPanel` changes:**

- Remove `projects: Project[]` from local `useState`
- Rename prop `initialProjects: Project[]` → `projects: Project[]` (reflects controlled semantics)
- Add prop `onProjectDeleted: (projectId: string) => void`
- `handleCreate`: remove `setProjects(prev => [...prev, project])` — parent handles it via the existing `onProjectCreated` callback (already receives a parsed `Project`)
- `handleDelete`: remove optimistic `setProjects`; call `onProjectDeleted(id)` after `deleteProject` resolves; roll back not needed (parent removes from `allProjects`)
- All JSX that renders the list reads from the `projects` prop directly

**`ExperienceWorkspace` changes:**

- Add `handleProjectDeleted(projectId: string)`: `setAllProjects(prev => prev.filter(p => p.id !== projectId))`
- Update `<ProjectsPanel>` call: rename `initialProjects=` → `projects=`, add `onProjectDeleted={handleProjectDeleted}`

### Files

| File | Change |
|------|--------|
| `src/app/dashboard/profile/_components/ProjectsPanel.tsx` | Remove local state, add `onProjectDeleted` prop, update mutation handlers |
| `src/app/dashboard/profile/_components/ExperienceWorkspace.tsx` | Add `handleProjectDeleted`, update `<ProjectsPanel>` props |

---

## Bug #191 — Job description renders raw markdown in CV builder and Cover Letter panels

### Root Cause

Both panels use `className="prose prose-xs ..."`. `prose-xs` is not a valid Tailwind Typography size (valid sizes: `prose-sm` through `prose-2xl`). The class is silently ignored, leaving markdown unstyled — raw asterisks and symbols show through.

A shared `MarkdownProse` component already exists at `src/app/dashboard/job-applications/view/[id]/_components/markdown-prose.tsx`. It uses `prose-sm` (valid) with explicit component overrides for all block elements. It's currently used only in the job-application detail view because its path is too route-specific to discover.

### Fix — Move `MarkdownProse` to shared components, use it in both panels

**Move the component:**
`src/app/dashboard/job-applications/view/[id]/_components/markdown-prose.tsx`
→ `src/components/ui/markdown-prose.tsx`

**Update existing import sites** (two files that currently import from the old path):
- `src/app/dashboard/job-applications/view/[id]/_components/job-details-card.tsx`
- `src/app/dashboard/job-applications/view/[id]/_components/job-fit.tsx`

**Replace broken inline divs:**

In `src/app/dashboard/cv-builder/[id]/_components/cv-editor.tsx` (~line 344), replace:
```tsx
<div className="prose prose-xs dark:prose-invert max-w-none text-xs [&_*]:text-muted-foreground [&_li]:my-0">
  <ReactMarkdown remarkPlugins={[remarkGfm]}>{cv.jobApplication.jobDescription}</ReactMarkdown>
</div>
```
With:
```tsx
<MarkdownProse content={cv.jobApplication.jobDescription} />
```
(And remove the now-unused `ReactMarkdown`/`remarkGfm` imports if they're no longer used elsewhere in the file.)

In `src/app/dashboard/cover-letters/[id]/_components/cover-letter-workspace.tsx`, replace both inline prose divs (two sites: inside the `analysis` branch and the no-analysis fallback, both rendering `job.jobDescription`) with `<MarkdownProse content={job.jobDescription} />`.
(ReactMarkdown/remarkGfm imports remain — they're used for the cover letter preview textarea render.)

### Files

| File | Change |
|------|--------|
| `src/components/ui/markdown-prose.tsx` | New location — move from job-applications route |
| `src/app/dashboard/job-applications/view/[id]/_components/markdown-prose.tsx` | Delete |
| `src/app/dashboard/job-applications/view/[id]/_components/job-details-card.tsx` | Update import path |
| `src/app/dashboard/job-applications/view/[id]/_components/job-fit.tsx` | Update import path |
| `src/app/dashboard/cv-builder/[id]/_components/cv-editor.tsx` | Replace inline prose div with `<MarkdownProse>` |
| `src/app/dashboard/cover-letters/[id]/_components/cover-letter-workspace.tsx` | Replace two inline prose divs with `<MarkdownProse>` |

---

## Out of Scope

- Profile-level projects (those with `experienceId = null`) rendered in `ProjectBlock` below the grid — this component is separate and unaffected
- Any other markdown rendering locations beyond the two job-description panels
- Styling customisation of `MarkdownProse` — `prose-sm` is sufficient; the user just needs markdown to render
