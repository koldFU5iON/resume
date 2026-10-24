import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { VerifiedToken } from '@/modules/api-tokens/service'
import { McpToolError } from './errors'
import { capText } from './limits'
import { toolsForScopes, type McpToolContext, type McpToolDefinition } from './registry'
import { ALL_MCP_TOOLS } from './tools'

export const MCP_SERVER_NAME = 'currnt'
export const MCP_SERVER_VERSION = '0.1.0'

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

// Builds a fresh MCP server for one authenticated request. Only tools allowed
// by the token's scopes are registered, so others are neither listed nor
// callable; each handler re-checks the scope as a second line of defence.
export function createMcpServer(
  auth: VerifiedToken,
  tools: McpToolDefinition[] = ALL_MCP_TOOLS,
): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION })
  const ctx: McpToolContext = { profileId: auth.profileId, tokenId: auth.tokenId }

  for (const tool of toolsForScopes(tools, auth.scopes)) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: unknown): Promise<CallToolResult> => {
        if (!auth.scopes.includes(tool.scope)) {
          return errorResult(`Token lacks the ${tool.scope} scope`)
        }
        try {
          const result = await tool.handler(ctx, args)
          return { content: [{ type: 'text', text: capText(JSON.stringify(result ?? null)) }] }
        } catch (err) {
          if (err instanceof McpToolError) return errorResult(err.message)
          console.error(`[mcp] tool "${tool.name}" failed (token ${auth.tokenId})`, err)
          return errorResult('Internal error')
        }
      },
    )
  }

  return server
}
