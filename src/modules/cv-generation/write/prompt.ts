/**
 * Prompt pieces the section writers share. Pure.
 *
 * Block syntax comes from the writing desk's block registry (the same
 * descriptions and examples buildWritingContract gives external agents), never
 * copied into a prompt by hand, so it cannot drift from what the desk renders.
 * No contact details and no name reach a prompt: evidence text is scrubbed
 * (candidates.ts) and the header is code-rendered.
 */

import { CONTACT_PLACEHOLDER } from '@/modules/profile-map/contact'
import { getBlockDefinition } from '@/modules/writing-desk/markdown'
import type { BlockId } from '@/modules/writing-desk/markdown'
import type { CvBrief } from '../schema'
import type { Strategy } from '../strategy'

/** The registry's description and example for each block a writer may use. */
export function blockSyntax(ids: readonly BlockId[]): string {
  return ids
    .flatMap((id) => {
      const b = getBlockDefinition(id)
      return b ? [`### ${b.id} (${b.label})\n${b.description}\nExample:\n${b.example}`] : []
    })
    .join('\n\n')
}

/** What the writers are told about the contact line: they never write one. */
export const CONTACT_RULE = `Never write contact details. Code puts ${CONTACT_PLACEHOLDER} in the header.`

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
