import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/auth', () => ({ auth: {} }))
vi.mock('@better-auth/oauth-provider', () => ({
  oauthProviderAuthServerMetadata: (_auth: unknown, options: { headers: HeadersInit }) =>
    async () => Response.json({ issuer: 'https://resume.example/api/auth' }, { headers: options.headers }),
}))
import { GET as resourceGet, OPTIONS as resourceOptions } from '@/app/.well-known/oauth-protected-resource/api/mcp/route'
import { GET as serverGet, OPTIONS as serverOptions } from '@/app/.well-known/oauth-authorization-server/api/auth/route'

describe('public discovery CORS', () => {
  it.each([resourceOptions, serverOptions])('answers a browser preflight without credentials', async options => {
    const response = options()
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-allow-methods')).toContain('GET')
    expect(response.headers.get('access-control-allow-headers')).toContain('MCP-Protocol-Version')
    expect(response.headers.has('access-control-allow-credentials')).toBe(false)
  })

  it('allows cross-origin reads on both documents', async () => {
    for (const response of [await resourceGet(), await serverGet(new Request('https://resume.example'))]) {
      expect(response.status).toBe(200)
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
    }
  })
})
