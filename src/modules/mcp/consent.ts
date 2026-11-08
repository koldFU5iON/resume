import { auth } from '@/lib/auth'
import { getMcpUrls, MCP_OAUTH_SCOPES } from './oauth-config'

export function oauthSearchParams(values: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, item)
    }
  }
  return params
}

export function oauthResumePath(params: URLSearchParams) {
  const query = new URLSearchParams(params)
  for (const key of ['sig', 'exp', 'ba_iat', 'ba_pl']) query.delete(key)
  const prompt = query.get('prompt')?.split(' ').filter(value => value !== 'login' && value !== 'create')
  if (prompt?.length) query.set('prompt', prompt.join(' '))
  else query.delete('prompt')
  // Return to the provider, which revalidates the client, redirect, and PKCE.
  return `/api/auth/oauth2/authorize?${query}`
}

export async function getConsentDetails(params: URLSearchParams, headers: Headers) {
  if (!params.get('sig') || !params.get('exp')) throw new Error('Missing authorization request')
  const clientId = params.get('client_id')
  if (!clientId) throw new Error('Missing client')
  // This provider endpoint verifies oauth_query's signature and expiry before
  // returning metadata. Do not display client-chosen names from unsigned input.
  const client = await auth.api.getOAuthClientPublicPrelogin({
    body: { client_id: clientId, oauth_query: params.toString() },
    headers,
  })
  const scopes = params.get('scope')?.split(' ').filter(Boolean) ?? []
  if (!scopes.length || scopes.some(scope => !MCP_OAUTH_SCOPES.some(allowed => allowed === scope))) {
    throw new Error('Unsupported access requested')
  }
  // Provider 1.6 validates resource at token exchange and omits it from the
  // signed consent query. This issuer serves only the MCP audience.
  if (params.has('resource') && params.get('resource') !== getMcpUrls().resource) throw new Error('Incorrect MCP resource')
  return {
    name: client.client_name || 'External app',
    redirectHost: new URL(params.get('redirect_uri')!).host,
    scopes,
    oauthQuery: params.toString(),
  }
}
