// Internal API-tokens service. Pure functions + Prisma calls — no session
// lookup, so this module is callable from API routes (which authenticate via
// the bearer token itself) and from the action wrappers used by the UI.

import { createHash, randomBytes } from 'crypto'
import { prisma } from '@/lib/db'

// Tokens look like: rsm_<43 chars of base64url>
//   rsm_       — namespace prefix, makes leaked tokens trivially identifiable
//   43 chars   — 32 random bytes (256 bits of entropy) base64url-encoded
//
// We never store the raw token. SHA-256 is fine for hashing high-entropy
// secrets like this (no need for bcrypt; there's nothing to brute-force).
const TOKEN_NAMESPACE = 'rsm_'
const RAW_BYTES = 32
const PREFIX_DISPLAY_LEN = 12  // user-visible identifier in the tokens list

function generateRawToken(): string {
  return TOKEN_NAMESPACE + randomBytes(RAW_BYTES).toString('base64url')
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export const API_TOKEN_SCOPES = ['capture', 'mcp:read', 'mcp:write'] as const
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number]

export type VerifiedToken = {
  profileId: string
  tokenId: string
  scopes: ApiTokenScope[]
}

export type CreatedToken = {
  id: string
  token: string  // raw token — only returned at creation
  prefix: string
  name: string
}

export async function createApiToken(
  profileId: string,
  name: string,
  opts: { scopes?: ApiTokenScope[]; expiresAt?: Date | null } = {},
): Promise<CreatedToken> {
  const raw = generateRawToken()
  const hashed = hashToken(raw)
  const prefix = raw.slice(0, PREFIX_DISPLAY_LEN)

  const record = await prisma.apiToken.create({
    data: {
      profileId,
      name: name.trim() || 'Untitled token',
      hashedToken: hashed,
      prefix,
      scopes: opts.scopes ?? ['capture'],
      expiresAt: opts.expiresAt ?? null,
    },
    select: { id: true, prefix: true, name: true },
  })
  return { id: record.id, token: raw, prefix: record.prefix, name: record.name }
}

// Returned to the UI — never includes the raw or hashed token.
export type ApiTokenSummary = {
  id: string
  name: string
  prefix: string
  createdAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
  scopes: ApiTokenScope[]
  expiresAt: Date | null
}

export async function listApiTokens(profileId: string): Promise<ApiTokenSummary[]> {
  const rows = await prisma.apiToken.findMany({
    where: { profileId },
    select: { id: true, name: true, prefix: true, createdAt: true, lastUsedAt: true, revokedAt: true, scopes: true, expiresAt: true },
    orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
  })
  return rows.map(r => ({ ...r, scopes: r.scopes as ApiTokenScope[] }))
}

export async function revokeApiToken(profileId: string, tokenId: string): Promise<void> {
  const result = await prisma.apiToken.updateMany({
    where: { id: tokenId, profileId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  if (result.count === 0) throw new Error('Token not found or already revoked')
}

// Authentication path — called by API route handlers. Returns the owning
// profile id (and the token id, for logging) when the bearer token is valid.
// Returns null for anything that doesn't validate, so the caller controls the
// 401 response shape.
export async function verifyApiToken(rawToken: string): Promise<VerifiedToken | null> {
  if (!rawToken.startsWith(TOKEN_NAMESPACE)) return null
  const hashed = hashToken(rawToken)

  const record = await prisma.apiToken.findUnique({
    where: { hashedToken: hashed },
    select: { id: true, profileId: true, revokedAt: true, scopes: true, expiresAt: true },
  })
  if (!record || record.revokedAt) return null
  if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) return null

  // Best-effort lastUsedAt update — don't block the response if it fails.
  void prisma.apiToken
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {})

  return { profileId: record.profileId, tokenId: record.id, scopes: record.scopes as ApiTokenScope[] }
}

// Convenience for API route handlers — pulls the bearer token out of the
// Authorization header and verifies it. Returns null if anything's off.
export async function verifyBearerHeader(authHeader: string | null): Promise<VerifiedToken | null> {
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(\S+)$/i)
  if (!match) return null
  return verifyApiToken(match[1])
}
