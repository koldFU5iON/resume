// Server-only LLM façade — bring-your-own-key. Each user supplies their own
// provider API key via /dashboard/settings/llm; this module fetches their
// settings, decrypts the key, and runs the call against the provider they
// chose. Token costs land on the user's account, not the app owner's.
//
// Product features call complete()/completeStructured() with a profileId and
// never import from 'ai' or any provider SDK directly — adding a new provider
// is a single addition to PROVIDERS below, with no ripple beyond this file.

import { generateText, Output, NoObjectGeneratedError, type LanguageModel, type LanguageModelUsage, type ToolSet } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { z } from 'zod'
import { after } from 'next/server'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/encryption'
import { LLMError, normalizeLLMError } from './errors'
import { extractJSON } from './extract-json'
import { resolveAttribution, type LlmAttribution } from './attribution'
import { availableModelIds, normalizeModelRoleChoices, resolveRoleModel, type ModelRole, type ModelRoleChoices } from './roles'
import { googleSearchQueryCount, webSearchTools, type WebSearchOptions } from './web-search'

export type { LlmAttribution } from './attribution'
export type { ModelRole } from './roles'
export type { WebSearchOptions } from './web-search'

// Supported providers. Adding a new one is a single entry here — the factory
// receives the user's decrypted API key and the model id and returns a
// LanguageModel suitable for generateText.
type ProviderFactory = (apiKey: string, modelId: string) => LanguageModel

const PROVIDERS: Record<string, ProviderFactory> = {
  anthropic: (apiKey, modelId) => createAnthropic({ apiKey })(modelId),
  openai: (apiKey, modelId) => createOpenAI({ apiKey })(modelId),
  google: (apiKey, modelId) => createGoogleGenerativeAI({ apiKey })(modelId),
}

export const SUPPORTED_PROVIDERS = Object.keys(PROVIDERS) as ReadonlyArray<keyof typeof PROVIDERS>

export type UsageLogEntry = {
  profileId: string
  provider: string
  model: string
  feature: string | null
  /** Model role the call asked for (see ./roles.ts). */
  role?: string | null
  promptTokens: number
  completionTokens: number
  totalTokens: number
  latencyMs: number
  cacheReadTokens?: number | null
  cacheWriteTokens?: number | null
  serverToolCalls?: number | null
  /** False when the token counts are placeholders, not provider-reported. Default true. */
  usageKnown?: boolean
  /** Job/CV/run this call belongs to; validated against profileId before writing. */
  attribution?: LlmAttribution
  /** 'ok' (default) or 'error' for a provider call that failed. */
  status?: 'ok' | 'error'
  /** LLMError kind of a failed call. */
  errorKind?: string | null
}

/**
 * LlmUsageLog writer for the LLM layer. Never throws — usage logging must
 * never crash the caller. (The app-billed Jev client writes its own rows: it
 * reserves one before each call to enforce its daily cap.)
 */
export async function writeUsageLog(entry: UsageLogEntry): Promise<void> {
  try {
    const { attribution, ...data } = entry
    const resolved = await resolveAttribution(entry.profileId, attribution)
    await prisma.llmUsageLog.create({ data: { ...data, ...resolved } })
  } catch {
    // Swallowed: see above.
  }
}

/** Token columns for a usage row. Missing usage is recorded as unknown, not as a measured zero. */
export function usageColumns(usage: LanguageModelUsage | undefined): Pick<
  UsageLogEntry,
  'promptTokens' | 'completionTokens' | 'totalTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'usageKnown'
> {
  const known = usage !== undefined && (usage.inputTokens !== undefined || usage.outputTokens !== undefined)
  return {
    promptTokens: usage?.inputTokens ?? 0,
    completionTokens: usage?.outputTokens ?? 0,
    totalTokens: usage?.totalTokens ?? (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
    cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens ?? null,
    cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens ?? null,
    usageKnown: known,
  }
}

type ContentLike = { type: string; providerExecuted?: boolean }

/**
 * Provider-executed tool calls (e.g. Anthropic web search/fetch, billed per
 * call) across all steps of a result, or null when the result carries no
 * content to count.
 */
export function countServerToolCalls(result: {
  steps?: ReadonlyArray<{ content?: ReadonlyArray<ContentLike> }>
  content?: ReadonlyArray<ContentLike>
}): number | null {
  const contents = result.steps?.length
    ? result.steps.map((s) => s.content)
    : [result.content]
  if (contents.every((c) => c === undefined)) return null
  let n = 0
  for (const c of contents) {
    for (const part of c ?? []) if (part.type === 'tool-call' && part.providerExecuted) n++
  }
  return n
}

/**
 * Server tool calls for a usage row. Google reports grounding searches only
 * in provider metadata, so a web-search call on Google counts its queries.
 */
function serverToolCallsFor(
  provider: string,
  result: Parameters<typeof countServerToolCalls>[0] & { providerMetadata?: unknown },
  webSearch: boolean,
): number | null {
  const counted = countServerToolCalls(result)
  if (provider === 'google' && webSearch) {
    const queries = googleSearchQueryCount(result.providerMetadata)
    if (queries !== null) return Math.max(counted ?? 0, queries)
  }
  return counted
}

/** Role for the usage row. An explicit model with no role isn't a task role, so it's left unset. */
function loggedRole(opts: Pick<CompleteOptions, 'role' | 'model'>): ModelRole | null {
  return opts.role ?? (opts.model ? null : 'default')
}

function logUsage(
  profileId: string,
  provider: string,
  model: string,
  opts: Pick<CompleteOptions, 'feature' | 'attribution' | 'role' | 'model'>,
  usage: LanguageModelUsage | undefined,
  latencyMs: number,
  serverToolCalls: number | null,
): void {
  after(() =>
    writeUsageLog({
      profileId,
      provider,
      model,
      feature: opts.feature ?? null,
      role: loggedRole(opts),
      ...usageColumns(usage),
      serverToolCalls,
      latencyMs,
      attribution: opts.attribution,
    }),
  )
}

/**
 * Logs a provider call that failed, so failures and retries count in per-job
 * costing. Tokens are recorded as unknown unless the error carries usage
 * (e.g. structured output the model produced but that didn't match the
 * schema). Never throws: the caller's original error matters more.
 */
function logFailedCall(
  profileId: string,
  provider: string,
  model: string,
  opts: Pick<CompleteOptions, 'feature' | 'attribution' | 'role' | 'model'>,
  error: LLMError,
  rawError: unknown,
  latencyMs: number,
): void {
  try {
    const usage = NoObjectGeneratedError.isInstance(rawError) ? rawError.usage : undefined
    after(() =>
      writeUsageLog({
        profileId,
        provider,
        model,
        feature: opts.feature ?? null,
        role: loggedRole(opts),
        ...usageColumns(usage),
        serverToolCalls: null,
        latencyMs,
        attribution: opts.attribution,
        status: 'error',
        errorKind: error.kind,
      }),
    )
  } catch {
    // Swallowed: see above.
  }
}

/**
 * Throws LLMError kind 'not_configured' when the user has no key. For callers
 * that want to fail before doing other work (e.g. fetching a page).
 */
export async function assertLLMConfigured(profileId: string): Promise<void> {
  const settings = await prisma.userSettings.findUnique({
    where: { profileId },
    select: { llmApiKey: true },
  })
  if (!settings?.llmApiKey) {
    throw new LLMError(
      'No LLM API key configured. Add one at /dashboard/settings/llm.',
      'not_configured',
    )
  }
}

type ResolvedConfig = {
  provider: string
  model: string
  apiKey: string
}

function samplingOptions(provider: string, model: string, temperature: number | undefined) {
  // Anthropic's v5 Sonnet, Opus and Haiku models reject non-default sampling
  // values with a 400. Keep existing tuning for earlier Claude models and other providers.
  if (provider === 'anthropic' && /^claude-(?:sonnet|opus|haiku)-[5-9](?:\D|$)/.test(model)) {
    return {}
  }
  return temperature === undefined ? {} : { temperature }
}

/** Provider, key and model for a call: `opts.model` if given, else the model for `opts.role`. */
async function resolveConfig(profileId: string, opts: Pick<CompleteOptions, 'model' | 'role'>): Promise<ResolvedConfig> {
  const settings = await prisma.userSettings.findUnique({
    where: { profileId },
    select: { llmProvider: true, llmModel: true, llmApiKey: true, availableModels: true, llmModelRoles: true },
  })

  if (!settings?.llmApiKey) {
    throw new LLMError(
      'No LLM API key configured. Add one at /dashboard/settings/llm.',
      'not_configured',
    )
  }

  const provider = settings.llmProvider
  if (!PROVIDERS[provider]) {
    throw new LLMError(
      `Unsupported LLM provider "${provider}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}.`,
      'config',
    )
  }

  const apiKey = decrypt(settings.llmApiKey)
  if (!apiKey) {
    // Decryption failure usually means ENCRYPTION_KEY rotated without backfill.
    // Either way, the stored ciphertext is unusable; tell the user to re-enter.
    throw new LLMError(
      'Stored API key could not be decrypted. Re-enter your key in settings.',
      'config',
    )
  }

  const model = opts.model ?? resolveRoleModel(
    {
      provider,
      defaultModel: settings.llmModel,
      availableModels: availableModelIds(settings.availableModels),
      choices: normalizeModelRoleChoices(settings.llmModelRoles),
    },
    opts.role ?? 'default',
  ).model

  return { provider, model, apiKey }
}

export async function resolveModelForChat(profileId: string): Promise<{ languageModel: LanguageModel; provider: string; model: string }> {
  const settings = await prisma.userSettings.findUnique({
    where: { profileId },
    select: { llmProvider: true, llmModel: true, chatModel: true, llmApiKey: true },
  })

  if (!settings?.llmApiKey) {
    throw new LLMError(
      'No LLM API key configured. Add one at /dashboard/settings/llm.',
      'not_configured',
    )
  }

  const provider = settings.llmProvider
  if (!PROVIDERS[provider]) {
    throw new LLMError(
      `Unsupported LLM provider "${provider}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}.`,
      'config',
    )
  }

  const apiKey = decrypt(settings.llmApiKey)
  if (!apiKey) {
    throw new LLMError(
      'Stored API key could not be decrypted. Re-enter your key in settings.',
      'config',
    )
  }

  const modelId = settings.chatModel ?? settings.llmModel
  return {
    languageModel: PROVIDERS[provider](apiKey, modelId),
    provider,
    model: modelId,
  }
}

export type CompleteOptions = {
  /**
   * What kind of work this call is; the user's settings pick the model for
   * it (see ./roles.ts). Default 'default' (the user's main model). Feature
   * code uses this, never `model`.
   */
  role?: ModelRole
  /**
   * Explicit model id, overriding `role`. Only for tests and admin tools:
   * feature code must not name model ids.
   */
  model?: string
  /**
   * Turn on the provider's server-side web search for this call. Throws
   * LLMError kind 'unsupported' when the provider has none. Searches are
   * recorded in the usage row's serverToolCalls.
   */
  webSearch?: WebSearchOptions
  /** System prompt — sets persona / constraints separately from the user prompt. */
  system?: string
  /** Cap on generated tokens. Useful for keeping costs bounded. */
  maxOutputTokens?: number
  /** 0–1; lower = more deterministic. */
  temperature?: number
  /**
   * Abort the call after this many ms (AbortSignal.timeout, SDK retries
   * included). An elapsed timeout throws LLMError kind 'timeout'.
   */
  timeoutMs?: number
  /** Log only zod issue paths (not raw model output) on invalid structured output. */
  redactInvalidOutput?: boolean
  /** Product feature that triggered this call. Required — every LLM call must be attributed.
   *  Use a short kebab-case string matching an entry in FEATURE_LABELS in feature-labels.ts.
   *  Example: 'job-fit', 'cv-import', 'profile-summary'. */
  feature: string
  /**
   * Job application / CV / run this call is for. Optional: profile-only work
   * (master profile, chat) passes none and stays unattributed. Validated
   * against profileId before it is written; see ./attribution.ts.
   */
  attribution?: LlmAttribution
}

type ResponseMeta = {
  provider: string
  model: string
  usage: LanguageModelUsage
  latencyMs: number
}

export type CompleteResult = ResponseMeta & {
  text: string
  finishReason: string
  /** Web pages the provider cited or searched (web search calls); empty otherwise. */
  sources: WebSource[]
}

export type WebSource = { url: string; title: string | null }

/** URL sources from a generateText result, deduplicated by URL. */
function webSources(sources: ReadonlyArray<{ sourceType: string; url?: string; title?: string }> | undefined): WebSource[] {
  const out = new Map<string, WebSource>()
  for (const s of sources ?? []) {
    if (s.sourceType === 'url' && typeof s.url === 'string' && !out.has(s.url)) {
      out.set(s.url, { url: s.url, title: s.title ?? null })
    }
  }
  return [...out.values()]
}

export async function complete(
  profileId: string,
  prompt: string,
  opts: CompleteOptions,
): Promise<CompleteResult> {
  const cfg = await resolveConfig(profileId, opts)
  const modelId = cfg.model
  const model = PROVIDERS[cfg.provider](cfg.apiKey, modelId)
  const tools = searchTools(cfg.provider, opts)

  const signal = timeoutSignal(opts)
  const startedAt = Date.now()
  try {
    const result = await generateText({
      model,
      prompt,
      system: opts.system,
      maxOutputTokens: opts.maxOutputTokens,
      ...samplingOptions(cfg.provider, modelId, opts.temperature),
      ...(tools ? { tools } : {}),
      ...(signal ? { abortSignal: signal } : {}),
    })
    const latencyMs = Date.now() - startedAt
    logUsage(profileId, cfg.provider, modelId, opts, result.usage, latencyMs, serverToolCallsFor(cfg.provider, result, !!tools))
    return {
      text: result.text,
      finishReason: result.finishReason,
      sources: webSources(result.sources),
      provider: cfg.provider,
      model: modelId,
      usage: result.usage,
      latencyMs,
    }
  } catch (err) {
    const error = callError(err, signal, opts)
    logFailedCall(profileId, cfg.provider, modelId, opts, error, err, Date.now() - startedAt)
    throw error
  }
}

export type CompleteStructuredResult<T> = ResponseMeta & {
  object: T
}

const ZERO_USAGE: LanguageModelUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  inputTokenDetails: {
    noCacheTokens: undefined,
    cacheReadTokens: undefined,
    cacheWriteTokens: undefined,
  },
  outputTokenDetails: {
    textTokens: undefined,
    reasoningTokens: undefined,
  },
}

/** Search tools for `opts.webSearch`, or undefined. Throws LLMError 'unsupported' for a provider without search. */
function searchTools(provider: string, opts: CompleteOptions): ToolSet | undefined {
  return opts.webSearch ? webSearchTools(provider, opts.webSearch) : undefined
}

/** The caller's timeout as an AbortSignal, or undefined. */
function timeoutSignal(opts: CompleteOptions): AbortSignal | undefined {
  return opts.timeoutMs !== undefined ? AbortSignal.timeout(opts.timeoutMs) : undefined
}

/** Normalises a failed call; an elapsed timeoutMs becomes kind 'timeout' whatever the SDK threw. */
function callError(err: unknown, signal: AbortSignal | undefined, opts: CompleteOptions): LLMError {
  if (signal?.aborted) {
    return new LLMError(`LLM call timed out after ${Math.round((opts.timeoutMs ?? 0) / 1000)}s.`, 'timeout', err)
  }
  return normalizeLLMError(err, { redactInvalidOutput: opts.redactInvalidOutput })
}

export async function completeStructured<T>(
  profileId: string,
  prompt: string,
  schema: z.ZodType<T>,
  opts: CompleteOptions,
): Promise<CompleteStructuredResult<T>> {
  if (opts.webSearch) {
    // Gemini rejects search grounding together with a JSON response schema, and other
    // providers don't combine them reliably. Search with complete(), then structure the notes.
    throw new LLMError(
      'webSearch is not supported with structured output. Use complete() for the search, then completeStructured() on its notes.',
      'unsupported',
    )
  }
  const cfg = await resolveConfig(profileId, opts)
  const modelId = cfg.model
  const model = PROVIDERS[cfg.provider](cfg.apiKey, modelId)
  const tools = searchTools(cfg.provider, opts)

  const signal = timeoutSignal(opts)
  const startedAt = Date.now()
  try {
    const result = await generateText({
      model,
      prompt,
      system: opts.system,
      maxOutputTokens: opts.maxOutputTokens,
      ...samplingOptions(cfg.provider, modelId, opts.temperature),
      ...(tools ? { tools } : {}),
      output: Output.object({ schema }),
      ...(signal ? { abortSignal: signal } : {}),
    })
    const latencyMs = Date.now() - startedAt
    logUsage(profileId, cfg.provider, modelId, opts, result.usage, latencyMs, serverToolCallsFor(cfg.provider, result, !!tools))
    return {
      object: result.output as T,
      provider: cfg.provider,
      model: modelId,
      usage: result.usage,
      latencyMs,
    }
  } catch (err) {
    // Providers without native structured output fall back to text-mode JSON
    // for Output.object, and those models frequently wrap the result in ```json
    // fences that the SDK's parser can't handle. Recover the object from the raw
    // text instead of failing the call; no extra LLM round-trip is needed.
    if (NoObjectGeneratedError.isInstance(err) && typeof err.text === 'string') {
      const recovered = extractJSON(err.text, schema)
      if (recovered.ok) {
        const latencyMs = Date.now() - startedAt
        // err.usage can be missing: log it as unknown rather than a measured zero.
        logUsage(profileId, cfg.provider, modelId, opts, err.usage, latencyMs, null)
        const usage = err.usage ?? ZERO_USAGE
        return {
          object: recovered.value,
          provider: cfg.provider,
          model: modelId,
          usage,
          latencyMs,
        }
      }
    }
    const error = callError(err, signal, opts)
    logFailedCall(profileId, cfg.provider, modelId, opts, error, err, Date.now() - startedAt)
    throw error
  }
}

// Lightweight read-only check for UIs that want to render "key configured"
// state without paying for a full ping. Returns the provider/model the user
// has saved (no key material).
export async function getLLMConfigStatus(profileId: string): Promise<{
  configured: boolean
  provider: string | null
  model: string | null
  availableModels: { id: string; name: string }[] | null
  availableModelsUpdatedAt: Date | null
  modelRoles: ModelRoleChoices
}> {
  const settings = await prisma.userSettings.findUnique({
    where: { profileId },
    select: {
      llmProvider: true,
      llmModel: true,
      llmApiKey: true,
      availableModels: true,
      availableModelsUpdatedAt: true,
      llmModelRoles: true,
    },
  })
  return {
    configured: !!settings?.llmApiKey,
    provider: settings?.llmProvider ?? null,
    model: settings?.llmModel ?? null,
    availableModels: (settings?.availableModels as { id: string; name: string }[] | null) ?? null,
    availableModelsUpdatedAt: settings?.availableModelsUpdatedAt ?? null,
    modelRoles: normalizeModelRoleChoices(settings?.llmModelRoles),
  }
}
