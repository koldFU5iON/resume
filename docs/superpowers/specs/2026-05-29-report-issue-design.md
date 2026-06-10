# Report Issue Feature — Design Spec

**Goal:** Let signed-in users (including the owner) report bugs and ideas from anywhere in the dashboard. Submissions land directly on the GitHub Issues board with no friction.

**Status:** v1 — text only. Screenshot support deferred to v2 (requires Vercel Blob + image hosting).

---

## Entry Point

A `MessageSquareWarning` icon button sits in `SidebarFooter`, left of the user menu chip. One click opens the form. Tooltip reads "Report an issue".

When the sidebar is collapsed to icon-only mode the button remains visible and the tooltip still fires — it follows the same `SidebarMenuButton` tooltip pattern used by all nav items.

---

## Form

Three fields:

### Type (required)
Segmented toggle: `Bug` | `Idea` | `Other`. Defaults to `Bug`.

Maps to GitHub labels:
- Bug → `["bug", "user-reported"]`
- Idea → `["enhancement", "user-reported"]`
- Other → `["user-reported"]`

### Title (required)
Single-line text input. `placeholder="Short description…"`. Submit is disabled until this contains at least one non-whitespace character.

### Description (optional)
Textarea, 3 rows. Placeholder adapts to type:
- Bug → `"Steps to reproduce, or anything else useful…"`
- Idea → `"What problem would this solve?…"`
- Other → `"Any extra context…"`

### Submit
Button label: "Submit report". Shows "Submitting…" while pending.

**Success:** Sonner toast "Issue filed — thanks!" and the form closes and resets.

**Error:** Sonner toast "Failed to submit — try again" with an action link "Open on GitHub" that opens a pre-filled new-issue URL in a new tab (title pre-populated, form not lost).

---

## GitHub Issue Body Format

```
{description — omitted if blank}

---
**Filed from:** {current page URL}
**Submitted:** {ISO 8601 timestamp}
```

Reporter email is intentionally omitted — the issue body is public, so including it would expose personal information.

---

## Responsive UI

| Breakpoint | Component |
|---|---|
| `< md` | shadcn `Drawer` (vaul) — bottom sheet, drag to dismiss |
| `md` and above | shadcn `Dialog` — centered modal |

Both surfaces render the same inner form component. No logic duplication.

---

## Architecture

### `src/modules/feedback/actions.ts`

New module. Single server action:

```ts
'use server'

export async function createFeedbackIssue(
  type: 'bug' | 'idea' | 'other',
  title: string,
  description: string,
  currentUrl: string,
): Promise<{ ok: true } | { ok: false; message: string }>
```

- Calls `requireProfile()` to enforce authentication (email is not embedded in the issue body)
- Validates title is non-empty
- Builds the issue body (description + metadata block)
- `POST https://api.github.com/repos/koldFU5iON/resume/issues`
  - `Authorization: Bearer ${process.env.GITHUB_ISSUE_TOKEN}`
  - `X-GitHub-Api-Version: 2022-11-28`
  - `Content-Type: application/json`
- Returns `{ ok: true }` on 201, `{ ok: false; message }` on any other status or network error
- Token never leaves the server

### `src/app/components/FeedbackDrawer.tsx`

Client component. Owns all form state: `type`, `title`, `description`, `open`, `isPending`.

Renders:
- A `useMediaQuery('(min-width: 768px)')` hook (or Tailwind-class-based approach) to switch between `Dialog` and `Drawer`
- Inner form extracted to a shared `FeedbackForm` sub-component to avoid duplication
- Trigger: a `MessageSquareWarning` icon button exported alongside the drawer, or accepted as a `trigger` prop

### `src/components/app-sidebar.tsx`

`FeedbackDrawer` mounted in `SidebarFooter` to the left of the `UserMenu`. Icon follows existing `SidebarMenuButton` conventions for tooltip and collapse behaviour.

### `src/components/ui/drawer.tsx`

New — installed via `npx shadcn@latest add drawer` (vaul-based).

---

## Environment

```env
# Fine-grained PAT — Issues: Read & Write on koldFU5iON/resume only
GITHUB_ISSUE_TOKEN=""
```

Added to `.env.example` with the comment above. Added to Vercel env vars (Production + Preview scopes) before deploy.

---

## v2 — Screenshots

Deferred. Will require:
- Vercel Blob setup + `@vercel/blob`
- Client-side file input or clipboard paste handler in `FeedbackForm`
- Server action to upload blob and return URL
- Image URL embedded in issue body as `![screenshot](url)`

---

## Acceptance Criteria

- Authenticated users can open the reporter from the sidebar footer on any dashboard page
- Submitting creates a GitHub issue on this repo with the correct label(s) and `user-reported`
- `GITHUB_ISSUE_TOKEN` is never sent to the browser
- Empty/whitespace titles are blocked before submission
- Loading, success, and error states are all communicated clearly
- On mobile: bottom sheet with drag-to-dismiss
- On desktop: centered dialog
- Sidebar icon collapses and tooltip works correctly in icon-only sidebar mode
- Form resets after successful submission
