import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair } from 'jose'

vi.mock('@/lib/auth', () => ({ auth: { api: { getJwks: vi.fn() } } }))
import { auth } from '@/lib/auth'

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  const { publicKey } = await generateKeyPair('EdDSA')
  vi.mocked(auth.api.getJwks).mockResolvedValue({ keys: [{ ...await exportJWK(publicKey), kid: 'key' }] } as never)
})
afterEach(() => vi.useRealTimers())

describe('MCP signing key cache', () => {
  it('deduplicates concurrent reads and expires after a minute', async () => {
    const { getMcpKeySet } = await import('./keys')
    vi.useFakeTimers()
    const [a, b] = await Promise.all([getMcpKeySet(), getMcpKeySet()])
    expect(a).toBe(b)
    expect(auth.api.getJwks).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60001)
    await getMcpKeySet()
    expect(auth.api.getJwks).toHaveBeenCalledTimes(2)
  })

  it('allows a refresh for key rotation and does not cache outages', async () => {
    const { getMcpKeySet } = await import('./keys')
    vi.mocked(auth.api.getJwks).mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(getMcpKeySet()).rejects.toThrow('Database unavailable')
    await getMcpKeySet()
    await getMcpKeySet(true)
    expect(auth.api.getJwks).toHaveBeenCalledTimes(3)
  })
})
