import type { McpToolDefinition } from '../registry'
import { getJobContextTool } from './get-job-context'
import { listJobsTool } from './list-jobs'

// Every tool the MCP server can expose. `createMcpServer` filters this list by
// the token's scopes. Add new tools here.
export const ALL_MCP_TOOLS: McpToolDefinition[] = [listJobsTool, getJobContextTool]
