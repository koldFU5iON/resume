# Add Job: one consistent manual-add UI (implementation spec)

Status: implemented in the working tree (uncommitted), 2026-11-13. See section 10 for what differs from the text below and which checks ran. Line numbers in sections 2–5 refer to the tree before the change.

Nothing was verified in a browser or on a device. Every item in section 8 is still to be done.

## 1. Goal and non-goals

**Goal.** One manual Add Job component, used by every "add a job by hand" entry point:

- a centered Dialog on desktop (replaces the right-hand Sheet),
- a bottom Drawer below 768px,
- one form state and one set of fields, shared with Edit Job,
- predictable open, prefill, extract, duplicate, save and failure behavior.

**Non-goals.**

- No new dependency and no generic "responsive overlay" component. The shell choice stays inside the Add Job component.
- Quick capture stays save-immediately. It does not become review-first.
- The capture paths (`quickCaptureJob`, `captureJobFromUrl`, batch, Scout, Job Hunt import) keep their own contracts and dedupe rules. They are not merged with manual create.
- Edit Job keeps its Dialog on all screen sizes. It only gains the shared fixes listed in section 5.
- `create/_components/form-field.tsx` is not moved or deleted. Auth forms import it (`src/app/(auth)/_components/email-password-form.tsx:10`, `forgot-password-form.tsx:9`, `reset-password-form.tsx:10`).
- No schema migration, no change to the assessment queue, no change to `maxDuration`.

## 2. Current map (source-backed)

### 2.1 Ways a job gets created

There are four `jobApplication.create` call sites. Only the first is the manual form.

| Path | Entry point | Server code | Dedupe | Required fields | Queue reason | Invalidation |
|---|---|---|---|---|---|---|
| Manual create | `CreateJobSheet` | `createJobApplication`, `src/modules/jobs/mutations.ts:45-62` | Client-side warning: jobNumber, else title + company, archived included (`dedup-internal.ts:42-62`) | title; company unless agency (client only) | `created` | none in the action; client `router.refresh()` (`create-job-sheet.tsx:118`) |
| Quick capture | `QuickCaptureInput` in the command bar (`command-bar.tsx:54`) | `quickCaptureJob`, `quick-capture.ts:13-61` | Exact URL match, returns existing (`:20-26`) | extracted title and company, else error (`:31-35`) | `quick-capture` | `revalidatePath('/dashboard/job-applications')` (`:59`) |
| Capture service | `POST /api/jobs/capture` (bearer), `POST /api/jobs/batch-capture` (session, SSE) | `captureJobFromUrl`, `capture.ts:69-123` | jobNumber, else title + company; `return_existing` by default (`:79-89`) | none: falls back to `(untitled)` / `(unknown)` (`:66-67`, `:141-142`) | `capture` | none in the service; batch dialog calls `router.refresh()` on `done` (`batch-capture-dialog.tsx:85`) |
| Job Hunt import | `importJob` from `job-queue-row.tsx:64` | `job-hunt/actions.ts:434-481` | none; skips rows already `imported` (`:438`) | copied from the discovered job | `job-hunt-import` | both `/dashboard/job-applications` and `/dashboard/job-hunt` (`:477-478`) |

Scout does not create a `JobApplication`. `submitScoutJob` runs `prepareJobCapture` and writes a `DiscoveredJob` (`scout-inbox/service.ts:56-73`), which the owner later imports through `importJob`. Ignored discovered jobs (`ignoreJob`, `job-hunt/actions.ts:484-491`) can still be imported, because `importJob` only excludes `imported`.

MCP has no job-creating tool (`docs/mcp-server.md`, tools table).

### 2.2 Entry points to the manual form

| Entry point | Today | Source |
|---|---|---|
| Applications toolbar "Add Job" | Opens the sheet | `job-list.tsx:571-577`, `:406` |
| Cmd/Ctrl+J on the applications page | Opens the sheet. Skipped while any dialog, alert dialog or menu is open | `job-list.tsx:84-104`, guard at `:87` |
| `?create=1&url=…` | Opens the sheet once at mount, URL prefilled | `page.tsx:35`, `:45-46`; `job-list.tsx:73` |
| `/dashboard/job-applications/create?url=…` | Server redirect to `?create=1&url=…`. Not a second form | `create/page.tsx:1-12` |
| Quick-capture failure toast "Add manually" | Hard navigation to the `/create` route | `quick-capture-input.tsx:26-29` |
| Dashboard "Add your first job" (two cards) | Links to the list. Does not open the form | `PipelineCard.tsx:56-58`, `RecentActivityCard.tsx:47-48` |
| Sidebar, command palette | Navigation only | `nav-menu.ts:35`, `command-palette.tsx:49-69` |
| Batch Add | Separate dialog and streaming API | `job-list.tsx:566-569`, `batch-capture-dialog.tsx` |

### 2.3 What is already shared, and what is duplicated

Shared:

- `JobFormFields` renders the fields for both Create and Edit (`job-form-fields.tsx`, used at `create-job-sheet.tsx:144` and `edit-job-dialog.tsx:104-115`).
- `applyExtractedData` copies non-empty extracted values into either form (`form-utils.ts:4-12`).
- `extractJobFromUrl` is the one tiered extractor (ATS, then HTML, then the user's LLM) for every path (`extract.ts:27-145`). The LLM tier is bring-your-own-key and tagged `job-extract` (`extract-llm.ts:81`).
- Create already has one `useForm` instance feeding both shells (`create-job-sheet.tsx:65-68`, `:137-148`).

Duplicated or inconsistent:

- Three overlay styles for one family of tasks: Create is a right Sheet on desktop (`create-job-sheet.tsx:180-206`) and a Vaul Drawer on mobile (`:156-178`); Edit and Batch are centered Dialogs (`edit-job-dialog.tsx:94-95`, `batch-capture-dialog.tsx:128-129`). `Dialog` and `Sheet` both wrap Base UI's dialog (`ui/dialog.tsx:4`, `ui/sheet.tsx:4`); `Drawer` wraps Vaul (`ui/drawer.tsx:4`).
- `handleExtract` is written twice with different behavior (`create-job-sheet.tsx:78-96`, `edit-job-dialog.tsx:81-91`). Only Edit calls `notifyUsageUpdated()` (`:88`), which is what refreshes the footer token count (`app-footer.tsx:26`).
- The shared field grid is fixed at two columns (`job-form-fields.tsx:94`, `:125`, `:130`), which is cramped in the mobile drawer and in the Edit dialog on a phone.

### 2.4 Verified defects this work fixes

1. **Deep link is read once and never consumed.** `creating` is initialised from `openCreate` (`job-list.tsx:73`). The query stays in the URL after dismiss or save, so a reload or a Back to that entry reopens the form, and a second soft navigation to `?create=1` while already there does nothing.
2. **The `key` on the tabs remounts the list.** `page.tsx:35` keys `ApplicationTabs` by `create` and reads the remembered tab from the `jobs-tab` cookie. Any change of the query between "has `create=1`" and "does not" remounts the whole tab tree: selection is lost, and the tab can jump to Archived if that is what the cookie holds.
3. **Publish date defaults to "today at module load".** `DEFAULT_VALUES.datePublished = new Date()` (`create-job-sheet.tsx:52`) is evaluated once per page load and records a publish date nobody entered. Capture paths store `null` when unknown.
4. **Validation gaps.** `title: z.string().min(1)` accepts whitespace (`schema.ts:5`). Company is only required by an `if` in the client submit handler (`create-job-sheet.tsx:99-102`). `createJobApplication` does no runtime parse and spreads its argument into `prisma.create` (`mutations.ts:47-58`), so a hand-made call can set other columns on the caller's own row. `updateJobApplication` does parse (`mutations.ts:144-149`).
5. **URL scheme.** `z.string().url()` accepts `javascript:alert(1)` (checked against the installed zod 4.4.3). The stored URL is rendered as an `href` (`job-form-fields.tsx:59-72`).
6. **Extraction races.** A result that arrives late is applied to whatever the form holds now, including text typed during the wait, and to a form that was closed and reopened (`create-job-sheet.tsx:82-84`; the form is reset on open at `:70-76` but the pending call is not cancelled). Save stays enabled while extraction runs (`:171`, `:200`).
7. **Extraction throws are unhandled.** A network failure of the server action rejects inside `startTransition` in both dialogs. Neither has a `try/catch`, and there is no `error.tsx` under `src/app/dashboard`.
8. **Duplicate acknowledgement is a single boolean.** After the first warning, `acknowledgedDupes` stays true (`create-job-sheet.tsx:110-114`), so changing title or company to match a different existing job saves without a new warning.
9. **Failure reporting.** The duplicate check, the create and the post-create ATS hint share one `try/catch` (`:103-134`). If the hint lookup fails after the row is written, the user sees "Failed to create job application" and may add it again.
10. **Dismissal while saving.** Cancel is disabled during submit, but Escape, the close button, the backdrop and drawer drag still close the form (`:158`, `:181`).
11. **Empty strings are stored.** Blank `jobNumber`, `salaryBand`, `jobDescription` and `recruiterName` are saved as `''` by create; capture paths and edit store `null`.

## 3. Decisions

### 3.1 Component and shell

- Rename `create-job-sheet.tsx` to `add-job-dialog.tsx`, export `AddJobDialog` with the same props (`open`, `onOpenChange`, `initialUrl`). One import site changes (`job-list.tsx:31`).
- The component keeps one `useForm`, one `<form id="create-job-form">`, and picks the shell with `useIsMobile()` (768px, `hooks/use-mobile.ts:3-4`). Form state lives above both shells, so crossing the breakpoint while open keeps the values.
- **Desktop:** `Dialog` with the same layout classes as Edit (`sm:max-w-3xl flex flex-col max-h-[90vh] overflow-hidden`, scrolling body, `DialogFooter` fixed at the bottom; see `edit-job-dialog.tsx:95-125`). Remove all `Sheet` imports. `ui/sheet.tsx` stays; other features may use it.
- **Mobile:** keep the Vaul `Drawer`. Keep `repositionInputs={false}`; it was a deliberate fix (commit `bf56e77`). Change `max-h-[92vh]` to `max-h-[92dvh]`, and give the footer `pb-[max(1rem,env(safe-area-inset-bottom))]`. No JavaScript keyboard handling.
- Both shells keep a Title and a Description (required for the accessible name). Copy: title "Add Job" (matches "Edit Job"), description unchanged, submit "Add job" / "Adding…" / "Add anyway".
- Focus: rely on the primitives. Base UI focuses the first tabbable element, which is the URL input because the close button is rendered after the children (`ui/dialog.tsx:61-77`), and returns focus to the previously focused element on close. Do not add `initialFocus`/`finalFocus` unless the browser check in section 8 fails.
- Shared fields: change the three grids to `grid grid-cols-1 sm:grid-cols-2 gap-4`. This also fixes Edit on phones.

### 3.2 Opening, deep links and the tab

- `JobList` owns `creating` and a new `createUrl`. One helper opens the form: `openCreate(url = '')` sets both. The toolbar button and Cmd/Ctrl+J call it with no URL, which clears any earlier prefill.
- `JobList` reads the deep link with `useSearchParams()` in an effect, instead of the `openCreate` / `initialCreateUrl` props:
  - if `create=1` and the form is closed: `openCreate(url)`;
  - if the form is already open: ignore the prefill, the open draft wins;
  - in both cases consume only `create` and `url`: copy the current URL, delete those two search parameters, then use `window.history.replaceState(null, '', cleanedUrl)`. Preserve unrelated search parameters and the hash.
- The installed Next docs state that `replaceState` integrates with the router and keeps `useSearchParams` in sync without a reload (`node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md:343-345`). The page is rendered per request (it reads cookies and the session) and has a `loading.tsx`, so `useSearchParams` does not need an extra `Suspense` boundary (`.../04-functions/use-search-params.md:82-86`). `npm run build` confirms this.
- Results: reload and Back no longer reopen the form; a repeated deep link (same or different `url`) opens it again; the form opens after hydration instead of during the first render.
- `page.tsx`: remove the `key` on `ApplicationTabs` and stop passing `openCreate` / `initialCreateUrl` to `JobList`. Keep computing `initialTab` exactly as now (Active when `create=1`, else the cookie).
- `ApplicationTabs` becomes controlled (`value` + `useState(initialTab)`). It also reads `useSearchParams()`: when `create=1` and the tab is not Active, it sets the tab to Active during render. This is needed for soft navigations, because the Active panel, and with it `JobList`, is unmounted while Archived is shown (`ui/tabs.tsx:72-80` does not keep panels mounted). `ApplicationTabs` never consumes the query; `JobList` does, after it mounts.
- Tab memory rule: the `jobs-tab` cookie is written only when the user clicks a tab (unchanged, `application-tabs.tsx:14-18`). A deep link shows Active without changing the remembered tab.
- With the `key` gone, server refreshes (the assessment poller, revalidation after a save) no longer remount `JobList`, so the uncommitted selection, collapse, search and undo state survive them.
- The `/create` route stays as a redirect. `QuickCaptureInput` is not changed; its "Add manually" action remains a hard navigation.

### 3.3 Form lifecycle

- The form resets every time it opens (current behavior, `create-job-sheet.tsx:70-76`). Closing discards the draft. There is no draft kept across close.
- Defaults: every text field `''`, `applicationSource: 'cold'`, `isRecruitmentAgency: false`, `datePublished: undefined`. Define them inside the reset, not with a module-level `new Date()`.
- While saving, the form cannot be closed by any route: `onOpenChange` ignores a close request while `isSubmitting`, the same guard Batch uses (`batch-capture-dialog.tsx:110-111`). For the Drawer also pass `dismissible={!isSubmitting}`.
- While the form has unsaved edits, a click on the desktop backdrop does not close it (`disablePointerDismissal={form.formState.isDirty}`, a Base UI root prop, `node_modules/@base-ui/react/dialog/root/DialogRoot.d.ts:50`). Escape, the close button and Cancel still close and discard. The mobile drawer keeps its normal dismissal.
- A failed save leaves the form open with every value intact. The user retries with the same button.

### 3.4 Validation (one schema, client and server)

In `src/modules/jobs/schema.ts`:

- Trim `title`, `company`, `url`, `location`, `jobNumber`, `salaryBand`, `recruiterName` in the base object. `title` becomes `z.string().trim().min(1, …)`. `jobDescription` is not trimmed.
- `url`: blank, or an absolute `http`/`https` URL (`z.url({ protocol: /^https?$/ })` behind the existing "blank is fine" check). This is a scheme allowlist for a value rendered as a link, not a new length or format bound.
- `createJobSchema` = base plus one rule: company is required unless `isRecruitmentAgency`. Attach the issue to `path: ['company']` so the field shows it. Remove the `if` in the client submit handler.
- `updateJobSchema` stays `jobSchemaBase.partial()`, built from the unrefined base, so partial edits keep working. It inherits the trim and the URL scheme rule.

In `createJobApplication`:

- Start with `createJobSchema.parse(data)`, as `updateJobApplication` does. Unknown keys are dropped by zod.
- Store `null` for blank `company`, `url`, `jobNumber`, `salaryBand`, `jobDescription`, `recruiterName`; store `recruiterName` as `null` when not an agency.

**URL policy, stated once.** Storing: any `http(s)` URL or blank. Extracting: public HTTPS only, enforced on the server by `isSafeUrl` (`extract-fetch.ts:47-58`, called at `extract.ts:28-30`). A user can save an `http://` or intranet URL; pressing Extract on it returns the server's "only public HTTPS job pages" error. No client-side copy of the extraction rule.

### 3.5 Extraction

- Extraction stays explicit: only the Extract button starts it. A prefilled URL is not extracted automatically, because the last tier spends the user's own LLM key.
- Move the logic into one hook, `use-job-extraction.ts`, used by Add and Edit:
  - snapshot `form.getValues()` and take a run number when the call starts;
  - `try { await extractJobFromUrl(url) } catch { toast "Couldn't extract details. Check your connection and try again." }`;
  - drop the result silently if the run number changed (form closed, reopened or another run started) or the URL field no longer equals the URL that was sent;
  - apply with `applyExtractedData(form, data, snapshot)`; the new third argument makes it skip any field whose current value differs from the snapshot, so text typed during the wait is kept;
  - call `notifyUsageUpdated()` whenever the call returns, success or not;
  - expose `cancel()`, called when the form closes.
- Fields the user typed before pressing Extract are still replaced by non-empty extracted values. That is what the button means, and it keeps "Re-extract" in Edit unchanged.
- Save is disabled while extracting, and Extract is disabled while saving (both dialogs).
- Add keeps its duplicate pre-check after a successful extraction (`create-job-sheet.tsx:86-94`), inside the same stale-run guard. Toast texts stay per dialog.

### 3.6 Duplicates

- Manual create keeps the warn-then-confirm model and the existing matcher (jobNumber, else title + company, archived included).
- Replace the boolean with the acknowledged match set: `duplicateKey(matches)` = the sorted match ids joined. On submit, a non-empty match set whose key differs from the acknowledged key shows the warning, stores the key and stops. The same set a second time saves. A different set warns again.
- The submit label reads "Add anyway" only while the shown matches are the acknowledged ones.
- If the duplicate check itself fails, stop with "Couldn't check for duplicates. Try again." Nothing was created, and the message must say so.
- Quick capture keeps exact-URL dedupe. The capture service keeps `return_existing` / `create_anyway`. Neither changes.

### 3.7 Save, failure and the ATS hint

Submit runs three separate steps:

1. Duplicate check (3.6).
2. `createJobApplication(data)`. On a throw: "Couldn't add the job. Your details are still here." The form stays open.
3. On success: success toast, close. Then the "Watch {company}?" ATS hint in its own `try/catch`. A hint failure is silent and never reported as a failed create.

A network failure can hide a create that did succeed. This spec does not promise exactly-once. A retry runs the duplicate check again, which finds the row just written when it has a job number, or a title and company, and shows the warning. Agency jobs saved without a company and without a job number are not caught.

### 3.8 Invalidation and assessments

- Add `revalidatePath('/dashboard/job-applications')` to `createJobApplication` and remove the client `router.refresh()` (and `useRouter`) from the Add component. This matches every other mutation in the file.
- One path is enough. No route uses `unstable_cache`, `'use cache'` or cache tags, and `next.config.ts` does not enable Cache Components; dashboard pages render per request. Per the installed docs, `revalidatePath` in a Server Function updates the current page at once and makes previously visited pages refresh on the next visit (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`, "Good to know"). So `/dashboard` (stats from `getDashboardStats`) is fresh when next opened. The sidebar's job list only shows `interviewing` and `in-progress` jobs (`queries.ts:258-270`), which a new job is not.
- The fresh list reaches `JobList` with the action response, so `AssessmentPoller` sees the pending run and starts polling as it does today.
- Queueing is unchanged: `queueJobAssessmentSafely(profile.id, job.id, { reason: 'created' })` after the row is written (`mutations.ts:60`). Do not change the reason, the drain deadlines, or `maxDuration = 300` on `page.tsx:15` and `dashboard/layout.tsx:14`.
- Batch (`router.refresh()` on `done`), quick capture and import keep their current invalidation.

### 3.9 Other entry points

- Dashboard "Add your first job" (both cards): change the `href` to `/dashboard/job-applications?create=1`. "View all" links stay as they are.
- Command palette: add one "Add job" item under Actions that calls `go('/dashboard/job-applications?create=1')`. It works from any page, including the applications page itself, because the deep link is now consumed and repeatable.
- Sidebar: stays navigation only.
- Quick capture, Batch Add, the bearer capture API, bookmarklet and agent skills, Scout and Job Hunt import: no code change.

## 4. State lifecycle

| Event | Result |
|---|---|
| Toolbar button or Cmd/Ctrl+J | Opens empty. Cmd/Ctrl+J still does nothing while another dialog or menu is open (`job-list.tsx:87`; the new Dialog has `role="dialog"`, so the guard also blocks a second open) |
| Navigation to `?create=1[&url=…]` | Active tab shown, form opens with the URL, query removed from the address bar |
| Same deep link again | Opens again |
| Deep link while the form is open | Query removed, draft untouched |
| Reload or Back after opening by deep link | Does not reopen |
| Extract | Fields fill; Save disabled until it ends; typing during the wait is kept |
| Close during extraction | Result dropped, no toast |
| Save with a new duplicate set | Warning, no save |
| Save again with the same set | Saves |
| Save fails | Form stays open with values |
| Close while saving | Not possible |
| Backdrop click with edits (desktop) | Ignored |
| Escape, close button, Cancel | Closes and discards |
| Save succeeds | Toast, form closes, list updates without remounting, assessment queued |
| Screen crosses 768px while open | Shell swaps, values kept |

## 5. File-by-file changes

No new dependencies. No schema migration.

| File | Change |
|---|---|
| `src/modules/jobs/schema.ts` | Trim, `http(s)` URL rule, `createJobSchema` company rule (3.4) |
| `src/modules/jobs/mutations.ts` | `createJobApplication`: parse, blank-to-null, `revalidatePath` (3.4, 3.8) |
| `src/modules/jobs/form-utils.ts` | `applyExtractedData` third argument (snapshot); add `duplicateKey(matches)` |
| `src/app/dashboard/job-applications/_components/use-job-extraction.ts` | New hook (3.5) |
| `…/_components/create-job-sheet.tsx` → `add-job-dialog.tsx` | Dialog shell, drawer tweaks, defaults, submit split, duplicate key, dismissal guards, hook (3.1, 3.3, 3.6, 3.7) |
| `…/_components/job-form-fields.tsx` | Responsive grids; Extract disabled while saving |
| `…/_components/edit-job-dialog.tsx` | Use the hook; Save disabled while extracting. Nothing else |
| `…/_components/job-list.tsx` | `openCreate` helper, `createUrl`, `useSearchParams` effect, new import, drop two props (3.2) |
| `…/_components/application-tabs.tsx` | Controlled tab, Active on `create=1` (3.2) |
| `src/app/dashboard/job-applications/page.tsx` | Remove the `key` and the two `JobList` props |
| `src/app/dashboard/_components/PipelineCard.tsx`, `RecentActivityCard.tsx` | One `href` each |
| `src/components/shell/command-palette.tsx` | One "Add job" item |

Not touched: `quick-capture.ts`, `quick-capture-input.tsx`, `capture.ts`, both `api/jobs/*` routes, `batch-capture-dialog.tsx`, `job-hunt/actions.ts`, `scout-inbox/*`, `create/page.tsx`, `create/_components/form-field.tsx`, `ui/*`.

`job-list.tsx`, `page.tsx` and `application-tabs.tsx` carry uncommitted work. Edit them in place; do not regenerate or reformat them. Leave the other uncommitted files alone (`job-group.tsx`, `filter-bar.tsx`, `list-selection.ts`, `status-dropdown.tsx`, `app-item-menu.tsx`, and the rest of `git status`).

## 6. Order of work

1. **Schema and action.** `schema.ts`, `mutations.ts`, tests. Check that no existing job has a non-`http(s)` URL before merging (section 9).
2. **Pure helpers.** `applyExtractedData` snapshot argument and `duplicateKey`, with tests.
3. **Extraction hook.** Add `use-job-extraction.ts`; switch Edit to it first, since Edit's behavior barely changes.
4. **Add component.** Rename, Dialog shell, defaults, submit split, guards. The toolbar and Cmd/Ctrl+J work at this point.
5. **Shared fields.** Responsive grids.
6. **Deep links and tabs.** `job-list.tsx`, `application-tabs.tsx`, `page.tsx` together, in one commit; they only work as a set.
7. **Other entry points.** Dashboard links, command palette item.
8. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, then the browser checks.

Read the relevant guide in `node_modules/next/dist/docs/` again before step 6 if the installed Next version has changed from 16.4.6.

## 7. Automated checks

Vitest runs in the `node` environment and the repo has no DOM test library (`vitest.config.ts`), so components cannot be unit-tested without a new dependency. Test the logic that was moved into plain modules; cover the rest in the browser.

Extend:

- `src/modules/jobs/schema.test.ts` (has no create/update cases today): whitespace title rejected; values trimmed; company required unless agency, issue on `company`; blank URL accepted; `http` and `https` accepted; `javascript:` rejected; `updateJobSchema` accepts `{}` and a lone field.
- `src/modules/jobs/mutations.test.ts`, `createJobApplication` (currently one case at `:71-79`, "returns it unchanged", which stays true): rejects invalid input before any DB write; drops unknown keys; stores `null` for blanks; still queues with `reason: 'created'`; calls `revalidatePath('/dashboard/job-applications')`; does not queue or revalidate when the create throws.

Add:

- `src/modules/jobs/form-utils.test.ts`: `applyExtractedData` without a snapshot behaves as today; with a snapshot it skips changed fields and fills unchanged ones, including the date; `duplicateKey` ignores order and differs for different sets.

Must keep passing unchanged, as proof the other contracts were not touched: `quick-capture.test.ts`, `capture.test.ts`, `batch-capture.test.ts`, `src/app/api/jobs/capture/route.test.ts`, `src/modules/job-hunt/actions.test.ts`, `list-selection.test.ts`, `filter-bar.test.ts`.

Missing coverage that this work does not add: there is no test for the capture route's response body (`id`, `created`, `reviewUrl`, `duplicate`, 201 vs 200; `route.test.ts` only covers the scope check) and none for the batch stream. Both are unchanged here.

## 8. Browser checks (all still to do, none run)

Use the dev login. Extraction on a page that falls through to the LLM tier spends the signed-in user's key; use a Greenhouse, Lever or Ashby URL to stay on the free tiers.

**Shell and accessibility**

- Desktop: centered dialog, same width and footer as Edit. Body scrolls, header and footer stay put, with a long job description.
- Focus lands on the URL field. Tab stays inside. Escape closes. Focus returns to the Add Job button (button open) or to what was focused (shortcut open).
- A screen reader announces the title and description in both shells.
- Below 768px: bottom drawer, one-column fields, footer clear of the home indicator. On a real iOS and Android device, focus each field with the keyboard open: the focused field is visible and the drawer does not jump.
- Resize across 768px while typing: values kept.
- Light and dark theme.

**Opening**

- Toolbar button; Cmd+J and Ctrl+J; shortcut ignored while Edit, Batch, a row menu or the command palette is open; shortcut while Add is open does not stack a second one.
- `?create=1` and `?create=1&url=https://…`: opens on Active with the URL; address bar loses the query; reload and Back do not reopen.
- `/dashboard/job-applications/create?url=…` behaves the same.
- Remembered tab Archived, then a deep link: Active is shown; after closing and reloading, Archived is shown again.
- On Archived, run "Add job" from the command palette: switches to Active and opens. Run it twice in a row.
- Dashboard with no jobs: both "Add your first job" links open the form.
- Quick capture with an unextractable URL: "Add manually" opens the form with that URL.

**List state (uncommitted fixes)**

- Select rows, collapse a group, type a search, then add a job by button and by deep link from the palette: selection, collapse, search, filter and sort survive the save, and the new row appears.
- Archive with Undo, bulk archive with `E`, and edit still work after adding a job.
- No tab jump when the assessment poller refreshes after a deep-link open.

**Extraction**

- Extract fills the fields; the footer token count updates when the LLM tier ran.
- Type in Title while it runs: the typed title is kept, other fields fill.
- Save is disabled while extracting; Extract is disabled while saving.
- Close during extraction, reopen: the new form stays empty, no late toast.
- Change the URL during extraction: the old result is dropped.
- Offline (devtools) and press Extract: error toast, form usable, no error page. Same in Edit.
- `http://` URL: Extract shows the HTTPS message; Save still works.

**Duplicates and saving**

- Matching an existing job: warning, then "Add anyway" saves.
- After the warning, change the company to match a different job: a new warning appears.
- An archived match is reported as archived.
- Whitespace-only title: field error. Company blank: error unless "Via recruitment agency" is ticked.
- Date Published left empty: saved as no date; the list shows no publish age.
- Offline save: error toast, values kept, retry works once online.
- Escape, backdrop and close button do nothing while saving. Backdrop click with edits does nothing; Escape still discards.
- A Greenhouse/Lever/Ashby URL shows the "Watch company" toast after the success toast.
- With early assessment on: the new row shows a running assessment that completes.

**Unchanged flows (regression)**

- Edit Job: opens, re-extract, save, stale-fit warning, salary popover.
- Quick capture: paste and Enter still save at once; an existing URL reports "Already captured".
- Batch Add: progress, partial failures listed, list refreshes on Done.
- `POST /api/jobs/capture` with a token: 201 on new, 200 on existing, same body shape.
- Job Hunt import (including an ignored job) and a Scout submission followed by import.

## 9. Open issues

1. **Existing non-`http(s)` URLs.** The scheme rule also applies to Edit. A job already stored with another scheme could not be saved from Edit until its URL is fixed. Before merging step 1, audit existing schemes read-only using actual URL parsing. If legacy values exist, keep unsafe schemes non-clickable and let users correct or clear them; do not weaken the scheme allowlist to accommodate them. No production data changes are authorized by this spec.
2. **Company on edit.** Edit can still blank the company of a non-agency job, because the "required unless agency" rule cannot run on a partial payload without reading the row. Left as is.
3. **Placeholder rows.** The capture service saves `(untitled)` / `(unknown)` when extraction finds no title or company; quick capture refuses instead. This spec leaves both. Such rows can now be corrected in Edit like any other.
4. **Hard navigation from quick capture.** "Add manually" reloads the page. Switching it to a soft navigation is possible now that deep links are consumed, but it changes `QuickCaptureInput`, which is out of scope.
5. **Mobile keyboard.** `dvh` and safe-area padding are untested on devices. If a field is hidden by the keyboard, fix it inside the drawer only; do not turn `repositionInputs` back on without re-testing the bug from commit `bf56e77`.
6. **Applications empty state.** "No jobs yet. Create your first application." (`job-list.tsx:468-472`) stays plain text. The toolbar button is directly above it.

## 10. Implementation notes (2026-11-13)

Built as specified in sections 3–5, with these differences:

- **URL policy helper.** `isHttpUrl()` in `form-utils.ts` (real `URL` parsing, `http:`/`https:` only) backs the schema rule instead of `z.url({ protocol })`. The same helper now gates every place a stored job URL becomes an `href`: the Edit form's open-link button, `job-row.tsx`, `job-row-card.tsx` and `view/[id]/_components/job-detail-header.tsx`. A legacy non-`http(s)` URL is shown in the Edit field, not linked, and must be corrected or cleared before Edit saves (`updateJobSchema` keeps the rule). The read-only audit in 9.1 was **not** run; no production data was read.
- **Company rule** uses `refine(..., { when })` so the company and title errors show together instead of the company one appearing only after the title is fixed.
- **Extraction hook** (`use-job-extraction.ts`) keeps its own `isExtracting` state instead of `useTransition`. It drops a stale result and a stale error silently, cancels on unmount as well as on close, and marks extracted fields dirty (so a desktop backdrop click after extraction doesn't discard them). Edit now also toasts "Paste a job URL first" if Extract is somehow pressed with an empty URL (the button is disabled then).
- **Implicit submit.** Enter in a field can't save while extraction runs: the Add submit button is disabled (so implicit submission is off) and `onSubmit` returns early; Edit's form ignores submit while extracting.
- **Copy.** Duplicate-check failure: "Couldn't check for duplicates. Nothing was added. Try again." Duplicate warning toast: "Possible duplicate. Submit again to add it anyway." Success: "Job added".
- **Tabs.** `ApplicationTabs` is controlled and switches to Active during render when `create=1` is present; it never writes the cookie for that. `JobList` consumes `create`/`url` with `window.history.replaceState(null, '', href)`; Next's patched `replaceState` copies its internal history state when `data` is `null` (`node_modules/next/dist/client/components/app-router.js`). Segment React keys exclude search params (`layout-router.js`, `createRouterCacheKey(…, true)`), so the deep link itself doesn't remount the list.
- **Installed Next is 16.2.6**, not 16.4.6 as section 6 assumed; the cited docs are the same.

Checks run:

- `npx vitest run --exclude '.claude/**'`: 154 files, 1850 passed, 1 skipped. New/extended: `schema.test.ts`, `mutations.test.ts` (`createJobApplication`), `form-utils.test.ts`. The section 7 regression files pass unchanged. (Without the exclude, vitest also collects stale copies under `.claude/worktrees/*`, which fail independently of this change.)
- `npx eslint src`: 0 errors (warnings are pre-existing).
- `npm run typecheck`: no errors in changed files. Three pre-existing errors remain in untouched files: `settings/account/_actions.ts:51` and `lib/auth.ts:153` (local `node_modules` has better-auth 1.6.11 while `package.json` asks for ^1.7.20) and a stale `.next/types/validator.ts` entry.
- `npm run build` was **not** run: it runs `prisma migrate deploy` when `DATABASE_URL` is set. `npx next build` stops on the same pre-existing better-auth type error; `next build --experimental-build-mode compile` then `--experimental-build-mode generate` both succeed, and `/dashboard/job-applications` is dynamic, so `useSearchParams` needs no Suspense boundary.
- Impeccable mechanical detector on the edited UI files: no findings.

Not verified: everything in section 8, including focus order and return, screen-reader names, the mobile drawer with an on-screen keyboard, `dvh`/safe-area padding, crossing 768px while open, and the deep-link/tab behavior in a real browser.
