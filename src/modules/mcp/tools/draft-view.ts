import * as z from 'zod'
import type { DeskRef, DraftFailure, DraftResult, DraftState } from '@/modules/writing-desk/draft'
import { McpToolError } from '../errors'
import { capField, capText, escapedLength } from '../limits'

// A draft can be 500,000 characters but one tool response must stay well under
// MAX_TOOL_RESPONSE_CHARS (60,000) as valid JSON, so the draft is capped
// BEFORE serialising, measuring JSON-escaped length. Section hashes are always
// of the FULL text, so edits against a truncated section remain safe. Section
// ids are bounded at their source (sections.ts), never clipped here.
const TARGET_JSON_CHARS = 50_000
const MAX_FIELD_ESCAPED = 600
const MAX_FIELD_CHARS = 200
const MAX_FAILURE_TEXT = 8_000
const MAX_ERROR_MESSAGE = 10_000
const MAX_LISTED_IDS = 100
const MAX_ID_IN_MESSAGE = 100

// Progressively tighter limits; the loop in draftView uses the first that fits.
const LEVELS = [
  { total: 20_000, per: 6_000, sections: 80, warnings: 15, issues: 25 },
  { total: 10_000, per: 3_000, sections: 60, warnings: 10, issues: 15 },
  { total: 4_000, per: 1_500, sections: 40, warnings: 5, issues: 8 },
  { total: 0, per: 0, sections: 30, warnings: 0, issues: 0 },
  { total: 0, per: 0, sections: 10, warnings: 0, issues: 0 },
  { total: 0, per: 0, sections: 3, warnings: 0, issues: 0 },
]

// Every draft tool addresses a job and, when it has several Writing Desk
// documents, one of them (#370). Without documentId a job with several
// documents is refused (document_required), never guessed.
export const documentIdInput = z
  .string()
  .min(1)
  .max(100)
  .optional()
  .describe(
    'The Writing Desk document id, from get_job_context documents. Optional when the job has at most one ' +
      'document; required when it has several (the call is refused otherwise).',
  )

export function deskRef(args: { jobId: string; documentId?: string }): DeskRef {
  return args.documentId === undefined ? { jobId: args.jobId } : { jobId: args.jobId, documentId: args.documentId }
}

const clip = (s: string) => capField(s, MAX_FIELD_ESCAPED, MAX_FIELD_CHARS)
const clipId = (id: string) => (id.length > MAX_ID_IN_MESSAGE ? `${id.slice(0, MAX_ID_IN_MESSAGE)}...` : id)

type Level = (typeof LEVELS)[number]

function capSections(sections: DraftState['sections'], level: Level) {
  let budget = level.total
  return sections.slice(0, level.sections).map(({ id, hash, text }) => {
    const allowed = Math.min(level.per, budget)
    if (allowed > 0 && text.length <= allowed && escapedLength(text) <= allowed) {
      budget -= escapedLength(text)
      return { id, hash, text }
    }
    const shown = allowed > 0 ? capField(text, allowed, allowed) : ''
    budget -= allowed > 0 ? escapedLength(shown) : 0
    return { id, hash, text: shown, truncated: true as const, fullLength: text.length }
  })
}

function buildView(state: DraftState, level: Level) {
  const sections = capSections(state.sections, level)
  const sectionsOmitted = state.sections.length - sections.length
  const warnings = state.warnings
    .slice(0, level.warnings)
    .map(w => ({ kind: w.kind, message: clip(w.message), excerpt: clip(w.excerpt) }))
  const issues = state.issues
    .slice(0, level.issues)
    .map(i => ({ severity: i.severity, message: clip(i.message), line: i.line }))
  const truncatedSections = sections.filter(s => 'truncated' in s).length
  const cut =
    truncatedSections > 0 ||
    sectionsOmitted > 0 ||
    warnings.length < state.warnings.length ||
    issues.length < state.issues.length
  return {
    jobId: state.jobId,
    documentId: state.deskId,
    documentName: clip(state.documentName),
    draftRevision: state.draftRevision,
    sections,
    warnings,
    issues,
    ...(cut
      ? {
          truncated: true as const,
          notice:
            `Output was shortened to fit the response limit: ${truncatedSections} section text(s) truncated ` +
            `(marked truncated: true; the text shown is only a prefix), ${sectionsOmitted} later section(s) not listed, ` +
            `${state.warnings.length - warnings.length} warning(s) and ${state.issues.length - issues.length} issue(s) not shown. ` +
            'Do not compute edits from truncated text. Each hash is of the full section text, so replace_section or ' +
            'remove_section with that hash is still safe.',
        }
      : {}),
  }
}

// The agent-facing view of a draft: capped, always valid JSON under the cap,
// truncation flagged.
export function draftView(state: DraftState) {
  let view = buildView(state, LEVELS[0])
  for (const level of LEVELS) {
    view = buildView(state, level)
    if (JSON.stringify(view).length <= TARGET_JSON_CHARS) break
  }
  return view
}

function issueLines(failure: DraftFailure): string {
  return (failure.issues ?? [])
    .slice(0, 50)
    .map(i => `- ${i.line !== undefined ? `line ${i.line}: ` : ''}${i.severity}: ${i.message.slice(0, MAX_FIELD_CHARS)}`)
    .join('\n')
}

const RETRY = 'Re-read the draft with get_draft and retry.'

// Turns a failed DraftResult into an actionable client-visible error.
function describeFailure(failure: DraftFailure): McpToolError {
  switch (failure.reason) {
    case 'invalid': {
      const lines = issueLines(failure)
      if (!lines && failure.message.startsWith('The draft failed validation')) {
        return new McpToolError(
          'The edit was rejected as invalid but no specific error was reported. The arguments or content are ' +
            'likely malformed: check that the section id and hash are current (get_draft), that insert_section has ' +
            'exactly one of afterSectionId or position, and that content is non-empty Markdown that follows the ' +
            'writing contract. Nothing was written.',
        )
      }
      return new McpToolError(`${failure.message}${lines ? `\n${lines}` : ''}\nNothing was written.`)
    }
    case 'hash_mismatch': {
      const current = failure.current
      return new McpToolError(
        `${failure.message}${current ? ` Section "${current.id}" now has hash ${current.hash} and this text:\n${capText(current.text, MAX_FAILURE_TEXT)}` : ''}\n${RETRY}`,
      )
    }
    case 'section_not_found': {
      const ids = (failure.sections ?? []).slice(0, MAX_LISTED_IDS).map(s => clipId(s.id)).join(', ')
      return new McpToolError(`${failure.message} Current section ids: ${ids || '(none)'}.\n${RETRY}`)
    }
    case 'draft_exists':
      return new McpToolError(
        'A draft already exists for this document. Read it with get_draft and edit it with replace_section, ' +
          'insert_section or remove_section, or ask the owner to discard the existing draft in the app first.',
      )
    case 'conflict':
    case 'live_changed':
      return new McpToolError(`${failure.message} ${RETRY}`)
    default:
      return new McpToolError(failure.message)
  }
}

// The message is capped overall so no failure can flood the client.
export function draftFailureError(failure: DraftFailure): McpToolError {
  return new McpToolError(capText(describeFailure(failure).message, MAX_ERROR_MESSAGE))
}

export function unwrapDraft(result: DraftResult): DraftState {
  if (!result.ok) throw draftFailureError(result)
  return result.value
}

// Successful write result: the capped draft view; warnings (from checkFacts)
// and validation issues ride along but never fail the write.
export function writeResult(result: DraftResult) {
  return { ok: true, ...draftView(unwrapDraft(result)) }
}
