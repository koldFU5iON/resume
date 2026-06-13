# Coach Cover Letter Write Path — Design Spec

**Date:** 2026-06-13
**Issues:** #200, #194
**Status:** Approved

## Problem

The AI coach can read cover letters via `get_cover_letter` but has no mechanism to propose or apply changes to them. CV section updates work end-to-end via `propose_cv_update` (client-handled tool → `ToolConfirmationCard` → `patchCVSectionData` server action → `cv-section-updated` DOM event). The equivalent path for cover letters is entirely missing.

## Solution

Add `propose_cover_letter_update` as a client-handled tool following the exact same pattern as `propose_cv_update`. Cover letter content is a single flat markdown string, so the tool proposes a full document replacement — no section targeting needed.

## Tool Schema

```ts
propose_cover_letter_update: tool({
  description: 'Propose a full replacement of a cover letter\'s content for the user to review and confirm.',
  inputSchema: zodSchema(z.object({
    letterId: z.string().describe('The ID of the cover letter to update'),
    proposedContent: z.string().describe('The full proposed markdown content for the cover letter'),
    rationale: z.string().describe('Brief explanation of what changed and why'),
  })),
  // no execute — client-handled
})
```

## Data Flow

```
Coach calls propose_cover_letter_update
  → AI SDK streams tool call to client (state: 'input-available')
  → chat-message.tsx identifies it as a write tool (name starts with 'propose_')
  → renders <ToolConfirmationCard> with:
      - rationale text
      - scrollable markdown preview of proposedContent
      - confirm / reject buttons
  → user confirms
  → buildWriteAction calls updateCoverLetterContent(letterId, proposedContent)
  → server action writes to DB (ownership validated via requireProfile())
  → ToolConfirmationCard dispatches 'cover-letter-updated' DOM event
  → cover-letter-workspace.tsx listener calls setContent(proposedContent)
  → workspace textarea reflects new content instantly (no reload)
```

## Files Changed

| File | Change |
|------|--------|
| `src/modules/chat/tools.ts` | Add `propose_cover_letter_update` tool (no `execute`) |
| `src/modules/chat/context.ts` | Update `cover_letter` system prompt to mention the new tool |
| `src/components/shell/chat-message.tsx` | Add `buildWriteAction` branch → `updateCoverLetterContent` |
| `src/components/shell/tool-confirmation-card.tsx` | Add `TOOL_LABELS` entry + markdown preview for cover letter proposals |
| `src/app/dashboard/cover-letters/[id]/_components/cover-letter-workspace.tsx` | Listen for `cover-letter-updated` event, call `setContent` |

## Confirmation Card UI

For `propose_cover_letter_update`, the `ToolConfirmationCard` renders:

1. Tool label: "Update cover letter"
2. Rationale text (from `args.rationale`)
3. Scrollable `max-h-64 overflow-y-auto` container with markdown-rendered `proposedContent` — uses the same markdown renderer the cover letter workspace already uses
4. Confirm / Reject buttons (existing pattern)

## System Prompt Update

The `cover_letter` context branch in `context.ts` gains an instruction:

> Use `propose_cover_letter_update` to propose changes to the cover letter content. The user will see a full markdown preview and must confirm before the change is applied.

## Out of Scope

- Paragraph-level / structured cover letter content (file a follow-up issue: split `content: string` into `sections: string[]` in the schema so the coach can target individual paragraphs)
- New API routes — `updateCoverLetterContent` server action is sufficient
- LLM usage logging — the apply step calls no LLM, so no `feature` tag needed
