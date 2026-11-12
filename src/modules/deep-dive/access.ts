/**
 * Whether the user can run a deep dive, and how much research their provider
 * gets. Computed on the server and passed to the Deep dive button and report
 * page as plain data.
 *
 * Anthropic is the only provider the deep dive has been tested on (#361).
 * OpenAI and Google have web search mapped in the LLM layer but untested, so
 * the UI says so instead of hiding the feature.
 */

import { getLLMConfigStatus } from '@/modules/llm/client'
import { supportsWebSearch } from '@/modules/llm/web-search'

/** Providers the deep dive has been tested on end to end. */
export const TESTED_PROVIDERS: ReadonlySet<string> = new Set(['anthropic'])

const PROVIDER_NAMES: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google' }

export type DeepDiveAccess = {
  /** The user has an LLM key. */
  configured: boolean
  /**
   * `tested`: web research on a tested provider. `untested`: the provider has
   * web search, but the deep dive hasn't been tested on it. `none`: no web
   * search, so research is skipped and the report uses the ad, profile,
   * early assessment and register only.
   */
  research: 'tested' | 'untested' | 'none'
  /** Display name of the provider, or null with no key. */
  providerName: string | null
}

/** Pure: access from the LLM config. */
export function toDeepDiveAccess(config: { configured: boolean; provider: string | null }): DeepDiveAccess {
  const provider = config.provider
  const research = !provider || !supportsWebSearch(provider)
    ? 'none'
    : TESTED_PROVIDERS.has(provider) ? 'tested' : 'untested'
  return {
    configured: config.configured,
    research,
    providerName: provider ? PROVIDER_NAMES[provider] ?? provider : null,
  }
}

export async function getDeepDiveAccess(profileId: string): Promise<DeepDiveAccess> {
  return toDeepDiveAccess(await getLLMConfigStatus(profileId))
}
