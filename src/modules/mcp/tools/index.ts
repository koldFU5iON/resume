import type { McpToolDefinition } from '../registry'
import { createDraftTool } from './create-draft'
import { getDraftTool } from './get-draft'
import { getJobContextTool } from './get-job-context'
import { insertSectionTool } from './insert-section'
import { listJobsTool } from './list-jobs'
import { profileTools } from './profile'
import { removeSectionTool } from './remove-section'
import { replaceSectionTool } from './replace-section'
import { validateDraftTool } from './validate-draft'

// Every tool the MCP server can expose. `createMcpServer` filters this list by
// the token's scopes. Add new tools here.
export const ALL_MCP_TOOLS: McpToolDefinition[] = [
  listJobsTool,
  getJobContextTool,
  ...profileTools,
  getDraftTool,
  validateDraftTool,
  createDraftTool,
  replaceSectionTool,
  insertSectionTool,
  removeSectionTool,
]
