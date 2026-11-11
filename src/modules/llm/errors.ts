// Normalized LLM error surface. Product code catches LLMError (and its `kind`)
// instead of provider-specific SDK errors, so swapping providers later doesn't
// require touching every catch block.

import {
  AISDKError,
  APICallError,
  LoadAPIKeyError,
  LoadSettingError,
  NoContentGeneratedError,
  NoObjectGeneratedError,
  NoSuchModelError,
  TypeValidationError,
} from 'ai'

export type LLMErrorKind =
  | 'not_configured' // user hasn't entered an API key yet
  | 'config'         // bad model id, unsupported provider, malformed setup
  | 'auth'           // valid request, wrong/expired credentials
  | 'rate_limit'     // 429
  | 'unavailable'    // 5xx from provider
  | 'safety'         // policy refusal / empty output
  | 'invalid_output' // structured output didn't match schema
  | 'timeout'        // the caller's timeoutMs elapsed and the call was aborted
  | 'unsupported'    // the provider can't do what the call asked for (e.g. web search)
  | 'unknown'

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly kind: LLMErrorKind,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'LLMError'
  }
}

// Map AI SDK / provider errors to our normalized shape. Order matters — the
// most specific cases come first; AISDKError is a base class for many of them.
export type NormalizeLLMErrorOptions = {
  /**
   * Log only the zod issue paths for invalid output, never the raw model text
   * (which can echo untrusted input such as a job description). Default false.
   */
  redactInvalidOutput?: boolean
}

/** Zod issue paths only, e.g. ["requirements.3.text"], with no values or messages. */
function issuePaths(issues: unknown): string[] | undefined {
  if (!Array.isArray(issues)) return undefined
  return issues.map((i) => {
    const path = (i as { path?: unknown })?.path
    return Array.isArray(path) ? path.map(String).join('.') : '?'
  })
}

export function normalizeLLMError(err: unknown, opts: NormalizeLLMErrorOptions = {}): LLMError {
  if (err instanceof LLMError) return err

  if (err instanceof LoadAPIKeyError || err instanceof LoadSettingError) {
    // Shouldn't normally hit this — resolveConfig() raises 'not_configured'
    // before the SDK ever sees a missing key. Falls through to here only on
    // weird provider-SDK loader issues.
    return new LLMError(
      'LLM is not configured. Update your settings at /dashboard/settings/llm.',
      'config',
      err,
    )
  }

  if (err instanceof NoSuchModelError) {
    return new LLMError(`Configured LLM model not found: ${err.message}`, 'config', err)
  }

  if (err instanceof APICallError) {
    const status = err.statusCode
    if (status === 401 || status === 403) {
      return new LLMError('LLM auth failed — invalid key or unauthorized model.', 'auth', err)
    }
    if (status === 429) {
      return new LLMError('LLM rate limit exceeded — try again shortly.', 'rate_limit', err)
    }
    if (status != null && status >= 500) {
      return new LLMError('LLM provider unavailable — try again shortly.', 'unavailable', err)
    }
    return new LLMError(`LLM call failed: ${err.message}`, 'unknown', err)
  }

  if (err instanceof NoObjectGeneratedError || err instanceof TypeValidationError) {
    // Log the raw model output + zod issues to server logs so we can diagnose
    // schema mismatches in prod. Without this, you only see the generic toast.
    const raw = (err as { text?: unknown }).text
    const cause = (err as { cause?: unknown }).cause
    const issues = cause && typeof cause === 'object' && 'issues' in cause
      ? (cause as { issues: unknown }).issues
      : cause
    if (opts.redactInvalidOutput) {
      console.error('[LLM invalid_output]', { issuePaths: issuePaths(issues) })
    } else {
      console.error('[LLM invalid_output]', { rawText: raw, issues })
    }
    return new LLMError('LLM output did not match the expected schema.', 'invalid_output', err)
  }

  if (err instanceof NoContentGeneratedError) {
    return new LLMError('LLM returned no content — likely a safety refusal.', 'safety', err)
  }

  if (err instanceof AISDKError) {
    return new LLMError(`LLM error: ${err.message}`, 'unknown', err)
  }

  return new LLMError(
    err instanceof Error ? err.message : 'Unknown LLM error',
    'unknown',
    err,
  )
}
