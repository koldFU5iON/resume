# Mobile Pass — Design Spec
_Date: 2026-06-17 | Issues: #27, #233, #90_

## Scope

Three targeted fixes across three pages. Listed in implementation order (highest to lowest effort).

---

## 1. Job View Page — Mobile Layout (#233)

**Problem:** `grid-cols-[200px_1fr_1fr]` is a fixed three-column layout with zero responsive breakpoints. On mobile the sidebar and two panes are crammed into ~375px — unusable.

**Approach: JD Primary + Bottom Action Bar + Drawers**

The job description is what users read most on this page. It becomes the primary content; everything else is one tap away.

### Layout structure (mobile only, `md:` breakpoint)

```
┌─────────────────────────┐
│ ← Applications  Details↑│  ← top bar (back link + drawer trigger)
│ Senior Eng · Stripe     │
│ ● Applied  8.4 Strong   │  ← status + fit chips
├─────────────────────────┤
│                         │
│   Job Description       │  ← scrollable, fills remaining height
│   (primary content)     │
│                         │
├─────────────────────────┤
│ 📝Notes  📄CV  ✉️Letter 🎯Prep │  ← sticky bottom action bar
└─────────────────────────┘
```

On `md:` and above the existing three-column grid is unchanged.

### Details drawer

Triggered by "Details ↑" in the top bar. Slides up from the bottom using the existing shadcn/ui `Drawer` (Vaul). Contains the full sidebar content:
- Status dropdown
- Progress
- Applied date / Last updated
- Full fit score card

Height: `max-h-[70dvh]`, scrollable inside.

### Notes drawer

Triggered by the Notes icon in the bottom action bar. Slides up from the bottom.

**Keyboard handling is the critical constraint:** when the soft keyboard opens it consumes ~40–50% of the viewport. The drawer must compress gracefully.

- Drawer height: `max-h-[45dvh]` — enough for a few lines of text + Save above the keyboard
- Textarea: `flex-1 min-h-0` so it compresses rather than overflowing
- "Include in fit" toggle inline in the drawer header (stays visible above keyboard)
- Auto-saves on drawer close (matches existing `JobNotes` debounce behaviour)
- Drag handle + explicit close button

### Bottom action bar

- `position: sticky; bottom: 0` — stays above the keyboard and home indicator
- `padding-bottom: env(safe-area-inset-bottom)` (Tailwind: `pb-safe`) for iPhone notch
- CV / Cover Letter / Prep: navigate to existing routes (same as sidebar links)
- Notes: opens the Notes drawer

### Files to change

| File | Change |
|------|--------|
| `view/[id]/page.tsx` | Wrap grid in responsive container; add mobile layout branch |
| `view/[id]/_components/job-sidebar.tsx` | Wrap content in a `Drawer` for mobile |
| `view/[id]/_components/job-notes-pane.tsx` | Expose as `Drawer` on mobile |
| `view/[id]/_components/job-detail-header.tsx` | Add mobile-specific header with chips + Details trigger |

The desktop layout (three-column grid) is preserved behind the `md:` breakpoint — no regressions.

---

## 2. CV Builder Control Bar (#90)

**Problem:** The control bar has 5–6 text+icon buttons (Regenerate, Download, Chat, ATS Score, Job Panel, Section Rail). On mobile the title already moves to its own row (`sm:hidden` pattern is in place) but the buttons themselves overflow because each has a visible text label.

**Fix: icon-only buttons on mobile**

Wrap each button label in `<span className="hidden sm:inline">`. The icon remains visible at all sizes; the label appears from `sm:` up. No layout changes required — just label visibility.

Buttons affected: Regenerate, Download, AI Chat, ATS Score, Job Panel.

The Download button opens a dropdown — keep as-is, just hide its label on mobile.

### Files to change

| File | Change |
|------|--------|
| `cv-builder/[id]/_components/cv-editor.tsx` | Wrap button labels in `hidden sm:inline` |

---

## 3. Job Applications List (#27)

**Status: largely already done.** The list switches between `JobRowCard` (mobile) and `JobRow` (desktop table) via `isMobile` in `job-group.tsx`. The grid is `hidden md:grid` / `md:hidden`.

**Remaining:** Quick audit of the filter bar (`filter-bar.tsx`) for any overflow on narrow screens. The mobile filter path is at line 330 (`md:hidden`) — verify it renders cleanly at 375px. No structural changes expected; may be CSS-only tweaks.

### Files to check

| File | Action |
|------|--------|
| `job-applications/_components/filter-bar.tsx` | Visual check at 375px; fix any overflow |

---

## Implementation order

1. CV builder label hide (15 min — smallest, zero risk)
2. Filter bar audit (30 min — verify only)
3. Job view mobile layout (the main work — new component structure)

---

## Non-goals

- No changes to desktop layouts on any of these pages
- No new routes or pages
- No changes to job list data fetching

---

## Keyboard / safe area reference

| Unit | Behaviour |
|------|-----------|
| `dvh` | Dynamic — shrinks when soft keyboard opens. Use for drawers. |
| `svh` | Small — smallest viewport (keyboard always assumed open). |
| `vh` | Static — does not respond to keyboard. Avoid for drawers. |
| `env(safe-area-inset-bottom)` | Home indicator padding on iPhone. Tailwind: `pb-safe`. |
