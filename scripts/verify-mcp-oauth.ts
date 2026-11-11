// Local Postgres integration check. Never runs against a remote database.
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { normalizeIP } from '@better-auth/core/utils/ip'
import { auth as authorizeClient, extractWWWAuthenticateParams, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'

async function main() {
  process.loadEnvFile('.env.local')
  const database = new URL(process.env.DATABASE_URL!)
  assert(['localhost', '127.0.0.1'].includes(database.hostname), 'Local database required')
  const { auth } = await import('../src/lib/auth')
  const { prisma } = await import('../src/lib/db')
  const { POST } = await import('../src/app/api/mcp/route')
  const { GET: resourceMetadata } = await import('../src/app/.well-known/oauth-protected-resource/api/mcp/route')
  const { GET: serverMetadata } = await import('../src/app/.well-known/oauth-authorization-server/api/auth/route')
  const { getMcpUrls } = await import('../src/modules/mcp/oauth-config')
  const { getConsentDetails, oauthResumePath } = await import('../src/modules/mcp/consent')
  const { revokeMcpConnection } = await import('../src/modules/mcp/connections')
  const { acceptDraft } = await import('../src/modules/writing-desk/draft')
  const { origin, issuer, resource } = getMcpUrls()
  const runId = randomBytes(8).toString('hex')
  const users: string[] = []
  const clients: string[] = []
  const ip = normalizeIP(`2001:db8:${runId.slice(0, 4)}:${runId.slice(4, 8)}::1`)
  const registrationIp = normalizeIP(`2001:db8:${runId.slice(8, 12)}:${runId.slice(12, 16)}::1`)

  async function request(path: string, body?: unknown, cookie?: string, form = false, requestIp = ip) {
    return auth.handler(new Request(`${issuer}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { origin, 'x-forwarded-for': requestIp, ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' }) },
      ...(body === undefined ? {} : { body: form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body) }),
    }))
  }
  async function json(response: Response) {
    const body = await response.json()
    assert(response.ok, `HTTP ${response.status}: ${JSON.stringify(body)}`)
    return body
  }
  async function signup(suffix: string) {
    const response = await request('/sign-up/email', { name: 'MCP integration check',
      email: `mcp-${runId}-${suffix}@example.invalid`, password: randomBytes(24).toString('base64url') })
    const body = await json(response)
    users.push(body.user.id)
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    assert(cookie, 'Sign-up must establish a session')
    return { id: body.user.id as string, cookie }
  }
  let clientInformation: OAuthClientInformationMixed | undefined
  let sdkTokens: OAuthTokens | undefined
  let codeVerifier = ''
  let authorizationUrl: URL | undefined
  const provider: OAuthClientProvider = {
    redirectUrl: 'https://client.example/callback',
    clientMetadata: { client_name: `MCP SDK check ${runId}`, redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: 'mcp:read' },
    state: () => runId,
    clientInformation: () => clientInformation,
    saveClientInformation: value => {
      clientInformation = value
      if (!clients.includes(value.client_id)) clients.push(value.client_id)
    },
    tokens: () => sdkTokens,
    saveTokens: value => { sdkTokens = value },
    redirectToAuthorization: value => { authorizationUrl = value },
    saveCodeVerifier: value => { codeVerifier = value },
    codeVerifier: () => codeVerifier,
  }
  const fetchFn: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    assert.equal(url.origin, origin, 'SDK requests must stay on the local issuer')
    if (url.pathname === '/.well-known/oauth-protected-resource/api/mcp') return resourceMetadata()
    if (url.pathname === '/.well-known/oauth-authorization-server/api/auth') return serverMetadata(req)
    if (url.pathname.startsWith('/api/auth/')) {
      req.headers.set('origin', origin)
      req.headers.set('x-forwarded-for', ip)
      return auth.handler(req)
    }
    return new Response(null, { status: 404 })
  }
  async function authorize(clientId: string, cookie?: string, scope = 'mcp:read mcp:write offline_access') {
    const verifier = randomBytes(32).toString('base64url')
    const query = new URLSearchParams({ client_id: clientId, redirect_uri: 'https://client.example/callback',
      response_type: 'code', scope, state: runId, resource,
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), prompt: 'consent' })
    const response = await request(`/oauth2/authorize?${query}`, undefined, cookie)
    const location = response.headers.get('location')
    assert(location, `Missing authorize redirect: ${response.status} ${await response.text()}`)
    return { verifier, location: new URL(location, origin) }
  }
  async function consent(clientId: string, cookie: string, scope: string, accept = true, existingAuthorization?: { verifier: string; location: URL }) {
    const authorization = existingAuthorization ?? await authorize(clientId, cookie)
    assert.equal(authorization.location.pathname, '/mcp/consent')
    const signed = authorization.location.searchParams
    const details = await getConsentDetails(signed, new Headers({ cookie }))
    assert(details.scopes.includes('mcp:write'))
    const changed = new URLSearchParams(signed); changed.set('scope', 'mcp:read')
    await assert.rejects(() => getConsentDetails(changed, new Headers({ cookie })))
    const result = await json(await request('/oauth2/consent', {
      accept, scope, oauth_query: signed.toString(),
    }, cookie))
    const callback = new URL(result.url)
    assert.equal(callback.searchParams.get('state'), runId)
    return { code: callback.searchParams.get('code')!, verifier: authorization.verifier, callback }
  }
  async function exchange(clientId: string, code: string, verifier: string) {
    return request('/oauth2/token', { grant_type: 'authorization_code', client_id: clientId,
      redirect_uri: 'https://client.example/callback', code, code_verifier: verifier, resource }, undefined, true)
  }
  async function rpc(accessToken: string | undefined, method: string, params?: unknown) {
    return POST(new Request(resource, { method: 'POST', headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }))
  }

  try {
    const unauthenticated = await rpc(undefined, 'tools/list')
    assert.equal(unauthenticated.status, 401)
    assert(unauthenticated.headers.get('www-authenticate')?.includes('resource_metadata='))
    assert(!unauthenticated.headers.get('www-authenticate')?.includes('error='))
    const owner = await signup('owner')
    const other = await signup('other')
    const sdkOptions = { serverUrl: resource, fetchFn, ...extractWWWAuthenticateParams(unauthenticated) }
    assert.equal(await authorizeClient(provider, sdkOptions), 'REDIRECT')
    assert(authorizationUrl && clientInformation)
    const discoveredScopes = authorizationUrl.searchParams.get('scope')!
    assert(discoveredScopes.split(' ').includes('offline_access'), 'SDK discovery must request offline_access')
    const clientId = clientInformation.client_id
    const login = await authorize(clientId)
    assert.equal(login.location.pathname, '/mcp/login')
    assert(oauthResumePath(login.location.searchParams).startsWith('/api/auth/oauth2/authorize?'))
    console.log('PASS registration, login redirect, and signed consent')

    const authorization = await request(`${authorizationUrl.pathname.slice('/api/auth'.length)}${authorizationUrl.search}`, undefined, owner.cookie)
    const approved = await consent(clientId, owner.cookie, discoveredScopes, true, {
      verifier: codeVerifier, location: new URL(authorization.headers.get('location')!, origin),
    })
    assert.equal(await authorizeClient(provider, { ...sdkOptions, authorizationCode: approved.code }), 'AUTHORIZED')
    const tokens = sdkTokens
    assert(tokens?.access_token && tokens.refresh_token, 'SDK-discovered grant must issue a refresh token')
    console.log('PASS SDK challenge discovery, registration, PKCE, and refresh-token issuance')
    await assert.rejects(() => prisma.oauthConsent.create({ data: {
      id: `duplicate-${runId}`, clientId, userId: owner.id, scopes: ['mcp:read'],
      createdAt: new Date(), updatedAt: new Date(),
    } }), (error: unknown) => (error as { code?: string }).code === 'P2002')
    // Replay a separate grant: Better Auth 1.7 revokes every token a replayed
    // code issued (RFC 6749 §4.1.2), which would kill the SDK grant used below.
    const replayed = await consent(clientId, owner.cookie, 'mcp:read mcp:write offline_access')
    const replayedTokens = await json(await exchange(clientId, replayed.code, replayed.verifier))
    assert(!(await exchange(clientId, replayed.code, replayed.verifier)).ok, 'Authorization code replay must fail')
    assert(!(await request('/oauth2/token', { grant_type: 'refresh_token', client_id: clientId,
      refresh_token: replayedTokens.refresh_token, resource }, undefined, true)).ok, 'Code replay must revoke the grant it issued')
    const toolList = await json(await rpc(tokens.access_token, 'tools/list'))
    assert.equal(toolList.result.tools.length, 14)
    const profile = await prisma.profile.findUniqueOrThrow({ where: { userId: owner.id } })
    const otherProfile = await prisma.profile.findUniqueOrThrow({ where: { userId: other.id } })
    const job = await prisma.jobApplication.create({ data: { profileId: profile.id, title: 'OAuth check', countries: [], tags: [] } })
    const foreignJob = await prisma.jobApplication.create({ data: { profileId: otherProfile.id, title: 'Private job', countries: [], tags: [] } })
    const listed = await json(await rpc(tokens.access_token, 'tools/call', { name: 'list_jobs', arguments: {} }))
    const jobs = JSON.parse(listed.result.content[0].text).jobs
    assert(jobs.some((item: { id: string }) => item.id === job.id))
    assert(!jobs.some((item: { id: string }) => item.id === foreignJob.id))
    const foreignRead = await json(await rpc(tokens.access_token, 'tools/call', { name: 'get_job_context', arguments: { jobId: foreignJob.id } }))
    assert(foreignRead.result.isError)
    const created = await json(await rpc(tokens.access_token, 'tools/call', { name: 'create_draft', arguments: { jobId: job.id, content: '# Integration CV\n\n## Profile\n\nOriginal profile.\n' } }))
    assert(!created.result.isError, JSON.stringify(created.result))
    const draft = JSON.parse(created.result.content[0].text)
    const section = draft.sections.find((item: { id: string }) => item.id === 'profile')
    const edit = await json(await rpc(tokens.access_token, 'tools/call', { name: 'replace_section', arguments: { jobId: job.id, sectionId: section.id, expectedHash: section.hash, content: '## Profile\n\nRevised profile.' } }))
    assert(!edit.result.isError, JSON.stringify(edit.result))
    const desk = await prisma.writingDeskDocument.findUniqueOrThrow({ where: { jobApplicationId: job.id } })
    assert.equal(desk.content, '')
    assert(desk.draftContent?.includes('Revised profile'))
    assert((await acceptDraft(profile.id, desk.id, desk.revision, desk.draftRevision)).ok)
    const accepted = await prisma.writingDeskDocument.findUniqueOrThrow({ where: { id: desk.id } })
    assert(accepted.content.includes('Revised profile') && accepted.draftContent === null)
    const event = await prisma.writingDeskDraftEvent.findFirstOrThrow({ where: { writingDeskId: desk.id } })
    assert.equal(event.apiTokenId, `oauth:${clientId}`)
    console.log('PASS token exchange, replay rejection, ownership, draft edit, and owner acceptance')

    const readOnly = await consent(clientId, other.cookie, 'mcp:read offline_access')
    const readTokens = await json(await exchange(clientId, readOnly.code, readOnly.verifier))
    const readList = await json(await rpc(readTokens.access_token, 'tools/list'))
    assert.equal(readList.result.tools.length, 10)
    assert(readList.result.tools.some((t: { name: string }) => t.name === 'profile_map'))
    const deniedWrite = await json(await rpc(readTokens.access_token, 'tools/call', { name: 'create_draft', arguments: { jobId: foreignJob.id, content: '# Denied' } }))
    assert(deniedWrite.error || deniedWrite.result?.isError)
    const refused = await consent(clientId, owner.cookie, 'mcp:read', false)
    assert.equal(refused.callback.searchParams.get('error'), 'access_denied')
    console.log('PASS read-only access, hidden/refused writes, and denied consent')

    const badPkce = await consent(clientId, owner.cookie, 'mcp:read mcp:write offline_access')
    assert(!(await exchange(clientId, badPkce.code, randomBytes(32).toString('base64url'))).ok)
    const wrongResource = await consent(clientId, owner.cookie, 'mcp:read mcp:write offline_access')
    assert(!(await request('/oauth2/token', { grant_type: 'authorization_code', client_id: clientId,
      redirect_uri: 'https://client.example/callback', code: wrongResource.code,
      code_verifier: wrongResource.verifier, resource: 'https://other.example/api/mcp' }, undefined, true)).ok)
    const expiredCode = await consent(clientId, owner.cookie, 'mcp:read mcp:write offline_access')
    await prisma.verification.updateMany({
      where: { value: { contains: `"state":"${runId}"` } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    assert(!(await exchange(clientId, expiredCode.code, expiredCode.verifier)).ok)
    assert.equal(await authorizeClient(provider, sdkOptions), 'AUTHORIZED')
    const refreshed = sdkTokens!
    assert(refreshed.refresh_token, 'SDK refresh must rotate the refresh token')
    assert.equal((await rpc(refreshed.access_token, 'tools/list')).status, 200)
    assert.notEqual(refreshed.refresh_token, tokens.refresh_token)
    assert(!(await request('/oauth2/token', { grant_type: 'refresh_token', client_id: clientId,
      refresh_token: tokens.refresh_token, resource }, undefined, true)).ok)
    await revokeMcpConnection(owner.id, clientId)
    assert.equal((await rpc(refreshed.access_token, 'tools/list')).status, 401)
    assert.equal((await rpc(tokens.access_token, 'tools/list')).status, 401)
    assert(!(await request('/oauth2/token', { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshed.refresh_token, resource }, undefined, true)).ok)
    assert.equal((await rpc(readTokens.access_token, 'tools/list')).status, 200)
    const reconnected = await consent(clientId, owner.cookie, 'mcp:read mcp:write offline_access')
    const reconnectTokens = await json(await exchange(clientId, reconnected.code, reconnected.verifier))
    assert.equal((await rpc(reconnectTokens.access_token, 'tools/list')).status, 200)
    assert.equal((await rpc(tokens.access_token, 'tools/list')).status, 401)
    console.log('PASS unique consent, PKCE/resource, expired codes, refresh replay, disconnect/reconnect, and user isolation')

    // Desktop clients (Claude Code) register a loopback http callback without
    // application_type; Better Auth 1.7 treats that as a web client.
    for (const redirect of ['http://127.0.0.1:33418/callback', 'http://localhost:6274/oauth/callback']) {
      const loopback = await json(await request('/oauth2/register', {
        client_name: `Loopback check ${runId}`, redirect_uris: [redirect],
        token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      }))
      clients.push(loopback.client_id)
    }
    assert(!(await request('/oauth2/register', {
      client_name: `Insecure check ${runId}`, redirect_uris: ['http://client.example/callback'],
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'],
    })).ok, 'Non-loopback http redirect URIs must be rejected')
    console.log('PASS loopback http callbacks register; other http callbacks are refused')

    for (let i = 0; i < 6; i++) {
      const response = await request('/oauth2/register', {
        client_name: `Rate limit check ${runId}`, redirect_uris: ['https://client.example/callback'],
        token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'],
      }, undefined, false, registrationIp)
      if (i < 5) clients.push((await json(response)).client_id)
      else {
        assert.equal(response.status, 429)
        assert(Number(response.headers.get('retry-after')) > 0)
      }
    }
    assert(await prisma.rateLimit.count({ where: { key: { startsWith: registrationIp } } }))
    console.log('PASS persistent registration limit: five allowed, sixth returns 429')
    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: registrationIp } } })
    const concurrent = await Promise.all(Array.from({ length: 12 }, () => request('/oauth2/register', {
      client_name: `Concurrent limit ${runId}`, redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'],
    }, undefined, false, registrationIp)))
    let registered = 0
    for (const response of concurrent) {
      if (response.ok) { clients.push((await json(response)).client_id); registered++ }
      else assert.equal(response.status, 429)
    }
    assert.equal(registered, 5, 'Concurrent registrations must share the same limit')
    const counter = await prisma.rateLimit.findUniqueOrThrow({ where: { key: `${registrationIp}|mcp-registration` } })
    assert.equal(counter.count, 6)
    await prisma.rateLimit.update({ where: { id: counter.id }, data: { lastRequest: BigInt(Date.now() - 61000) } })
    const afterWindow = await json(await request('/oauth2/register', {
      client_name: `Window reset ${runId}`, redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'],
    }, undefined, false, registrationIp))
    clients.push(afterWindow.client_id)
    console.log('PASS concurrent registration limit and window reset')
  } finally {
    await prisma.oauthClient.deleteMany({ where: { clientId: { in: clients } } })
    await prisma.user.deleteMany({ where: { id: { in: users } } })
    await prisma.rateLimit.deleteMany({ where: { OR: [ip, registrationIp].map(value => ({ key: { startsWith: value } })) } })
    await prisma.$disconnect()
  }
}

main().then(() => process.exit(0), error => { console.error(error); process.exit(1) })
