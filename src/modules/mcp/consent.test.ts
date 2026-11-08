import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/auth', () => ({ auth: { api: { getOAuthClientPublicPrelogin: vi.fn() } } }))
import { auth } from '@/lib/auth'
import { getConsentDetails, oauthResumePath } from './consent'

beforeEach(() => {
  vi.stubEnv('BETTER_AUTH_URL', 'https://resume.example')
  vi.mocked(auth.api.getOAuthClientPublicPrelogin).mockResolvedValue({ client_name: 'Claude' } as never)
})

const query = () => new URLSearchParams({ client_id: 'client', redirect_uri: 'https://claude.ai/callback',
  resource: 'https://resume.example/api/mcp', scope: 'mcp:read mcp:write offline_access', sig: 'signed', exp: '123' })

describe('consent', () => {
  it('verifies the signed request through the provider before showing it', async () => {
    const params = query()
    const headers = new Headers()
    expect(await getConsentDetails(params, headers)).toEqual({ name: 'Claude', redirectHost: 'claude.ai',
      scopes: ['mcp:read', 'mcp:write', 'offline_access'], oauthQuery: params.toString() })
    expect(auth.api.getOAuthClientPublicPrelogin).toHaveBeenCalledWith({ body: { client_id: 'client', oauth_query: params.toString() }, headers })
  })
  it('rejects a request when provider signature verification fails', async () => {
    vi.mocked(auth.api.getOAuthClientPublicPrelogin).mockRejectedValue(new Error('invalid_signature'))
    await expect(getConsentDetails(query(), new Headers())).rejects.toThrow('invalid_signature')
  })
  it('rejects non-MCP permissions', async () => {
    const params = query(); params.set('scope', 'capture')
    await expect(getConsentDetails(params, new Headers())).rejects.toThrow('Unsupported access')
  })
  it('returns to the local provider after sign-in without repeating a forced login', () => {
    const params = query(); params.set('prompt', 'login consent')
    const target = new URL(oauthResumePath(params), 'https://resume.example')
    expect(target.pathname).toBe('/api/auth/oauth2/authorize')
    expect(target.searchParams.get('prompt')).toBe('consent')
    expect(target.searchParams.has('sig')).toBe(false)
    expect(target.searchParams.get('redirect_uri')).toBe('https://claude.ai/callback')
  })
})
