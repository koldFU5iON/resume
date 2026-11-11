import { describe, it, expect } from 'vitest'
import { googleSearchQueryCount, supportsWebSearch, webSearchTools } from './web-search'

// The real SDK tool factories: definitions carry no key, so no network or credentials are needed.
type ProviderTool = { type: string; id: string; args: Record<string, unknown> }

describe('webSearchTools', () => {
  it('maps Anthropic to web search + web fetch with limits and domains', () => {
    const tools = webSearchTools('anthropic', { maxUses: 4, allowedDomains: ['glassdoor.com'] }) as Record<string, ProviderTool>
    expect(Object.keys(tools)).toEqual(['web_search', 'web_fetch'])
    expect(tools.web_search).toMatchObject({ type: 'provider', id: 'anthropic.web_search_20260209', args: { maxUses: 4, allowedDomains: ['glassdoor.com'] } })
    expect(tools.web_fetch).toMatchObject({ type: 'provider', id: 'anthropic.web_fetch_20260209', args: { maxUses: 4, allowedDomains: ['glassdoor.com'] } })
  })

  it('omits an empty domain list for Anthropic', () => {
    const tools = webSearchTools('anthropic', { maxUses: 2, allowedDomains: [] }) as Record<string, ProviderTool>
    expect(tools.web_search.args).toEqual({ maxUses: 2 })
  })

  it('maps OpenAI to its web search tool with a domain filter', () => {
    const tools = webSearchTools('openai', { maxUses: 4, allowedDomains: ['levels.fyi'] }) as Record<string, ProviderTool>
    expect(Object.keys(tools)).toEqual(['web_search'])
    expect(tools.web_search).toMatchObject({ type: 'provider', id: 'openai.web_search', args: { filters: { allowedDomains: ['levels.fyi'] } } })
  })

  it('maps OpenAI without domains to an unfiltered search', () => {
    const tools = webSearchTools('openai', { maxUses: 4 }) as Record<string, ProviderTool>
    expect(tools.web_search.args).toEqual({})
  })

  it('maps Google to google_search', () => {
    const tools = webSearchTools('google', { maxUses: 4, allowedDomains: ['x.com'] }) as Record<string, ProviderTool>
    expect(Object.keys(tools)).toEqual(['google_search'])
    expect(tools.google_search).toMatchObject({ type: 'provider', id: 'google.google_search' })
  })

  it("throws 'unsupported' for a provider without search", () => {
    expect(supportsWebSearch('mistral')).toBe(false)
    expect(() => webSearchTools('mistral', { maxUses: 1 })).toThrow(expect.objectContaining({ name: 'LLMError', kind: 'unsupported' }))
  })

  it("throws 'config' for a non-positive maxUses", () => {
    expect(() => webSearchTools('anthropic', { maxUses: 0 })).toThrow(expect.objectContaining({ kind: 'config' }))
  })
})

describe('googleSearchQueryCount', () => {
  it('counts grounding queries, or null without metadata', () => {
    expect(googleSearchQueryCount({ google: { groundingMetadata: { webSearchQueries: ['a', 'b'] } } })).toBe(2)
    expect(googleSearchQueryCount({ google: {} })).toBeNull()
    expect(googleSearchQueryCount(undefined)).toBeNull()
  })
})
