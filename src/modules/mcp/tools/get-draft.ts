import * as z from 'zod'
import { getDraft } from '@/modules/writing-desk/draft'
import type { McpToolDefinition } from '../registry'
import { deskRef, documentIdInput, draftView, unwrapDraft } from './draft-view'

const inputSchema = z.object({
  jobId: z.string().min(1).max(100).describe('The job id returned by list_jobs.'),
  documentId: documentIdInput,
})

export const getDraftTool: McpToolDefinition = {
  name: 'get_draft',
  scope: 'mcp:read',
  description:
    "Reads the current agent draft CV for a job (or the document given by documentId) as addressable sections (id, hash, text), with the draft revision, " +
    'fact-check warnings and validation issues. Call get_job_context first when starting; re-read with get_draft ' +
    'after any hash_mismatch or section_not_found before retrying. Very long section text may be truncated and is ' +
    'flagged; hashes always cover the full text. The owner reviews and accepts the draft in the app.',
  inputSchema,
  async handler(ctx, args: z.infer<typeof inputSchema>) {
    return draftView(unwrapDraft(await getDraft(ctx.profileId, deskRef(args))))
  },
}
