# Applications on mobile

## Problem

The supplied phone screenshot showed desktop controls wrapping across several rows, small icon targets, and job metadata competing with titles. Bulk actions at the top of a long list also require a return trip after selecting a role.

This change keeps the existing currnt typography, themes, data, actions and desktop table. It changes the mobile hierarchy and the card layout used when the table cannot fit.

## Layout and behavior

- A shorter page header and full-width, touch-sized Active/Archived tabs.
- A clear result count and Add Job action, followed by full-width search.
- One Filters & sort trigger opens a bottom panel. It uses the same status/source/fit options and saved state as desktop, with native view/sort selects, labeled checkbox targets, a result count and Clear filters. Batch Add remains available inside the panel.
- Cards lead with the full role title and wrapping company/location. Status and assessment stay directly accessible. Salary, when present, is visible without opening details.
- More details expands progress, applied/published/updated dates, source, job number, salary tools, notes, missing fields and the original listing. Existing document actions remain in Job actions.
- Text progress replaces the animated dot strip in cards. Missing fields are written out instead of requiring a tiny completeness tooltip.
- Selection has a labeled target. A floating Archive/Deselect region stays above the app footer while scrolling; extra list padding keeps the last row reachable.
- Page controls and primary card actions have at least 44px touch height. Shared editor/menu changes are scoped to mobile or explicit card variants. Batch import gets larger input/button targets too.
- No schema, assessment pipeline or job mutation changes.

## Validation

Checked in the shared Chromium preview against the local app and its existing 14-job fixture, without adding/importing jobs or invoking paid assessments:

- 320px and 390px phone layouts; no horizontal overflow, including expanded card details.
- Native grouping and sorting controls; company starts ascending. Status filtering changed the result count from 14 to 2; clearing restored 14.
- Empty search, Archived empty state, Add Job opening and filter-panel-to-Batch-Add handoff.
- Row selection, deselection, 44px action heights and fixed bulk-action position before/after scrolling.
- 1440px desktop table and hidden mobile controls.
- Light and dark themes.
- 61 applications/completeness tests pass; scoped ESLint and mechanical design scan pass.

The repository typecheck still reports existing errors in `settings/account/_actions.ts` (missing providerId) and `lib/auth.ts` (untyped url). Development logs also report a client-rendered script warning and an `AlphaBanner` hydration mismatch. The unchanged banner initializes visibility from a browser-only localStorage branch, so its initial server/client output differs. These shell issues remain outside this page change.

Physical iOS/Android devices, Safari touch behavior, the on-screen keyboard, populated archive pagination, and live writes/paid assessments were not exercised. Resizing Chromium verifies layout and mouse/keyboard interaction, not native touch gestures.
