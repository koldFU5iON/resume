// Server-only client for TypeSafe's Jev (System One) model.
//
// Jev is the one exception to bring-your-own-key: the app pays for every call
// with TYPESAFE_API_KEY. Every call is written to LlmUsageLog with provider
// 'typesafe' so usage stays attributable per user, and a hard per-profile
// daily cap (JEV_DAILY_CALL_LIMIT) guards against runaway loops.
//
// The cap is enforced atomically: before sending, a transaction holding a
// per-profile advisory lock counts today's rows and inserts a reservation row
// (zero tokens). Concurrent calls queue on the lock, so they can't all pass a
// count taken before any of them wrote. After the call the reservation is
// updated with the real model, tokens and latency; a failed call keeps its
// row (zero tokens) with the feature marked `<feature>:failed`, so failures
// count towards the cap too and a failure loop stays bounded. A process that
// dies mid-call leaves the reservation as-is (counted, zero tokens).
//
// Failed calls always surface as JevError, never as an answer — callers must
// not read a failure as a "no". Question wording does not live here; see
// src/modules/job-assessment/questions.ts.

import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
  RateLimitError,
  TypeSafeClient,
  TypeSafeError,
  type EntryType,
  type Questions,
  type RequestOptions,
  type SystemOneResult,
} from '@typesafe-ai/sdk'
import { prisma } from '@/lib/db'

/** Pinned model. Upgrading changes answers, so it needs a new PIPELINE_VERSION. */
export const JEV_MODEL = 'jev-1.14.0'

export const JEV_PROVIDER = 'typesafe'

/** Appended to `feature` on the usage row of a failed call (see file header). */
import { JEV_FAILED_FEATURE_SUFFIX } from './constants'
export { JEV_FAILED_FEATURE_SUFFIX }

const DEFAULT_DAILY_CALL_LIMIT = 300

export type JevErrorKind =
  | 'not_configured'   // TYPESAFE_API_KEY unset
  | 'auth'             // 401 / 403
  | 'rate_limited'     // 429 after SDK retries
  | 'daily_cap'        // this profile hit JEV_DAILY_CALL_LIMIT today (no API call made)
  | 'overloaded'       // 529 after SDK retries
  | 'invalid_request'  // 400 / 422 / other 4xx, or rejected by the SDK before sending
  | 'context_exceeded' // 400 max_tokens_exceeded, or 413 body too large
  | 'unavailable'      // other 5xx, network failure, timeout

export class JevError extends Error {
  constructor(
    public readonly kind: JevErrorKind,
    message: string,
    public readonly status?: number,
    public readonly requestId?: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'JevError'
  }
}

/** State accepted by Jev: text or a JSON object/array (never null). */
export type JevState = NonNullable<EntryType>

export type JevRequest<Q extends Questions> = { state: JevState; questions: Q }

export type JevResult<Q extends Questions> = {
  answers: SystemOneResult<Q>['answers']
  /** Versioned model id the API reports having used. */
  model: string
  usage: { inputTokens: number; outputTokens: number }
  /** Wall-clock time of the call, SDK retries included. */
  latencyMs: number
  /** The exact request body sent, for replay storage. */
  request: { model: string; state: JevState; questions: Q }
}

export function isJevConfigured(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY?.trim())
}

let client: TypeSafeClient | null = null

// Created on first use so importing this module without the env var is safe.
function getClient(): TypeSafeClient {
  if (!client) {
    client = new TypeSafeClient({
      // Trimmed: a pasted key with a trailing newline would otherwise make an
      // invalid header and surface as a connection error instead of `auth`.
      apiKey: process.env.TYPESAFE_API_KEY?.trim(),
      defaultModel: JEV_MODEL,
      // Pinned so TYPESAFE_LOG_LEVEL=debug can't print request bodies (state) to logs.
      logLevel: 'warn',
    })
  }
  return client
}

// A blank, non-integer or < 1 value falls back to the default: an empty env var
// must not silently become a cap of 0. To switch Jev off, unset TYPESAFE_API_KEY.
function dailyCallLimit(): number {
  const raw = process.env.JEV_DAILY_CALL_LIMIT?.trim()
  const n = raw ? Number(raw) : NaN
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_DAILY_CALL_LIMIT
}

function startOfToday(): Date {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function mentionsMaxTokensExceeded(body: unknown): boolean {
  if (body == null) return false
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return text.includes('max_tokens_exceeded')
}

/** Maps SDK errors to JevError. Messages are our own: server detail can echo request content. */
export function normalizeJevError(err: unknown): JevError {
  if (err instanceof JevError) return err
  const cause = { cause: err }

  if (err instanceof APIError) {
    const { status, requestId } = err
    if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
      return new JevError('auth', `TypeSafe rejected the API key (${status}).`, status, requestId, cause)
    }
    if (err instanceof RateLimitError) {
      return new JevError('rate_limited', 'TypeSafe rate limit exceeded (429).', status, requestId, cause)
    }
    if (status === 529) {
      return new JevError('overloaded', 'TypeSafe is overloaded (529).', status, requestId, cause)
    }
    if (status === 413 || (err instanceof BadRequestError && mentionsMaxTokensExceeded(err.body))) {
      return new JevError('context_exceeded', `Jev request exceeds the model's context length (${status}).`, status, requestId, cause)
    }
    if (status >= 500 || status === 408) {
      // 408 is a server-side timeout the SDK already retried; treat as transient.
      return new JevError('unavailable', `TypeSafe server error (${status}).`, status, requestId, cause)
    }
    return new JevError('invalid_request', `TypeSafe rejected the request (${status}).`, status, requestId, cause)
  }
  if (err instanceof APIConnectionError) {
    // Includes APITimeoutError.
    return new JevError('unavailable', 'Could not reach TypeSafe (connection error or timeout).', undefined, undefined, cause)
  }
  if (err instanceof TypeSafeError) {
    // Thrown by the SDK before sending (e.g. empty questions). APIUserAbortError
    // lands here too, but askJev never passes an abort signal.
    return new JevError('invalid_request', 'Jev request was rejected before sending.', undefined, undefined, cause)
  }
  return new JevError('unavailable', 'Jev call failed unexpectedly.', undefined, undefined, cause)
}

/** SDK per-call options from askJev's bounds; undefined when none are set. */
function requestOptions(opts: { timeoutMs?: number; maxRetries?: number; maxRetryAfterMs?: number }): RequestOptions | undefined {
  const retry: { maxRetries?: number; maxRetryAfterMs?: number } = {}
  if (opts.maxRetries !== undefined) retry.maxRetries = opts.maxRetries
  if (opts.maxRetryAfterMs !== undefined) retry.maxRetryAfterMs = opts.maxRetryAfterMs
  const options: RequestOptions = {}
  if (opts.timeoutMs !== undefined) options.timeout = opts.timeoutMs
  if (Object.keys(retry).length > 0) options.retry = retry
  return Object.keys(options).length > 0 ? options : undefined
}

/** Advisory-lock key for the per-profile Jev quota (see reserveCall). */
export function jevQuotaLockKey(profileId: string): string {
  return `jev-quota:${profileId}`
}

/**
 * Atomically checks the daily cap and inserts a zero-token reservation row.
 * Throws JevError 'daily_cap' at the cap, and 'unavailable' when the
 * reservation itself can't be made (then Jev is not called).
 */
async function reserveCall(profileId: string, feature: string): Promise<string> {
  try {
    return await prisma.$transaction(async (tx) => {
      // Serialises reservations per profile until the transaction ends.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${jevQuotaLockKey(profileId)}))`
      const usedToday = await tx.llmUsageLog.count({
        where: { profileId, provider: JEV_PROVIDER, createdAt: { gte: startOfToday() } },
      })
      if (usedToday >= dailyCallLimit()) {
        throw new JevError('daily_cap', 'Daily Jev call limit reached for this profile.')
      }
      const row = await tx.llmUsageLog.create({
        data: {
          profileId,
          provider: JEV_PROVIDER,
          model: JEV_MODEL,
          feature,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          latencyMs: 0,
        },
        select: { id: true },
      })
      return row.id
    })
  } catch (err) {
    if (err instanceof JevError) throw err
    throw new JevError('unavailable', 'Could not reserve a Jev call (usage log unavailable).', undefined, undefined, { cause: err })
  }
}

/** Updates the reservation after the call. Never throws: the answer (or the call's error) matters more. */
async function settleReservation(
  id: string,
  data: { model?: string; feature?: string; promptTokens?: number; completionTokens?: number; totalTokens?: number; latencyMs: number },
): Promise<void> {
  await prisma.llmUsageLog.update({ where: { id }, data }).catch(() => {})
}

/**
 * Ask Jev one request of typed questions over `state` with the pinned model.
 * Throws JevError on every failure; writes one LlmUsageLog row per success.
 */
export async function askJev<const Q extends Questions>(
  profileId: string,
  request: JevRequest<Q>,
  opts: {
    /** Product feature for usage reporting, e.g. 'job-assessment-judge'. Required. */
    feature: string
    /**
     * Per-attempt timeout in ms (SDK default 10s). The SDK has no total budget,
     * so background callers bound the whole call with this plus `maxRetries`.
     */
    timeoutMs?: number
    /** Retries after the first attempt (SDK default 2). */
    maxRetries?: number
    /**
     * Longest server `Retry-After` to honour, in ms (SDK default 60s); longer
     * delays fall back to the SDK's short backoff.
     */
    maxRetryAfterMs?: number
  },
): Promise<JevResult<Q>> {
  if (!isJevConfigured()) {
    throw new JevError('not_configured', 'TYPESAFE_API_KEY is not set.')
  }

  // Hard cap: reserve a usage row atomically before sending.
  const reservationId = await reserveCall(profileId, opts.feature)

  const body = { model: JEV_MODEL, state: request.state, questions: request.questions }

  const startedAt = Date.now()
  let result: SystemOneResult<Q>
  try {
    let jev: TypeSafeClient
    try {
      jev = getClient()
    } catch (err) {
      // Constructor rejected the config (e.g. a malformed TYPESAFE_BASE_URL).
      throw new JevError('not_configured', 'TypeSafe client could not be created; check TYPESAFE_* env vars.', undefined, undefined, { cause: err })
    }
    const options = requestOptions(opts)
    result = await (options ? jev.systemOne(body, options) : jev.systemOne(body))
  } catch (err) {
    // Keep the reservation (it counts towards the cap), marked as failed.
    await settleReservation(reservationId, {
      feature: `${opts.feature}${JEV_FAILED_FEATURE_SUFFIX}`,
      latencyMs: Date.now() - startedAt,
    })
    throw normalizeJevError(err)
  }
  const latencyMs = Date.now() - startedAt

  const inputTokens = result.usage.input_tokens ?? 0
  const outputTokens = result.usage.output_tokens ?? 0

  await settleReservation(reservationId, {
    model: result.model,
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    totalTokens: inputTokens + outputTokens,
    latencyMs,
  })

  return {
    answers: result.answers,
    model: result.model,
    usage: { inputTokens, outputTokens },
    latencyMs,
    request: body,
  }
}
