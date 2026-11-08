import { createLocalJWKSet } from 'jose'
import { auth } from '@/lib/auth'

const CACHE_MS = 60_000
const REFRESH_COOLDOWN_MS = 5_000
let lastRefresh = -Infinity
let cached: { until: number; value: Promise<ReturnType<typeof createLocalJWKSet>> } | undefined

export function getMcpKeySet(refresh = false) {
  const now = Date.now()
  // Unknown key IDs are untrusted; they must not bypass caching on every call.
  if (!cached || cached.until <= now || (refresh && now - lastRefresh >= REFRESH_COOLDOWN_MS)) {
    if (refresh) lastRefresh = now
    const value = auth.api.getJwks().then(keys => createLocalJWKSet(keys))
    cached = { until: now + CACHE_MS, value }
    void value.catch(() => { if (cached?.value === value) cached = undefined })
  }
  return cached.value
}
