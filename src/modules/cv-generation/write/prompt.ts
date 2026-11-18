/**
 * Prompt pieces the section writers share. Pure.
 *
 * No block syntax reaches a prompt: the writers return plain strings and code
 * builds every `:::` block. No contact details and no name reach a prompt:
 * evidence text is scrubbed (candidates.ts) and the header is code-rendered.
 */

import type { CvBrief } from '../schema'
import type { Strategy } from '../strategy'

/** Text that goes inside a delimited data block: the block's own tags are removed so it cannot be closed early. */
export function inBlock(text: string, tag: string): string {
  return text.replace(new RegExp(`</?\\s*${tag}\\s*>`, 'gi'), '')
}

export function data(tag: string, text: string): string {
  return `<${tag}>\n${inBlock(text, tag)}\n</${tag}>`
}

const bullets = (items: readonly string[]) => (items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : '(none)')

/** The brief as the writers read it: direction, not evidence. */
export function briefText(brief: CvBrief): string {
  return [
    `The problem the role is hired to solve: ${brief.hiddenQuestion}`,
    `Positioning: ${brief.positioning}`,
    `Tone: ${brief.tone}`,
    `Emphasise:\n${bullets(brief.emphasise.map((e) => `${e.item}: ${e.why}`))}`,
    `Play down (framing only; it never changes a title or hides an employer):\n${bullets(brief.playDown)}`,
  ].join('\n\n')
}

/** The job's requirements as plain text (must-have then nice-to-have), '' when none are known. */
export function requirementText(strategy: Pick<Strategy, 'mustHave' | 'niceToHave'>): string {
  return [...strategy.mustHave, ...strategy.niceToHave].join('\n')
}

export function requirementsBlock(strategy: Pick<Strategy, 'mustHave' | 'niceToHave'>): string {
  return `Must-have:\n${bullets(strategy.mustHave)}\n\nNice-to-have:\n${bullets(strategy.niceToHave)}`
}
