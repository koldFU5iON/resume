import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  CLOCK_SKEW_MS,
  continuationBaseUrl,
  CONTINUATION_PATH,
  CONTINUATION_TOKEN_TTL_MS,
  MAX_CONTINUATIONS,
  requestContinuation,
  shouldContinue,
  signContinuationToken,
  verifyContinuationHeader,
  verifyContinuationToken,
} from './continuation'

const NOW = 1_800_000_000_000

beforeEach(() => {
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-not-real')
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000/')
  vi.stubEnv('VERCEL_ENV', '')
  vi.stubEnv('VERCEL_URL', '')
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', '')
  vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', '')
})
afterEach(() => vi.unstubAllEnvs())

function token(profileId = 'p1', hop = 1, now = NOW): string {
  const t = signContinuationToken(profileId, hop, now)
  if (!t) throw new Error('no token')
  return t
}

describe('continuation token', () => {
  it('verifies a fresh token and returns its claims', () => {
    expect(verifyContinuationToken(token('p1', 3), NOW)).toEqual({ profileId: 'p1', hop: 3 })
    expect(verifyContinuationToken(token('p1', 3), NOW + CONTINUATION_TOKEN_TTL_MS)).toEqual({ profileId: 'p1', hop: 3 })
  })

  it('rejects an expired token', () => {
    expect(verifyContinuationToken(token(), NOW + CONTINUATION_TOKEN_TTL_MS + 1)).toBeNull()
  })

  it('rejects a token that lives longer than the TTL plus the skew margin', () => {
    // Signed "in the future": its exp is further away than the TTL allows.
    expect(verifyContinuationToken(token('p1', 1, NOW + CLOCK_SKEW_MS + 1), NOW)).toBeNull()
  })

  it('accepts a token from a signer whose clock is ahead by up to the skew margin', () => {
    expect(verifyContinuationToken(token('p1', 1, NOW + 20_000), NOW)).toEqual({ profileId: 'p1', hop: 1 })
    expect(verifyContinuationToken(token('p1', 1, NOW + CLOCK_SKEW_MS), NOW)).toEqual({ profileId: 'p1', hop: 1 })
  })

  it('binds the token to the signing deployment', () => {
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_preview1')
    const t = token()
    expect(t.split('.')[3]).toBe('dpl_preview1')
    expect(verifyContinuationToken(t, NOW)).toEqual({ profileId: 'p1', hop: 1 })
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_other')
    expect(verifyContinuationToken(t, NOW)).toBeNull()
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', '')
    expect(verifyContinuationToken(t, NOW)).toBeNull()
  })

  it('rejects a tampered signature', () => {
    const t = token()
    const last = t.at(-1) === 'A' ? 'B' : 'A'
    expect(verifyContinuationToken(t.slice(0, -1) + last, NOW)).toBeNull()
    expect(verifyContinuationToken(t.slice(0, -2), NOW)).toBeNull()
  })

  it('rejects a token whose profile, hop, expiry or deployment was changed', () => {
    const [, exp, hop, dep, sig] = token('p1', 2).split('.')
    expect(verifyContinuationToken(`p2.${exp}.${hop}.${dep}.${sig}`, NOW)).toBeNull()
    expect(verifyContinuationToken(`p1.${exp}.3.${dep}.${sig}`, NOW)).toBeNull()
    expect(verifyContinuationToken(`p1.${Number(exp) + 1}.${hop}.${dep}.${sig}`, NOW)).toBeNull()
    expect(verifyContinuationToken(`p1.${exp}.${hop}.dpl_x.${sig}`, NOW)).toBeNull()
  })

  it('rejects a token signed with another secret', () => {
    const t = token()
    vi.stubEnv('BETTER_AUTH_SECRET', 'another-secret')
    expect(verifyContinuationToken(t, NOW)).toBeNull()
  })

  it('does not sign with the auth secret directly (derived key)', async () => {
    const { createHmac } = await import('node:crypto')
    const t = token()
    const payload = t.split('.').slice(0, 4).join('.')
    const direct = createHmac('sha256', 'test-secret-not-real').update(payload).digest('base64url')
    expect(t.endsWith(`.${direct}`)).toBe(false)
  })

  it('is disabled without BETTER_AUTH_SECRET', () => {
    const t = token()
    vi.stubEnv('BETTER_AUTH_SECRET', '')
    expect(signContinuationToken('p1', 1, NOW)).toBeNull()
    expect(verifyContinuationToken(t, NOW)).toBeNull()
  })

  it('rejects malformed tokens and out-of-range hops', () => {
    for (const bad of ['', 'x', 'a.b.c', 'p1.1.1..sig.extra', 'p 1.1.1..sig', 'p1.-1.1..sig', 'p1.1.1.d p.sig']) {
      expect(verifyContinuationToken(bad, NOW)).toBeNull()
    }
    expect(signContinuationToken('p1', 0, NOW)).toBeNull()
    expect(verifyContinuationToken(token('p1', MAX_CONTINUATIONS + 1), NOW)).toBeNull()
  })

  it('reads a Bearer header only', () => {
    expect(verifyContinuationHeader(`Bearer ${token()}`, NOW)).toEqual({ profileId: 'p1', hop: 1 })
    expect(verifyContinuationHeader(token(), NOW)).toBeNull()
    expect(verifyContinuationHeader(null, NOW)).toBeNull()
  })
})

describe('shouldContinue', () => {
  it.each([
    ['deadline', true],
    ['cap', true],
    ['limit', false],
    ['empty', false],
    ['stuck', false],
  ] as const)('%s → %s', (exit, expected) => {
    expect(shouldContinue(exit, 0)).toBe(expected)
  })

  it('stops at the hop limit', () => {
    expect(shouldContinue('deadline', MAX_CONTINUATIONS - 1)).toBe(true)
    expect(shouldContinue('deadline', MAX_CONTINUATIONS)).toBe(false)
  })
})

describe('requestContinuation', () => {
  const ok = () => vi.fn(async () => new Response(null, { status: 202 }))

  it('POSTs a signed token to the drain route on BETTER_AUTH_URL', async () => {
    const fetch = ok()
    expect(await requestContinuation('p1', 2, { fetch: fetch as never })).toBe(true)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`http://localhost:3000${CONTINUATION_PATH}`)
    expect(init.method).toBe('POST')
    const auth = (init.headers as Record<string, string>).authorization
    expect(verifyContinuationHeader(auth)).toEqual({ profileId: 'p1', hop: 2 })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it("sends a preview's continuation to the preview itself, with the bypass header", async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('VERCEL_URL', 'example-preview.vercel.app')
    vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', 'bypass-not-real')
    const fetch = ok()
    expect(await requestContinuation('p1', 1, { fetch: fetch as never })).toBe(true)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://example-preview.vercel.app${CONTINUATION_PATH}`)
    expect((init.headers as Record<string, string>)['x-vercel-protection-bypass']).toBe('bypass-not-real')
  })

  it('sends no bypass header when the secret is unset', async () => {
    const fetch = ok()
    await requestContinuation('p1', 1, { fetch: fetch as never })
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).not.toHaveProperty('x-vercel-protection-bypass')
  })

  it('never logs the bypass secret or the token', async () => {
    vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', 'bypass-not-real')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await requestContinuation('p1', 1, { fetch: vi.fn(async () => new Response(null, { status: 403 })) as never })
    await requestContinuation('p1', 1, { fetch: vi.fn(async () => { throw new Error('bypass-not-real') }) as never })
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).not.toContain('bypass-not-real')
    expect(logged).not.toContain('Bearer')
    warn.mockRestore()
  })

  it('skips without BETTER_AUTH_URL', async () => {
    vi.stubEnv('BETTER_AUTH_URL', '')
    const fetch = ok()
    expect(await requestContinuation('p1', 1, { fetch: fetch as never })).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('skips without BETTER_AUTH_SECRET', async () => {
    vi.stubEnv('BETTER_AUTH_SECRET', '')
    const fetch = ok()
    expect(await requestContinuation('p1', 1, { fetch: fetch as never })).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('skips past the hop limit', async () => {
    const fetch = ok()
    expect(await requestContinuation('p1', MAX_CONTINUATIONS + 1, { fetch: fetch as never })).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('swallows a fetch failure and logs without detail', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetch = vi.fn(async () => { throw new Error('connect ECONNREFUSED secret-host') })
    await expect(requestContinuation('p1', 1, { fetch: fetch as never })).resolves.toBe(false)
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-host')
    warn.mockRestore()
  })

  it('reports a refused request as false', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetch = vi.fn(async () => new Response(null, { status: 401 }))
    expect(await requestContinuation('p1', 1, { fetch: fetch as never })).toBe(false)
    warn.mockRestore()
  })
})

describe('continuationBaseUrl', () => {
  it('uses BETTER_AUTH_URL outside Vercel and in production', () => {
    expect(continuationBaseUrl()).toBe('http://localhost:3000')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('VERCEL_URL', 'example-prod-hash.vercel.app')
    expect(continuationBaseUrl()).toBe('http://localhost:3000')
  })

  it("uses the deployment's own URL on previews", () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('VERCEL_URL', 'example-preview.vercel.app')
    expect(continuationBaseUrl()).toBe('https://example-preview.vercel.app')
  })

  it('is off on a preview without VERCEL_URL (never falls back to production)', () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(continuationBaseUrl()).toBeNull()
  })
})
