// Auth for Vercel Cron routes: Vercel sends `Authorization: Bearer $CRON_SECRET`
// when the CRON_SECRET env var is set. Without it, cron routes refuse every call.

import { createHash, timingSafeEqual } from 'node:crypto'

const digest = (s: string) => createHash('sha256').update(s).digest()

/** True when the request carries the CRON_SECRET bearer token (constant-time compare). */
export function isAuthorizedCronRequest(request: Request, secret: string | undefined = process.env.CRON_SECRET): boolean {
  const expected = secret?.trim()
  if (!expected) return false
  const header = request.headers.get('authorization') ?? ''
  return timingSafeEqual(digest(header), digest(`Bearer ${expected}`))
}
