# Slate bold theme: implementation plan

Issue: #372 (softer colour system), with #298 (page vs desk contrast).
Direction approved by Devon on 2026-11-15: **Slate bold**. Design files: `docs/design/color-system/`.
Branch: `feat/slate-theme` from `origin/main` (3d5221d). One PR. No database work.

## Goal

Replace today's near-black/near-white neutrals and teal accent with the Slate bold palette in both themes:

- a cool blue-grey background (the "desk") with white or raised paper for documents and cards;
- a navy sidebar in **both** themes;
- a stronger blue accent.

Every text pair must meet WCAG AA. This is a token swap plus the few places that break once the sidebar goes dark. It is not a redesign of any screen.

## Tokens (`src/app/globals.css`)

Replace the values in `:root` and `.dark`. Keep the variable names. Hex values are fine (the file already uses hex).

| Variable | Light | Dark | Role |
|---|---|---|---|
| `--background` | `#E3E9F0` | `#0D131B` | App background / desk |
| `--foreground` | `#0F1825` | `#EFF4F9` | Body text |
| `--card`, `--popover` | `#FFFFFF` | `#18212C` | Paper: cards, documents, dialogs, menus |
| `--card-foreground`, `--popover-foreground` | `#0F1825` | `#EFF4F9` | |
| `--primary`, `--ring` | `#1C5DA6` | `#6DB1FF` | Actions, links, active tab, focus |
| `--primary-foreground` | `#FFFFFF` | `#08131F` | |
| `--secondary`, `--muted` | `#E0E7EF` | `#1F2935` | Quiet fills, toolbars, code |
| `--secondary-foreground`, `--accent-foreground` | `#0F1825` | `#EFF4F9` | |
| `--muted-foreground` | `#4A5869` | `#A5B2C1` | Secondary text |
| `--accent` | `#DAE3EE` | `#223040` | Hover, selected |
| `--border`, `--input` | `#C5D0DC` | `#303C4B` | |
| `--destructive` | `#B22A33` | `#FF6B72` | |
| `--sidebar` | `#15202D` | `#080C12` | Navy sidebar |
| `--sidebar-foreground` | `#E6EDF5` | `#E2E9F1` | |
| `--sidebar-primary` | `#6DB1FF` | `#6DB1FF` | Light blue: readable on navy in both themes |
| `--sidebar-primary-foreground` | `#08131F` | `#08131F` | |
| `--sidebar-accent` | `#26344A` | `#1D2836` | Selected and hover items |
| `--sidebar-accent-foreground` | `#F2F6FA` | `#EFF4F9` | |
| `--sidebar-border` | `#22303F` | `#1A2430` | |
| `--sidebar-ring` | `#6DB1FF` | `#6DB1FF` | |

**Charts:** today `--chart-1..5` are greys. Replace them with a slate-blue ramp that is distinguishable in both themes.

- Light: `#1C5DA6 #4A86C8 #7FA9D6 #2F4A66 #9AAABB`.
- Dark: `#6DB1FF #3E7FCC #A9CFFF #8F9DAE #4F6176`.
- Check where they are used (2 files) and that adjacent series stay distinct.

**Status tokens (`--status-*`):** keep the hues. Check each against `--card` in both themes where they are used as text or dots (`job-row.tsx`). Darken or lighten only the ones that fail 3:1 as a non-text mark or 4.5:1 as text. Don't widen scope to the ~150 hard-coded Tailwind hue classes elsewhere; those are a follow-up.

## The navy sidebar

The sidebar is now dark in light mode too. Inside it, components that use the general tokens (`text-muted-foreground`, `bg-muted`, `bg-accent`, `border-border`, `bg-background`) would render dark-on-navy.

Fix this at the source: in `globals.css`, scope a re-mapping of the general tokens to the sidebar subtree. The mockup does the same.

```css
[data-slot="sidebar-inner"], [data-slot="sidebar"][data-mobile="true"] {
  --foreground: var(--sidebar-foreground);
  --muted-foreground: <sidebar muted: light #9BAABB, dark #8F9DAE>;
  --muted: var(--sidebar-accent);
  --accent: var(--sidebar-accent);
  --accent-foreground: var(--sidebar-accent-foreground);
  --border: var(--sidebar-border);
  --input: var(--sidebar-border);
  --background: var(--sidebar);
  --primary: var(--sidebar-primary);
  --primary-foreground: var(--sidebar-primary-foreground);
  --ring: var(--sidebar-ring);
}
```

- Add a `--sidebar-muted-foreground` token for the muted value, defined in both themes.
- Confirm the actual `data-slot`/`data-sidebar` attributes in `src/components/ui/sidebar.tsx`, including the mobile Sheet variant, and use the correct selectors.
- Dropdown menus and popovers opened from the sidebar are portaled outside the subtree, so they keep the paper tokens. Verify this.
- Check `src/components/app-sidebar.tsx` (the account block uses `bg-muted`, the active-jobs empty state uses `text-muted-foreground`, and the `bg-violet-500` badge) and the collapsed (icon) state.
- Check the mobile top bar (`src/components/shell/mobile-top-bar.tsx`) and the Coach panel. The Coach is not part of the sidebar: it stays on paper/background tokens.

## Desk and paper (#298)

With `--background` now visibly tinted and `--card` white, most cards already read as paper.

- **CV builder:** `cv-builder/[id]/_components/cv-editor.tsx:381` uses `bg-muted/30` behind the CV page. Change it to `bg-background` (the desk). The CV page itself stays white in both themes, as it is today, because it is a print preview.
- **Writing Desk, profile notes and interview prep:** make sure the document column sits on `bg-card`, with the surrounding area on `bg-background`. Change only the obvious wrapper classes. Don't restructure layouts.
- **Leave alone:** `pdf/page.tsx` (`bg-gray-100`) and `pdf-extract.tsx` are print and extraction outputs. The dialog overlays (`bg-black/10`) are fine.

## Small fixes

- Chat code blocks use `bg-black/10 dark:bg-white/10` (`chat-message.tsx`). Switch them to `bg-current/10` so the chip tints from each bubble's text colour. (`bg-muted` was the first idea; review found it unreadable in user bubbles and invisible in assistant bubbles.)
- `brand/icon.tsx`: the gradient (teal → blue) and the teal glow `#4FB3BF`. Change the glow to the new primary blue `#6DB1FF`. Keep the gradient; it already ends in blue.
- If the app sets a `themeColor` or other meta colours, update them. None were found by grep; double-check `layout.tsx`.

## Out of scope

- The CV/cover-letter PDF themes (#296).
- The ~150 hard-coded Tailwind hue classes.
- Typography.
- Layout changes.

## Verification

- **Checks:** `npm run typecheck`, `npm run lint` (no new warnings), and the full test suite. Update or fix any snapshot or test that asserts old colour values.
- **Contrast:** write a small script (in the scratchpad, not committed) that reads both token sets out of `globals.css` and checks these AA pairs:
  - foreground on background, card and muted: 4.5;
  - muted-foreground on background, card and muted: 4.5;
  - primary-foreground on primary: 4.5;
  - primary on card: 4.5;
  - destructive on card: 4.5;
  - sidebar-foreground and sidebar muted on sidebar and sidebar-accent: 4.5;
  - ring on background: 3.
  Report the table in the PR.
- **Browser:** run the dev server against the local database (never production). Look at these screens in light and dark:
  - dashboard;
  - applications list and a job workspace (description, CV document, Coach open);
  - profile;
  - Writing Desk;
  - settings;
  - a dialog;
  - the sidebar expanded, collapsed, and on mobile (390px).

  Confirm that the sidebar has no dark-on-navy text, that focus rings show, and that the active nav item is clear. Put screenshots in the PR if you can.

## Delivery

- Commit the design files under `docs/design/color-system/` (already copied in) together with the code.
- PR title: `feat(theme): Slate bold colour system (#372)`. The body covers:
  - the token table;
  - the contrast table;
  - what was checked in the browser;
  - follow-ups (hard-coded hue classes, PDF themes #296).
- Don't merge.
