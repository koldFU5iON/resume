import * as z from 'zod'
import { getDraft } from '@/modules/writing-desk/draft'
import { validateDraftMarkdown } from '@/modules/writing-desk/validate'
import type { McpToolDefinition } from '../registry'
import { draftView, unwrapDraft } from './draft-view'

const inputSchema = z.object({
  jobId: z.string().min(1).max(100).describe('The job id returned by list_jobs.'),
})

export const validateDraftTool: McpToolDefinition = {
  name: 'validate_draft',
  scope: 'mcp:read',
  description:
    'Checks the current draft CV for a job against the structure rules and the profile, without changing anything. ' +
    'Returns { ok, issues, warnings }. Warnings flag claims the profile does not support: use only profile-supported ' +
    'claims (see get_job_context). The owner reviews and accepts the draft in the app.',
  inputSchema,
  async handler(ctx, args: z.infer<typeof inputSchema>) {
    const state = unwrapDraft(await getDraft(ctx.profileId, args.jobId))
    const { ok } = validateDraftMarkdown(state.content)
    const { issues, warnings, truncated, notice } = draftView(state)
    return { ok, issues, warnings, ...(truncated ? { truncated, notice } : {}) }
  },
}
