import * as z from 'zod'
import { createDraft } from '@/modules/writing-desk/draft'
import { MAX_WRITING_DESK_CONTENT_LENGTH } from '@/modules/writing-desk/schema'
import type { McpToolDefinition } from '../registry'
import { writeResult } from './draft-view'

const inputSchema = z.object({
  jobId: z.string().min(1).max(100).describe('The job id returned by list_jobs.'),
  content: z.string().min(1).max(MAX_WRITING_DESK_CONTENT_LENGTH).describe('The full CV as Markdown.'),
})

export const createDraftTool: McpToolDefinition = {
  name: 'create_draft',
  scope: 'mcp:write',
  description:
    'Creates the draft CV for a job from full Markdown. Call get_job_context first and follow its writing contract; ' +
    'use only profile-supported claims. Fails if a draft already exists (edit its sections instead). Returns the ' +
    'sections, fact-check warnings and validation notes; warnings do not block the write. The owner reviews and ' +
    'accepts the draft in the app; you cannot accept it.',
  inputSchema,
  async handler(ctx, args: z.infer<typeof inputSchema>) {
    return writeResult(await createDraft(ctx.profileId, args.jobId, args.content, { tokenId: ctx.tokenId }))
  },
}
