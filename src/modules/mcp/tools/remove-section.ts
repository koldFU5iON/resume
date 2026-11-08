import * as z from 'zod'
import { editDraftSection } from '@/modules/writing-desk/draft'
import type { McpToolDefinition } from '../registry'
import { writeResult } from './draft-view'

const inputSchema = z.object({
  jobId: z.string().min(1).max(100).describe('The job id returned by list_jobs.'),
  sectionId: z.string().min(1).max(200).describe('Section id from get_draft.'),
  expectedHash: z.string().min(1).max(100).describe('The hash of that section from get_draft.'),
})

export const removeSectionTool: McpToolDefinition = {
  name: 'remove_section',
  scope: 'mcp:write',
  destructiveHint: true,
  description:
    'Removes one section from the draft CV. Pass the section id and its current hash from get_draft. After a ' +
    'hash_mismatch or section_not_found, re-read with get_draft and retry. Returns the remaining sections and ' +
    'fact-check warnings. The owner reviews and accepts the draft in the app.',
  inputSchema,
  async handler(ctx, args: z.infer<typeof inputSchema>) {
    const op = { type: 'remove' as const, sectionId: args.sectionId, expectedHash: args.expectedHash }
    return writeResult(await editDraftSection(ctx.profileId, args.jobId, op, { tokenId: ctx.tokenId }))
  },
}
