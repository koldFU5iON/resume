import type * as z from 'zod'
import type { ApiTokenScope } from '@/modules/api-tokens/service'

export type McpToolScope = 'mcp:read' | 'mcp:write'

// What a tool handler knows about the caller. Always derived from the verified
// bearer token, never from tool arguments.
export type McpToolContext = { profileId: string; tokenId: string }

export type McpToolDefinition = {
  name: string
  scope: McpToolScope
  destructiveHint?: boolean
  description: string
  inputSchema: z.ZodObject
  // Args arrive already parsed by `inputSchema`; each tool narrows the type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler(ctx: McpToolContext, args: any): Promise<unknown>
}

// Scopes are independent: `mcp:write` does not imply `mcp:read`.
export function toolsForScopes(
  tools: McpToolDefinition[],
  scopes: ApiTokenScope[],
): McpToolDefinition[] {
  return tools.filter(tool => scopes.includes(tool.scope))
}

// A token may use the MCP endpoint only if it carries at least one MCP scope.
export function hasAnyMcpScope(scopes: ApiTokenScope[]): boolean {
  return scopes.includes('mcp:read') || scopes.includes('mcp:write')
}
