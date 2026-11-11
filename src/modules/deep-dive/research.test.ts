import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/llm/client', () => ({ complete: vi.fn(), completeStructured: vi.fn() }))

import { complete, completeStructured } from '@/modules/llm/client'
import { LLMError } from '@/modules/llm/errors'
import { JD, finding, gatherFixture } from './__fixtures__/inputs'
import {
  SEARCH_BUDGET,
  checkFindingSources,
  describeJob,
  normaliseUrl,
  researchPrompt,
  runResearch,
  skipReason,
  structurePrompt,
  type ResearchContext,
} from './research'
import { DEEP_DIVE_FEATURES, RESEARCHERS } from './schema'

const mockComplete = vi.mocked(complete)
const mockStructured = vi.mocked(completeStructured)

const brief = gatherFixture().brief
const today = new Date('2026-11-11T12:00:00Z')

function ctx(over: Partial<ResearchContext> = {}): ResearchContext {
  return {
    profileId: 'p1', jobApplicationId: 'job-1', runId: 'run-1', webSearch: true,
    cachedCompanyResearch: null, deadline: Date.now() + 120_000, today, ...over,
  }
}

function searchResult(text: string, sources: { url: string; title: string | null }[] = []) {
  return { text, sources, finishReason: 'stop', provider: 'anthropic', model: 'research-model', usage: {} as never, latencyMs: 1 }
}

beforeEach(() => vi.clearAllMocks())

describe('research prompts', () => {
  it('are built from the public brief only', () => {
    // The brief type has no profile fields; check nothing private leaks via the fixture either.
    const g = gatherFixture()
    for (const r of RESEARCHERS) {
      const prompt = researchPrompt(r, g.brief, today) + structurePrompt(r, 'notes', [], g.brief)
      expect(prompt).not.toContain('PRIVATE_')
      expect(prompt).toContain('Platform Lead')
    }
    expect(Object.keys(g.brief).sort()).toEqual(
      ['company', 'countries', 'isRecruitmentAgency', 'jobDescription', 'salaryBand', 'title', 'ukJob', 'url'].sort(),
    )
  })

  it('asks the pay researcher for the UK visa threshold only for UK jobs', () => {
    expect(researchPrompt('pay', brief, today)).toContain('Skilled Worker')
    expect(researchPrompt('pay', { ...brief, ukJob: false }, today)).not.toContain('Skilled Worker')
  })

  it('mentions the agency only when the ad is from one', () => {
    expect(describeJob(brief)).not.toContain('agency')
    expect(researchPrompt('company', { ...brief, isRecruitmentAgency: true }, today)).toContain('recruitment agency')
  })
})

describe('checkFindingSources', () => {
  const notes = 'Acme has 200 staff (https://acme.example/about). Glassdoor: https://reviews.example/acme.'

  it('keeps findings whose URL the search returned or the notes give, ignoring trailing slashes and fragments', () => {
    const kept = checkFindingSources([
      finding('a', { sourceUrl: 'https://acme.example/about/' }),
      finding('b', { sourceUrl: 'https://reviews.example/acme#top' }),
      finding('c', { sourceUrl: 'https://listed.example/x' }),
    ], notes, [{ url: 'https://listed.example/x', title: null }], JD)
    expect(kept.map((f) => f.claim)).toEqual(['a', 'b', 'c'])
  })

  it('drops findings citing a URL the search never saw, and non-http URLs', () => {
    const kept = checkFindingSources([
      finding('made up', { sourceUrl: 'https://invented.example/' }),
      finding('js', { sourceUrl: 'javascript:alert(1)' }),
    ], notes, [], JD)
    expect(kept).toEqual([])
  })

  it('keeps job-ad findings only when the quote is in the ad', () => {
    const kept = checkFindingSources([
      finding('rtw', { sourceUrl: null, quote: 'must have the right   to work in the UK' }),
      finding('fake', { sourceUrl: null, quote: 'Visa sponsorship available' }),
      finding('no quote', { sourceUrl: null, quote: null }),
    ], notes, [], JD)
    expect(kept.map((f) => f.claim)).toEqual(['rtw'])
  })

  it('keeps URL findings at low confidence when the search reported no URLs at all', () => {
    const kept = checkFindingSources([finding('a', { confidence: 'high' })], 'no urls here', [], JD)
    expect(kept).toEqual([expect.objectContaining({ claim: 'a', confidence: 'low' })])
  })

  it('normalises URLs for comparison', () => {
    expect(normaliseUrl('HTTPS://A.example/Path/#x')).toBe('https://a.example/path')
    expect(normaliseUrl('https://a.example/p.')).toBe('https://a.example/p')
  })
})

describe('runResearch', () => {
  it('skips every researcher without web search, making no calls', async () => {
    const run = await runResearch(brief, ctx({ webSearch: false }))
    for (const r of RESEARCHERS) expect(run.researchers[r]).toMatchObject({ status: 'skipped', reason: 'no_web_search' })
    expect(mockComplete).not.toHaveBeenCalled()
  })

  it('skips the company researcher when the job names no company', () => {
    expect(skipReason('company', { ...brief, company: null }, { webSearch: true })).toBe('no_company')
    expect(skipReason('pay', { ...brief, company: null }, { webSearch: true })).toBeNull()
  })

  it('uses fresh cached company research instead of searching', async () => {
    mockComplete.mockResolvedValue(searchResult('nothing found') as never)
    mockStructured.mockResolvedValue({ object: { findings: [] } } as never)
    const cached = { id: 'cr-1', findings: [finding('cached fact')], model: 'old-model', createdAt: today }
    const run = await runResearch(brief, ctx({ cachedCompanyResearch: cached }))
    expect(run.researchers.company).toMatchObject({ status: 'cached', cachedResearchId: 'cr-1', model: 'old-model' })
    expect(mockComplete.mock.calls.map((c) => c[2].feature)).not.toContain(DEEP_DIVE_FEATURES.research.company)
  })

  it('searches with role research + webSearch, structures with role fast, and attributes every call to the run', async () => {
    mockComplete.mockImplementation(async () => searchResult('Fact (https://acme.example/about)') as never)
    mockStructured.mockResolvedValue({ object: { findings: [finding('Fact', { sourceUrl: 'https://acme.example/about' })] } } as never)

    const run = await runResearch(brief, ctx())

    expect(mockComplete).toHaveBeenCalledTimes(3)
    for (const [profileId, , opts] of mockComplete.mock.calls) {
      expect(profileId).toBe('p1')
      expect(opts).toMatchObject({ role: 'research', attribution: { jobApplicationId: 'job-1', runId: 'run-1' } })
      expect(opts.model).toBeUndefined()
    }
    const byFeature = Object.fromEntries(mockComplete.mock.calls.map(([, , o]) => [o.feature, o.webSearch?.maxUses]))
    expect(byFeature).toEqual({
      [DEEP_DIVE_FEATURES.research.company]: SEARCH_BUDGET.company,
      [DEEP_DIVE_FEATURES.research.pay]: SEARCH_BUDGET.pay,
      [DEEP_DIVE_FEATURES.research.practicalities]: SEARCH_BUDGET.practicalities,
    })
    for (const [, , , opts] of mockStructured.mock.calls) {
      expect(opts).toMatchObject({ role: 'fast', feature: DEEP_DIVE_FEATURES.structure, attribution: { runId: 'run-1' } })
      expect(opts.maxOutputTokens).toBeGreaterThanOrEqual(4000)
    }
    for (const r of RESEARCHERS) expect(run.researchers[r]).toMatchObject({ status: 'ok', findings: [expect.objectContaining({ claim: 'Fact' })] })
  })

  it('isolates a failed or timed-out researcher', async () => {
    mockComplete.mockImplementation(async (_p, _prompt, opts) => {
      if (opts.feature === DEEP_DIVE_FEATURES.research.pay) throw new LLMError('slow', 'timeout')
      if (opts.feature === DEEP_DIVE_FEATURES.research.company) throw new LLMError('429', 'rate_limit')
      return searchResult('ok (https://x.example)') as never
    })
    mockStructured.mockResolvedValue({ object: { findings: [] } } as never)
    const run = await runResearch(brief, ctx())
    expect(run.researchers.pay).toMatchObject({ status: 'timeout' })
    expect(run.researchers.company).toMatchObject({ status: 'failed', reason: 'rate_limit' })
    expect(run.researchers.practicalities).toMatchObject({ status: 'ok' })
  })

  it("doesn't start structuring with too little time left", async () => {
    mockComplete.mockResolvedValue(searchResult('notes') as never)
    const run = await runResearch(brief, ctx({ deadline: Date.now() + 1_000 }))
    expect(mockStructured).not.toHaveBeenCalled()
    expect(run.researchers.pay.status).toBe('timeout')
  })
})
