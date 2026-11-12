import { describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/llm/client', () => ({ getLLMConfigStatus: vi.fn() }))

import { toDeepDiveAccess } from './access'

describe('toDeepDiveAccess', () => {
  it('marks Anthropic as tested research', () => {
    expect(toDeepDiveAccess({ configured: true, provider: 'anthropic' })).toEqual({ configured: true, research: 'tested', providerName: 'Anthropic' })
  })

  it('marks OpenAI and Google as untested research, not hidden', () => {
    expect(toDeepDiveAccess({ configured: true, provider: 'openai' }).research).toBe('untested')
    expect(toDeepDiveAccess({ configured: true, provider: 'google' })).toMatchObject({ research: 'untested', providerName: 'Google' })
  })

  it('reports no research for a provider with no web search, and with no key', () => {
    expect(toDeepDiveAccess({ configured: true, provider: 'mistral' })).toMatchObject({ research: 'none', providerName: 'mistral' })
    expect(toDeepDiveAccess({ configured: false, provider: null })).toEqual({ configured: false, research: 'none', providerName: null })
  })
})
