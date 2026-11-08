export const MCP_SCOPES = ['mcp:read', 'mcp:write'] as const
export const MCP_OAUTH_SCOPES = [...MCP_SCOPES, 'offline_access'] as const

// A configured origin is required: tokens must never be bound to an arbitrary
// request Host header. Vercel's deployment origin is the preview fallback.
export function getMcpUrls() {
  const value = process.env.BETTER_AUTH_URL || (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000')
  const origin = new URL(/^https?:\/\//.test(value) ? value : `https://${value}`).origin
  return {
    origin,
    issuer: `${origin}/api/auth`,
    resource: `${origin}/api/mcp`,
    metadata: `${origin}/.well-known/oauth-protected-resource/api/mcp`,
  }
}

export function getMcpResourceMetadata() {
  const { resource, issuer } = getMcpUrls()
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: [...MCP_OAUTH_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'currnt',
  }
}

export function mcpAuthChallenge(error?: 'invalid_token' | 'insufficient_scope') {
  // Let discovery select all supported scopes, including offline_access for refresh.
  const scope = error === 'insufficient_scope' ? `, scope="${MCP_SCOPES.join(' ')}"` : ''
  return `Bearer resource_metadata="${getMcpUrls().metadata}"${scope}${error ? `, error="${error}"` : ''}`
}
