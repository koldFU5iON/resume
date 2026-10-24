import * as z from 'zod'
import { listJobsForAgent } from '@/modules/jobs/queries'
import type { McpToolDefinition } from '../registry'

const inputSchema = z.object({
  include: z
    .enum(['active', 'rejected', 'archived', 'all'])
    .default('active')
    .describe(
      "Which jobs to return. 'active' (default): not archived and not rejected. " +
        "'rejected': rejected but not archived. 'archived': archived jobs of any status. 'all': everything.",
    ),
  company: z
    .string()
    .max(200)
    .optional()
    .describe('Only return jobs whose company name contains this text (case-insensitive).'),
})

type ListJobsArgs = z.infer<typeof inputSchema>

export const listJobsTool: McpToolDefinition = {
  name: 'list_jobs',
  scope: 'mcp:read',
  description:
    "List the user's tracked job applications with id, title, company, status, dateApplied and lastUpdated, " +
    'most recently updated first. Use the returned id with other tools.',
  inputSchema,
  async handler(ctx, args: ListJobsArgs) {
    const jobs = await listJobsForAgent(ctx.profileId, {
      include: args.include,
      company: args.company,
    })
    return { jobs }
  },
}
