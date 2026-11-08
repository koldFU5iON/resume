import { randomUUID } from 'node:crypto'
import { isValidIP, normalizeIP } from '@better-auth/core/utils/ip'
import { APIError } from 'better-auth/api'
import { prisma } from '@/lib/db'

export async function enforceMcpRegistrationLimit(headers?: Headers) {
  // The deployment proxy must overwrite X-Forwarded-For with the client IP.
  const ip = headers?.get('x-forwarded-for')?.split(',')[0].trim()
  if (!ip || !isValidIP(ip)) throw new APIError('BAD_REQUEST', { message: 'Client IP is required for registration' })
  const key = `${normalizeIP(ip)}|mcp-registration`
  // A single upsert serializes concurrent attempts, before any client is created.
  const [limit] = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "rateLimit" ("id", "key", "count", "lastRequest")
    VALUES (${randomUUID()}, ${key}, 1, floor(extract(epoch FROM statement_timestamp()) * 1000)::bigint)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "rateLimit"."lastRequest" <= EXCLUDED."lastRequest" - 60000
        THEN 1 ELSE LEAST("rateLimit"."count" + 1, 6) END,
      "lastRequest" = CASE WHEN "rateLimit"."lastRequest" <= EXCLUDED."lastRequest" - 60000
        THEN EXCLUDED."lastRequest" ELSE "rateLimit"."lastRequest" END
    RETURNING "count"
  `
  if (limit.count > 5) throw new APIError('TOO_MANY_REQUESTS', {
    message: 'Too many registration requests. Please try again later.',
  }, { 'Retry-After': '60' })
}
