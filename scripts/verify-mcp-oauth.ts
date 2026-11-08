// Local Postgres integration check. Never runs against a remote database.
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { normalizeIP } from '@better-auth/core/utils/ip'

async function main() {
  process.loadEnvFile('.env.local')
  const database = new URL(process.env.DATABASE_URL!)
  assert(['localhost', '127.0.0.1'].includes(database.hostname), 'Local database required')
  const { auth } = await import('../src/lib/auth')
  const { prisma } = await import('../src/lib/db')
  const { POST } = await import('../src/app/api/mcp/route')
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
  async function register() {
    const client = await json(await request('/oauth2/register', {
      client_name: `MCP check ${runId}`, redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }))
    clients.push(client.client_id)
    return client.client_id as string
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
  async function consent(clientId: string, cookie: string, scope: string, accept = true) {
    const authorization = await authorize(clientId, cookie)
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
    const clientId = await register()
    const login = await authorize(clientId)
    assert.equal(login.location.pathname, '/mcp/login')
    assert(oauthResumePath(login.location.searchParams).startsWith('/api/auth/oauth2/authorize?'))
    console.log('PASS registration, login redirect, and signed consent')

    const approved = await consent(clientId, owner.cookie, 'mcp:read mcp:write offline_access')
    const tokens = await json(await exchange(clientId, approved.code, approved.verifier))
    assert(tokens.access_token && tokens.refresh_token)
    await assert.rejects(() => prisma.oauthConsent.create({ data: {
      id: `duplicate-${runId}`, clientId, userId: owner.id, scopes: ['mcp:read'],
      createdAt: new Date(), updatedAt: new Date(),
    } }), (error: unknown) => (error as { code?: string }).code === 'P2002')
    assert(!(await exchange(clientId, approved.code, approved.verifier)).ok, 'Authorization code replay must fail')
    const toolList = await json(await rpc(tokens.access_token, 'tools/list'))
    assert.equal(toolList.result.tools.length, 8)
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
    assert.equal(readList.result.tools.length, 4)
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
    const refreshed = await json(await request('/oauth2/token', { grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.refresh_token, resource }, undefined, true))
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

    for (let i = 0; i < 6; i++) {
      const response = await request('/oauth2/register', {
        client_name: `Rate limit check ${runId}`, redirect_uris: ['https://client.example/callback'],
        token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'],
      }, undefined, false, registrationIp)
      if (i < 5) clients.push((await json(response)).client_id)
      else {
        assert.equal(response.status, 429)
        assert(Number(response.headers.get('x-retry-after')) > 0)
      }
    }
    assert(await prisma.rateLimit.count({ where: { key: { startsWith: registrationIp } } }))
    console.log('PASS persistent registration limit: five allowed, sixth returns 429')
  } finally {
    await prisma.oauthClient.deleteMany({ where: { clientId: { in: clients } } })
    await prisma.user.deleteMany({ where: { id: { in: users } } })
    await prisma.rateLimit.deleteMany({ where: { OR: [ip, registrationIp].map(value => ({ key: { startsWith: value } })) } })
    await prisma.$disconnect()
  }
}

main().then(() => process.exit(0), error => { console.error(error); process.exit(1) })
