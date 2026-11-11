// Maps the layer's provider-neutral `webSearch` option to each provider's
// server-side search tool. Tool definitions carry no API key; the call's
// model (created with the user's key) runs them.
//
// Tested live: Anthropic. OpenAI and Google mappings are unit-tested only.

import type { ToolSet } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import { google } from '@ai-sdk/google'
import { LLMError } from './errors'

export type WebSearchOptions = {
  /**
   * Upper bound on searches in this call. On Anthropic it applies to search and
   * fetch separately, so a call can make up to 2 × maxUses billed tool uses.
   */
  maxUses: number
  /** Restrict results to these domains. Not supported by Google search (ignored there). */
  allowedDomains?: string[]
}

type SearchToolsFactory = (opts: WebSearchOptions) => ToolSet

const SEARCH_TOOLS: Record<string, SearchToolsFactory> = {
  // Search plus fetch, so the model can read a result page in full.
  anthropic: ({ maxUses, allowedDomains }) => {
    const args = { maxUses, ...(allowedDomains?.length ? { allowedDomains } : {}) }
    return {
      web_search: anthropic.tools.webSearch_20260209(args),
      web_fetch: anthropic.tools.webFetch_20260209(args),
    }
  },
  // OpenAI's tool has no per-call use limit; maxUses isn't enforced there.
  openai: ({ allowedDomains }) => ({
    web_search: openai.tools.webSearch(allowedDomains?.length ? { filters: { allowedDomains } } : {}),
  }),
  // Gemini grounding: no use limit or domain filter. The tool must be named google_search.
  google: () => ({
    google_search: google.tools.googleSearch({}),
  }),
}

export function supportsWebSearch(provider: string): boolean {
  return provider in SEARCH_TOOLS
}

/** The provider's search tools for `opts`. Throws LLMError kind 'unsupported' when it has none. */
export function webSearchTools(provider: string, opts: WebSearchOptions): ToolSet {
  const factory = SEARCH_TOOLS[provider]
  if (!factory) {
    throw new LLMError(`Web search isn't supported for provider "${provider}".`, 'unsupported')
  }
  if (!Number.isInteger(opts.maxUses) || opts.maxUses < 1) {
    throw new LLMError('webSearch.maxUses must be a positive integer.', 'config')
  }
  return factory(opts)
}

/**
 * Google reports grounding searches in provider metadata rather than as
 * tool-call parts; the number of queries it ran, or null when absent.
 */
export function googleSearchQueryCount(providerMetadata: unknown): number | null {
  const queries = (providerMetadata as { google?: { groundingMetadata?: { webSearchQueries?: unknown } } } | undefined)
    ?.google?.groundingMetadata?.webSearchQueries
  return Array.isArray(queries) ? queries.length : null
}
