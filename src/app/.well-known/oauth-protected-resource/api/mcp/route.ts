import { getMcpResourceMetadata } from '@/modules/mcp/oauth-config'
import { discoveryOptions, MCP_DISCOVERY_HEADERS } from '@/modules/mcp/discovery'

export async function GET() {
  return Response.json(getMcpResourceMetadata(), {
    headers: MCP_DISCOVERY_HEADERS,
  })
}

export const OPTIONS = discoveryOptions
