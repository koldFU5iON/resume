import * as z from 'zod'
import { editDraftSection } from '@/modules/writing-desk/draft'
import { MAX_WRITING_DESK_CONTENT_LENGTH } from '@/modules/writing-desk/schema'
import type { McpToolDefinition } from '../registry'
import { writeResult } from './draft-view'

const inputSchema = z
  .object({
    jobId: z.string().min(1).max(100).describe('The job id returned by list_jobs.'),
    afterSectionId: z.string().min(1).max(200).optional().describe('Insert after this section id from get_draft.'),
    position: z.enum(['start', 'end']).optional().describe('Insert at the start or end when no afterSectionId is given.'),
    content: z.string().max(MAX_WRITING_DESK_CONTENT_LENGTH).refine(c => c.trim().length > 0, { message: 'content must not be empty; use remove_section to delete a section' }).describe('Markdown for the new section.'),
  })
  .refine(a => (a.afterSectionId === undefined) !== (a.position === undefined), {
    message: "Provide exactly one of afterSectionId or position ('start' | 'end')",
  })

export const insertSectionTool: McpToolDefinition = {
  name: 'insert_section',
  scope: 'mcp:write',
  description:
    'Inserts a new section into the draft CV, after a given section id or at the start or end. Call get_job_context ' +
    'first; use only profile-supported claims. After a section_not_found, re-read with get_draft and retry. Returns ' +
    'the updated sections and fact-check warnings. The owner reviews and accepts the draft in the app.',
  inputSchema,
  async handler(ctx, args: z.infer<typeof inputSchema>) {
    const op = {
      type: 'insert' as const,
      afterSectionId: args.afterSectionId,
      position: args.position,
      content: args.content,
    }
    return writeResult(await editDraftSection(ctx.profileId, args.jobId, op, { tokenId: ctx.tokenId }))
  },
}
