import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider'
import { auth } from '@/lib/auth'
import { discoveryOptions, MCP_DISCOVERY_HEADERS } from '@/modules/mcp/discovery'

export const GET = oauthProviderAuthServerMetadata(auth, {
  headers: MCP_DISCOVERY_HEADERS,
})

export const OPTIONS = discoveryOptions
