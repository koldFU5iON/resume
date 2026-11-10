/**
 * Queue continuation: a drain that stops on its deadline or run cap while rows
 * are still queued asks a fresh function invocation to keep draining, so a
 * large batch (or a backfill) finishes without another user trigger.
 *
 * The drain POSTs to CONTINUATION_PATH on BETTER_AUTH_URL with a short-lived
 * signed token naming the profile and the hop number. The route verifies it,
 * answers 202 at once and drains in after() with a fresh time budget. A chain
 * stops after MAX_CONTINUATIONS hops.
 *
 * Token: `<profileId>.<exp>.<hop>.<sig>`, where sig is base64url
 * HMAC-SHA256(key, "<profileId>.<exp>.<hop>") and key is
 * HMAC-SHA256(BETTER_AUTH_SECRET, CONTINUATION_KEY_LABEL), so the auth secret
 * never signs anything here directly. Valid for at most
 * CONTINUATION_TOKEN_TTL_MS. Without BETTER_AUTH_SECRET (or BETTER_AUTH_URL)
 * continuation is off and rows wait for the next trigger, as before.
 *
 * A token can be replayed until it expires; that only starts another drain
 * for the same profile, which the per-profile admission limit already bounds.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

export const CONTINUATION_PATH = '/api/internal/job-assessment/drain'

/** Most continuation hops one chain may make. */
export const MAX_CONTINUATIONS = 20

/** Token lifetime: long enough for one request, short enough to limit replay. */
export const CONTINUATION_TOKEN_TTL_MS = 2 * 60_000

/** Timeout for the continuation POST (the route answers 202 straight away). */
export const CONTINUATION_FETCH_TIMEOUT_MS = 5_000

const CONTINUATION_KEY_LABEL = 'job-assessment-continuation'

/** Why a drain stopped; see drainProfileQueue in queue.ts. */
export type DrainExit = 'empty' | 'limit' | 'deadline' | 'cap' | 'stuck'

export interface ContinuationClaims {
  profileId: string
  /** 1 for the first continuation of a chain, up to MAX_CONTINUATIONS. */
  hop: number
}

function continuationKey(): Buffer | null {
  const secret = process.env.BETTER_AUTH_SECRET?.trim()
  if (!secret) return null
  return createHmac('sha256', secret).update(CONTINUATION_KEY_LABEL).digest()
}

function sign(key: Buffer, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url')
}

const PROFILE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const INT_RE = /^\d{1,16}$/

/** A signed token for hop `hop` of `profileId`, or null when BETTER_AUTH_SECRET is unset. */
export function signContinuationToken(profileId: string, hop: number, now: number = Date.now()): string | null {
  const key = continuationKey()
  if (!key || !PROFILE_ID_RE.test(profileId) || !Number.isInteger(hop) || hop < 1) return null
  const payload = `${profileId}.${now + CONTINUATION_TOKEN_TTL_MS}.${hop}`
  return `${payload}.${sign(key, payload)}`
}

/** The claims of a valid, unexpired token; null for anything else. */
export function verifyContinuationToken(token: string | null | undefined, now: number = Date.now()): ContinuationClaims | null {
  const key = continuationKey()
  if (!key || !token) return null
  const parts = token.split('.')
  if (parts.length !== 4) return null
  const [profileId, expRaw, hopRaw, sig] = parts
  if (!PROFILE_ID_RE.test(profileId) || !INT_RE.test(expRaw) || !INT_RE.test(hopRaw)) return null

  const expected = Buffer.from(sign(key, `${profileId}.${expRaw}.${hopRaw}`))
  const given = Buffer.from(sig)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null

  const exp = Number(expRaw)
  const hop = Number(hopRaw)
  if (exp < now || exp > now + CONTINUATION_TOKEN_TTL_MS) return null
  if (hop < 1 || hop > MAX_CONTINUATIONS) return null
  return { profileId, hop }
}

/** Claims from an `Authorization: Bearer <token>` header value. */
export function verifyContinuationHeader(header: string | null, now: number = Date.now()): ContinuationClaims | null {
  const match = header?.match(/^Bearer (\S+)$/)
  return match ? verifyContinuationToken(match[1], now) : null
}

/**
 * Whether a drain that stopped with `exit` at hop `hop` should continue (when
 * rows are still queued). Only on 'deadline' and 'cap': on 'limit' the
 * running drains pick the rows up, 'empty' has its own re-check, and 'stuck'
 * must not loop.
 */
export function shouldContinue(exit: DrainExit, hop: number): boolean {
  return (exit === 'deadline' || exit === 'cap') && hop < MAX_CONTINUATIONS
}

function baseUrl(): string | null {
  const url = process.env.BETTER_AUTH_URL?.trim().replace(/\/+$/, '')
  return url ? url : null
}

export interface ContinuationDeps {
  fetch?: typeof fetch
}

/**
 * POSTs hop `hop` of `profileId` to the continuation route. Returns whether
 * the route accepted it (202). Never throws; logs without detail.
 */
export async function requestContinuation(
  profileId: string,
  hop: number,
  deps: ContinuationDeps = {},
): Promise<boolean> {
  try {
    const base = baseUrl()
    if (!base || hop > MAX_CONTINUATIONS) return false
    const token = signContinuationToken(profileId, hop)
    if (!token) return false
    const res = await (deps.fetch ?? fetch)(`${base}${CONTINUATION_PATH}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(CONTINUATION_FETCH_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (res.status === 202) return true
    console.warn('[job-assessment] continuation refused', { status: res.status, hop })
    return false
  } catch (err) {
    console.warn('[job-assessment] continuation failed', { error: err instanceof Error ? err.name : typeof err, hop })
    return false
  }
}
