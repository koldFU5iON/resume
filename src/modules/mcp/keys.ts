import { createLocalJWKSet } from 'jose'
import { auth } from '@/lib/auth'

const CACHE_MS = 60_000
let cached: { until: number; value: Promise<ReturnType<typeof createLocalJWKSet>> } | undefined

export function getMcpKeySet(refresh = false) {
  if (refresh || !cached || cached.until <= Date.now()) {
    const value = auth.api.getJwks().then(keys => createLocalJWKSet(keys))
    cached = { until: Date.now() + CACHE_MS, value }
    void value.catch(() => { if (cached?.value === value) cached = undefined })
  }
  return cached.value
}
