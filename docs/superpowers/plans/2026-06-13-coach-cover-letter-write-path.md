# Coach Cover Letter Write Path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AI coach a `propose_cover_letter_update` tool so it can propose full-document cover letter replacements that the user reviews and confirms, closing issues #200 and #194.

**Architecture:** Add one new client-handled tool (no `execute`) following the exact pattern of `propose_cv_update`. The confirmation card gains a markdown preview for cover letter proposals and dispatches a `cover-letter-updated` DOM event on accept. The workspace listens for that event and syncs local state.

**Tech Stack:** Next.js 16 App Router, Vercel AI SDK (`tool()`), React, ReactMarkdown + remark-gfm, Sonner toasts, Tailwind CSS

---

### Task 1: Add `propose_cover_letter_update` tool

**Files:**
- Modify: `src/modules/chat/tools.ts` (after line 352, after `propose_cv_update`)

- [ ] **Step 1: Add the tool definition**

In `src/modules/chat/tools.ts`, insert after the closing `}),` of `propose_cv_update` (after line 352):

```ts
    propose_cover_letter_update: tool({
      description:
        'Propose a full replacement of a cover letter\'s content for the user to review and confirm. Call get_cover_letter first to read the current content.',
      inputSchema: zodSchema(
        z.object({
          letterId: z.string().describe('The ID of the cover letter to update'),
          proposedContent: z.string().describe('The full proposed markdown content for the cover letter'),
          rationale: z.string().describe('Brief explanation of what changed and why'),
        }),
      ),
    }),
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/chat/tools.ts
git commit -m "feat: add propose_cover_letter_update tool to coach"
```

---

### Task 2: Update cover letter system prompt

**Files:**
- Modify: `src/modules/chat/context.ts` (lines 137–141, the `cover_letter` case)

- [ ] **Step 1: Update the `cover_letter` branch**

Replace the current `cover_letter` case:

```ts
    case 'cover_letter':
      return (
        `User is working on a cover letter${ctx.company ? ` for ${ctx.company}` : ''}\n` +
        `Letter ID: ${ctx.letterId} — use this with get_cover_letter to fetch full content`
      )
```

With:

```ts
    case 'cover_letter':
      return (
        `User is working on a cover letter${ctx.company ? ` for ${ctx.company}` : ''}\n` +
        `Letter ID: ${ctx.letterId} — use this with get_cover_letter to fetch full content\n` +
        `Use propose_cover_letter_update to propose changes. The user will see a full markdown preview and must confirm before the change is applied.`
      )
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/chat/context.ts
git commit -m "feat: tell coach to use propose_cover_letter_update on cover letter pages"
```

---

### Task 3: Wire `buildWriteAction` in chat-message

**Files:**
- Modify: `src/components/shell/chat-message.tsx` (lines 9–37)

- [ ] **Step 1: Add the import**

After line 12 (`import { updateBlock } from '@/modules/interview-prep/actions'`), add:

```ts
import { updateCoverLetterContent } from '@/modules/cover-letters/actions'
```

- [ ] **Step 2: Add the `buildWriteAction` branch**

In `buildWriteAction`, after the `propose_prep_note_update` branch (after line 35, before `return undefined`):

```ts
  if (toolName === 'propose_cover_letter_update') {
    return () => updateCoverLetterContent(
      args.letterId as string,
      args.proposedContent as string,
    )
  }
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/shell/chat-message.tsx
git commit -m "feat: wire propose_cover_letter_update write action in chat-message"
```

---

### Task 4: Update ToolConfirmationCard — label, markdown preview, event dispatch

**Files:**
- Modify: `src/components/shell/tool-confirmation-card.tsx`

- [ ] **Step 1: Add imports**

After the existing imports at the top of the file, add:

```ts
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
```

- [ ] **Step 2: Add the label**

In `TOOL_LABELS`, add an entry after `propose_prep_note_update`:

```ts
  propose_cover_letter_update: 'Update cover letter',
```

- [ ] **Step 3: Add event dispatch on accept**

In `handleAccept`, after the existing `if (toolName === 'propose_cv_update')` block (after line 37), add:

```ts
      if (toolName === 'propose_cover_letter_update') {
        window.dispatchEvent(new CustomEvent('cover-letter-updated', {
          detail: { letterId: args.letterId, proposedContent: args.proposedContent },
        }))
      }
```

- [ ] **Step 4: Add markdown preview rendering**

The current card renders `args.proposedContent` as a plain green text string (via the `args.proposedValue ?? args.proposedContent` fallthrough). For cover letter proposals the content is long markdown — we need a scrollable rendered preview instead.

Add a special-cased block **before** the existing `{(() => { const display = ...`  block (before line 57):

```tsx
      {toolName === 'propose_cover_letter_update' && args.proposedContent != null && (
        <div className="mb-3 max-h-64 overflow-y-auto rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
          <div className="prose prose-xs dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {String(args.proposedContent)}
            </ReactMarkdown>
          </div>
        </div>
      )}
```

Then guard the existing generic display block so it skips `proposedContent` when we've already rendered it:

Replace the existing display block (lines 57–65):

```tsx
      {(() => {
        const display = args.proposedValue ?? args.proposedContent ??
          (args.name != null ? `${args.name}${args.category ? ` · ${args.category}` : ''}` : undefined)
        return display !== undefined ? (
          <div className="mb-3 rounded-md bg-green-50 px-2.5 py-1.5 text-xs text-green-700 dark:bg-green-950 dark:text-green-400">
            {String(display)}
          </div>
        ) : null
      })()}
```

With:

```tsx
      {(() => {
        if (toolName === 'propose_cover_letter_update') return null
        const display = args.proposedValue ?? args.proposedContent ??
          (args.name != null ? `${args.name}${args.category ? ` · ${args.category}` : ''}` : undefined)
        return display !== undefined ? (
          <div className="mb-3 rounded-md bg-green-50 px-2.5 py-1.5 text-xs text-green-700 dark:bg-green-950 dark:text-green-400">
            {String(display)}
          </div>
        ) : null
      })()}
```

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/shell/tool-confirmation-card.tsx
git commit -m "feat: add cover letter proposal UI to ToolConfirmationCard"
```

---

### Task 5: Add `cover-letter-updated` listener in workspace

**Files:**
- Modify: `src/app/dashboard/cover-letters/[id]/_components/cover-letter-workspace.tsx`

- [ ] **Step 1: Add the event listener effect**

After the existing cleanup `useEffect` (after line 46), add:

```ts
  useEffect(() => {
    function handleCoverLetterUpdated(e: Event) {
      const detail = (e as CustomEvent<{ letterId: string; proposedContent: string }>).detail
      if (detail.letterId !== letter.id) return
      setContent(detail.proposedContent)
      if (detail.proposedContent.trim()) setShowEditor(true)
    }
    window.addEventListener('cover-letter-updated', handleCoverLetterUpdated)
    return () => window.removeEventListener('cover-letter-updated', handleCoverLetterUpdated)
  }, [letter.id])
```

The `letter.id` guard prevents the workspace from applying an update intended for a different cover letter if multiple tabs are open. The `setShowEditor(true)` handles the edge case where the coach proposes content for a previously-empty cover letter (where the "Start writing" placeholder would be showing).

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/cover-letters/[id]/_components/cover-letter-workspace.tsx
git commit -m "feat: sync cover letter workspace state on coach-proposed update"
```

---

### Task 6: Manual verification

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify the happy path**

1. Sign in as `test@example.com` / `password`
2. Navigate to a cover letter at `/dashboard/cover-letters/<id>`
3. Open the AI coach panel
4. Ask the coach: "Rewrite this cover letter to be more concise"
5. Verify: the coach calls `get_cover_letter` first, then produces a `propose_cover_letter_update` tool call
6. Verify: the confirmation card shows "Update cover letter" as the label, the rationale text, and a scrollable markdown preview of the proposed content
7. Click **Accept** — verify: the textarea updates immediately with the new content, save indicator shows "Saved"
8. Refresh the page — verify: the updated content persists

- [ ] **Step 3: Verify the reject path**

1. Ask the coach to propose another update
2. Click **Decline** — verify: the card shows "Change declined", the workspace content is unchanged

- [ ] **Step 4: Verify empty letter edge case**

1. Create a new cover letter with no content
2. Ask the coach to write an opening paragraph
3. Accept the proposal — verify: the "Start writing" placeholder disappears and the textarea shows the proposed content

- [ ] **Step 5: File the follow-up issue**

```bash
gh issue create \
  --title "Cover letter: split content string into structured paragraphs (sections: string[])" \
  --body "Currently cover letter content is stored as a single flat markdown string in the \`content\` field. The \`sections\` column exists in the schema but is unused.

Splitting content into \`sections: string[]\` (one entry per paragraph) would allow the AI coach to target individual paragraphs with \`propose_cover_letter_update\` instead of replacing the whole document.

Follow-up from the cover letter write path fix (issues #200, #194)." \
  --label "enhancement"
```

---

### Task 7: Create PR

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin HEAD
gh pr create \
  --title "feat: add AI coach cover letter write path (closes #200, #194)" \
  --body "$(cat <<'EOF'
## Summary

- Adds `propose_cover_letter_update` tool to the AI coach — full document replacement, user confirms before applying
- Updates cover letter system prompt to tell the coach the tool exists and when to use it
- Wires `buildWriteAction` in `chat-message.tsx` to call `updateCoverLetterContent`
- `ToolConfirmationCard` gains a scrollable markdown preview for cover letter proposals and dispatches `cover-letter-updated` on accept
- `CoverLetterWorkspace` listens for `cover-letter-updated` and syncs local state without a reload

## Test plan

- [ ] Coach can propose a cover letter rewrite; confirmation card shows label, rationale, and markdown preview
- [ ] Accept applies change to DB and textarea updates instantly
- [ ] Decline leaves content unchanged
- [ ] Proposing content for an empty cover letter shows the editor (not the "Start writing" placeholder)
- [ ] Page refresh after accept shows persisted content
- [ ] `npm run typecheck` passes

Closes #200
Closes #194

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
