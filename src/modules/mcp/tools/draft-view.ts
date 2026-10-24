import type { DraftFailure, DraftResult, DraftState } from '@/modules/writing-desk/draft'
import { McpToolError } from '../errors'
import { capText } from '../limits'

// A draft can be 500,000 characters but one tool response must stay well under
// MAX_TOOL_RESPONSE_CHARS (60,000) as valid JSON, so the draft is capped
// BEFORE serialising. Section hashes are always of the FULL text, so edits
// against a truncated section remain safe.
const MAX_SECTION_TEXT = 6_000
const MAX_TOTAL_TEXT = 20_000
const MAX_SECTIONS = 80
const MAX_WARNINGS = 15
const MAX_ISSUES = 25
const MAX_FIELD = 200
const MAX_FAILURE_TEXT = 8_000

const clip = (s: string) => (s.length > MAX_FIELD ? `${s.slice(0, MAX_FIELD)}...` : s)

type ViewSection = {
  id: string
  hash: string
  text: string
  truncated?: true
  fullLength?: number
}

function capSections(sections: DraftState['sections']): ViewSection[] {
  let budget = MAX_TOTAL_TEXT
  return sections.slice(0, MAX_SECTIONS).map(({ id, hash, text }) => {
    const allowed = Math.min(MAX_SECTION_TEXT, budget)
    if (text.length <= allowed) {
      budget -= text.length
      return { id, hash, text }
    }
    budget -= allowed
    return { id, hash, text: text.slice(0, allowed), truncated: true, fullLength: text.length }
  })
}

// The agent-facing view of a draft: capped, valid JSON, truncation flagged.
export function draftView(state: DraftState) {
  let sections = capSections(state.sections)
  const sectionsOmitted = state.sections.length - sections.length
  const warnings = state.warnings
    .slice(0, MAX_WARNINGS)
    .map(w => ({ kind: w.kind, message: clip(w.message), excerpt: clip(w.excerpt) }))
  const issues = state.issues
    .slice(0, MAX_ISSUES)
    .map(i => ({ severity: i.severity, message: clip(i.message), line: i.line }))

  const build = () => {
    const truncatedSections = sections.filter(s => s.truncated).length
    const cut =
      truncatedSections > 0 ||
      sectionsOmitted > 0 ||
      warnings.length < state.warnings.length ||
      issues.length < state.issues.length
    return {
      jobId: state.jobId,
      draftRevision: state.draftRevision,
      sections,
      warnings,
      issues,
      ...(cut
        ? {
            truncated: true,
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

  let view = build()
  // Pathological escaping (quotes, control characters) can inflate JSON; fall
  // back to ids and hashes only rather than ever returning broken JSON.
  if (JSON.stringify(view).length > 50_000) {
    sections = sections.map(s => ({ id: s.id, hash: s.hash, text: '', truncated: true, fullLength: s.text.length }))
    view = build()
  }
  return view
}

function issueLines(failure: DraftFailure): string {
  return (failure.issues ?? [])
    .slice(0, 50)
    .map(i => `- ${i.line !== undefined ? `line ${i.line}: ` : ''}${i.severity}: ${clip(i.message)}`)
    .join('\n')
}

const RETRY = 'Re-read the draft with get_draft and retry.'

// Turns a failed DraftResult into an actionable client-visible error.
export function draftFailureError(failure: DraftFailure): McpToolError {
  switch (failure.reason) {
    case 'invalid': {
      const lines = issueLines(failure)
      return new McpToolError(`${failure.message}${lines ? `\n${lines}` : ''}\nNothing was written.`)
    }
    case 'hash_mismatch': {
      const current = failure.current
      return new McpToolError(
        `${failure.message}${current ? ` Section "${current.id}" now has hash ${current.hash} and this text:\n${capText(current.text, MAX_FAILURE_TEXT)}` : ''}\n${RETRY}`,
      )
    }
    case 'section_not_found': {
      const ids = (failure.sections ?? []).slice(0, 100).map(s => s.id).join(', ')
      return new McpToolError(`${failure.message} Current section ids: ${ids || '(none)'}.\n${RETRY}`)
    }
    case 'draft_exists':
      return new McpToolError(
        'A draft already exists for this job. Read it with get_draft and edit it with replace_section, ' +
          'insert_section or remove_section, or ask the owner to discard the existing draft in the app first.',
      )
    case 'conflict':
    case 'live_changed':
      return new McpToolError(`${failure.message} ${RETRY}`)
    default:
      return new McpToolError(failure.message)
  }
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
