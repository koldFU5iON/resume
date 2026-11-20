import { beforeEach, describe, expect, it, vi } from 'vitest'
import { completeStructured, getLLMConfigStatus } from '@/modules/llm/client'
import { ExtractedSuggestionsSchema } from './extract-schema'
import { findAchievementMatch } from './duplicate-detect'
import { parseNotes } from './tag-parser'
import { extractionPassageKey, groundClaim, proposeDraft } from './extraction-proposals'
import { mergeExtractionResult, extractionResultsConflict } from './extraction-result'
import { addScope } from './extraction-draft'

vi.mock('@/modules/llm/client', () => ({ completeStructured: vi.fn(), getLLMConfigStatus: vi.fn() }))

const claim = {
  kind: 'achievement' as const,
  description: 'I cut turnaround time to 1 hour.',
  original: 'Cut turnaround time from 3 weeks to 1 hour in Q3 2025.',
  impact: null,
  result: { measure: 'turnaround time', value: '1 hour', baseline: '3 weeks', period: 'Q3 2025' },
  projectName: null,
}

beforeEach(() => vi.resetAllMocks())

describe('clean and extract', () => {
  it('parses tagged claims, scope, skills, explicit result and contiguous source excerpts', () => {
    const body = '## Overview\r\nAbout the work\r\n## Achievements\r\n- **Cut** turnaround time from 3 weeks to 1 hour in Q3 2025.\r\n  > Project: Atlas\r\n  > turnaround time: 1 hour (from 3 weeks), Q3 2025\r\n- I manage support each week\r\n## Responsibilities\r\n- Responsible for staffing\r\n## Skills\r\n- SQL'
    const parsed = parseNotes(body)
    expect(parsed.activities).toMatchObject([
      { description: 'I cut turnaround time from 3 weeks to 1 hour in Q3 2025.', kind: 'achievement', projectName: 'Atlas', result: claim.result },
      { description: 'I manage support each week', kind: 'scope', result: null },
      { description: 'I was responsible for staffing', kind: 'scope', result: null },
    ])
    expect(parsed.activities.every((item) => body.includes(item.original))).toBe(true)
    expect(parsed.activities[0].original).toContain('\r\n  > Project: Atlas')
    expect(parsed.skills[0]).toMatchObject({ name: 'SQL', original: '- SQL' })
    expect(parsed.unparsed).toBe('')
  })

  it('permits only exact model provenance and supported measurements', () => {
    const { original } = claim
    expect(ExtractedSuggestionsSchema.safeParse({ activities: [{ ...claim, kind: 'responsibility' }], skills: [] }).success).toBe(false)
    expect(groundClaim(claim, original, original)).toMatchObject({ result: claim.result, original })
    expect(groundClaim(claim, original, 'different notes')).toBeNull()
    expect(groundClaim({ ...claim, original: 'Cut turnaround time to 1 hour.' }, original, original)).toBeNull()
    expect(groundClaim({ ...claim, description: 'I cut turnaround time to 10 hours.' }, original, original)).toBeNull()
    expect(groundClaim({ ...claim, result: { ...claim.result, measure: 'customer satisfaction' } }, original, original)?.result).toBeNull()
    expect(groundClaim({ ...claim, result: { ...claim.result, value: '1 hour', period: '202' } }, original, original)?.result).toBeNull()
  })

  it('maps local tags to existing or new project labels without a model', async () => {
    const subject = { body: '## Achievements\n- Shipped the Atlas migration\n- Added billing exports\n  > Project: Billing', noun: 'role' as const, facts: '' }
    const result = await proposeDraft('p', subject, [{ id: 'atlas', name: 'Atlas' }], null)
    expect(result.items).toMatchObject([
      { project: { kind: 'existing', id: 'atlas' }, description: 'I shipped the Atlas migration' },
      { project: { kind: 'new', name: 'Billing' }, description: 'I added billing exports' },
    ])
    expect(getLLMConfigStatus).not.toHaveBeenCalled()
  })

  it('keeps the free parser both without a key and after the model fails', async () => {
    const subject = { body: '- Built an index\nGeneral prose\n## Achievements\n- Grew the team', noun: 'project' as const, facts: '' }
    vi.mocked(getLLMConfigStatus).mockResolvedValueOnce({ configured: false } as never).mockResolvedValueOnce({ configured: true } as never)
    vi.mocked(completeStructured).mockRejectedValue(new Error('Model unavailable'))
    const noKey = await proposeDraft('p', subject, [], 'project')
    expect(noKey.items).toMatchObject([
      { description: 'I grew the team', project: { kind: 'existing', id: 'project' } },
      { description: 'I built an index', project: { kind: 'existing', id: 'project' } },
    ])
    expect(noKey.failed).toBe(false)
    const failure = await proposeDraft('p', subject, [], 'project')
    expect(failure.failed).toBe(true)
    expect(failure.items.map((item) => item.key)).toEqual(noKey.items.map((item) => item.key))
    expect(completeStructured).toHaveBeenCalledWith('p', expect.any(String), ExtractedSuggestionsSchema, expect.objectContaining({ feature: 'profile-extract' }))
  })

  it('uses supported model claims, skills and project names without double proposing parser bullets', async () => {
    const original = 'Built the access review for Harbor'
    const body = `- ${original}\nMy teammates also used SQL.`
    vi.mocked(getLLMConfigStatus).mockResolvedValue({ configured: true } as never)
    vi.mocked(completeStructured).mockResolvedValue({ object: {
      activities: [{ ...claim, original, description: 'I built the access review for Harbor.', result: null, projectName: 'Harbor' }],
      skills: [
        { name: 'SQL', category: null, level: null, original: 'My teammates also used SQL.' },
        { name: 'Invented', category: null, level: null, original: 'Unsupported quote' },
      ],
    } } as never)
    expect((await proposeDraft('p', { body, noun: 'role', facts: '' }, [], null)).items).toMatchObject([
      { kind: 'achievement', original: `- ${original}`, project: { kind: 'new', name: 'Harbor' }, source: 'llm' },
      { kind: 'skill', name: 'SQL', original: 'My teammates also used SQL.' },
    ])
  })

  it('matches legacy verb-led text and prefers an exact match to a rough match', () => {
    const near = { id: 'near', description: 'Cut billing turnaround time for invoices' }
    const exact = { id: 'exact', description: 'Cut turnaround time' }
    expect(findAchievementMatch('I cut turnaround time.', [near, exact])).toBe(exact)
  })

  it('inserts optional scope without rewriting prior Markdown or adding a duplicate line', () => {
    const before = '## Overview\r\nExisting scope\r\n## Achievements\r\n- Old text  '
    const updated = addScope(before, 'I manage staffing.')
    expect(updated).toBe('## Overview\r\nExisting scope\r\n\r\n- I manage staffing.\r\n\r\n## Achievements\r\n- Old text  ')
    expect(addScope(updated, 'I manage staffing.')).toBe(updated)
    expect(addScope('Original note  ', 'I manage staffing.')).toBe('Original note  \n\n## Overview\n\n- I manage staffing.\n')
  })
})


describe('extraction review regressions', () => {
  it('keeps omitted result details and identifies conflicting results', () => {
    const existing = claim.result
    expect(mergeExtractionResult(existing, { ...existing, baseline: null, period: null })).toEqual(existing)
    expect(extractionResultsConflict(existing, { ...existing, baseline: null, period: null })).toBe(false)
    expect(extractionResultsConflict(existing, { ...existing, value: '2 hours' })).toBe(true)
    expect(extractionResultsConflict(existing, { ...existing, period: 'Q4 2025' })).toBe(true)
  })

  it('rejects invented units and reversed comparisons in claims, outcomes and structured results', () => {
    const original = 'I cut latency from 10 seconds to 2 seconds.'
    const grounded = { ...claim, original, description: 'I cut latency to 2 seconds.', result: { measure: 'latency', value: '2 seconds', baseline: '10 seconds', period: null } }
    expect(groundClaim(grounded, original, original)?.result).toEqual(grounded.result)
    expect(groundClaim({ ...grounded, description: 'I cut latency to 2 milliseconds.' }, original, original)).toBeNull()
    expect(groundClaim({ ...grounded, description: 'I cut latency from 2 seconds to 10 seconds.' }, original, original)).toBeNull()
    expect(groundClaim({ ...grounded, impact: 'Latency is now 2 milliseconds.' }, original, original)?.impact).toBeNull()
    expect(groundClaim({ ...grounded, impact: 'Latency went from 2 seconds to 10 seconds.' }, original, original)?.impact).toBeNull()
    expect(groundClaim({ ...grounded, result: { ...grounded.result, value: '10 seconds', baseline: '2 seconds' } }, original, original)?.result).toBeNull()
    const prose = 'The latency went from 10 seconds to 2 seconds.'
    expect(groundClaim({ ...grounded, original: prose, result: { ...grounded.result, value: '10 seconds', baseline: '2 seconds' } }, prose, prose)?.result).toBeNull()
  })

  it.each([null, { measure: 'latency', value: '2 milliseconds', baseline: null, period: null }])('retains the local result when the model returns %j', async (result) => {
    const original = 'Cut latency from 10 seconds to 2 seconds in Q3 2025.'
    vi.mocked(getLLMConfigStatus).mockResolvedValue({ configured: true } as never)
    vi.mocked(completeStructured).mockResolvedValue({ object: { activities: [{ ...claim, original, description: 'I cut latency.', result }], skills: [] } } as never)
    const proposed = await proposeDraft('p', { body: `- ${original}`, noun: 'role', facts: '' }, [], null)
    expect(proposed.items).toHaveLength(1)
    expect(proposed.items[0]).toMatchObject({ result: { measure: 'latency', value: '2 seconds', baseline: '10 seconds', period: 'Q3 2025' } })
  })

  it('retains local measurements when the model quotes only the start of the same source line', async () => {
    const original = 'Cut latency from 10 seconds to 2 seconds in Q3 2025.'
    vi.mocked(getLLMConfigStatus).mockResolvedValue({ configured: true } as never)
    vi.mocked(completeStructured).mockResolvedValue({ object: { activities: [{ ...claim, original: 'Cut latency', description: 'I cut latency.', result: null }], skills: [] } } as never)
    const proposed = await proposeDraft('p', { body: `- ${original}`, noun: 'role', facts: '' }, [], null)
    expect(proposed.items).toHaveLength(1)
    expect(proposed.items[0]).toMatchObject({ original: `- ${original}`, result: { measure: 'latency', value: '2 seconds', baseline: '10 seconds', period: 'Q3 2025' } })
  })

  it('uses a stable source passage across classification and quote-boundary changes', async () => {
    const body = 'I maintained the billing service.'
    vi.mocked(getLLMConfigStatus).mockResolvedValue({ configured: true } as never)
    vi.mocked(completeStructured)
      .mockResolvedValueOnce({ object: { activities: [{ ...claim, kind: 'scope', original: body, description: body, result: null }], skills: [] } } as never)
      .mockResolvedValueOnce({ object: { activities: [{ ...claim, kind: 'achievement', original: body.slice(0, -1), description: body, result: null }], skills: [] } } as never)
    const subject = { body, noun: 'role' as const, facts: '' }
    expect((await proposeDraft('p', subject, [], null)).items.map(i => i.key)).toEqual((await proposeDraft('p', subject, [], null)).items.map(i => i.key))
  })

  it('keeps distinct source sentences on one line separate while tolerating shorter quotes', () => {
    const body = '1. I maintained the billing service. I built the deployment pipeline.'
    expect(extractionPassageKey(body, 'I maintained the billing service.')).toBe(extractionPassageKey(body, 'maintained the billing service'))
    expect(extractionPassageKey(body, 'I maintained the billing service.')).not.toBe(extractionPassageKey(body, 'I built the deployment pipeline.'))
    expect(extractionPassageKey(body, body)).toBe(extractionPassageKey(body, 'I maintained the billing service.'))
  })

  it('keeps plain text entries under explicit headings without a model', async () => {
    const body = '## Responsibilities\nWeekly incident triage\n## Scope\nRegional planning\n## Achievements\nBilling rollout'
    const proposed = await proposeDraft('p', { body, noun: 'role', facts: '' }, [], null)
    expect(proposed.items).toMatchObject([
      { kind: 'scope', original: 'Weekly incident triage' },
      { kind: 'scope', original: 'Regional planning' },
      { kind: 'achievement', original: 'Billing rollout' },
    ])
    expect(getLLMConfigStatus).not.toHaveBeenCalled()
  })
})


describe('conservative metrics and distinct source blocks', () => {
  it('retains the complete local result when a model returns only supported fragments', async () => {
    const original = 'I cut API latency from 10 seconds to 2 seconds in Q3 2025.'
    vi.mocked(getLLMConfigStatus).mockResolvedValue({ configured: true } as never)
    vi.mocked(completeStructured).mockResolvedValue({ object: { activities: [{ ...claim, original, description: 'I cut API latency.', result: { measure: 'latency', value: '2', baseline: null, period: null } }], skills: [] } } as never)
    const proposed = await proposeDraft('p', { body: original, noun: 'role', facts: '' }, [], null)
    expect(proposed.items[0]).toMatchObject({ result: { measure: 'API latency', value: '2 seconds', baseline: '10 seconds', period: 'Q3 2025' } })
  })

  it('falls back to source wording for unverifiable quantitative paraphrases', () => {
    const original = 'I cut API latency from 10 seconds to 2 seconds in Q3 2025.'
    const rewritten = { ...claim, original, description: 'I measured API latency at 10 seconds (previously 2 seconds).', impact: '10 seconds, previously 2 seconds', result: null }
    expect(groundClaim(rewritten, original, original)).toMatchObject({ description: original, impact: null })
  })

  it('preserves case-sensitive units during grounding and replacement', () => {
    const existing = { measure: 'Power', value: '2 mW', baseline: '10 mW', period: null }
    const proposed = { ...existing, value: '2 MW', baseline: null }
    expect(extractionResultsConflict(existing, proposed)).toBe(true)
    expect(extractionResultsConflict({ ...existing, measure: 'Power (mW)', value: '2' }, { ...existing, measure: 'Power (MW)', value: '2' })).toBe(true)
    expect(mergeExtractionResult(existing, proposed)).toEqual(proposed)
    const original = 'I cut power from 10 mW to 2 mW.'
    expect(groundClaim({ ...claim, original, description: 'I cut power to 2 MW.', result: proposed }, original, original)).toBeNull()
    expect(groundClaim({ ...claim, original, description: 'I cut power.', result: proposed }, original, original)?.result).toBeNull()
  })

  it('keeps repeated claims with distinct project details and changes identity after a metric correction', async () => {
    const body = '## Achievements\n- Shipped migration\n  > Project: Atlas\n  > Turnaround: 2 hours\n- Shipped migration\n  > Project: Vega\n  > Turnaround: 3 hours'
    const result = await proposeDraft('p', { body, noun: 'role', facts: '' }, [], null)
    expect(result.items).toHaveLength(2)
    expect(result.items).toMatchObject([{ project: { kind: 'new', name: 'Atlas' } }, { project: { kind: 'new', name: 'Vega' } }])
    expect(result.items[0].key).not.toBe(result.items[1].key)
    expect(extractionPassageKey(body, 'Shipped migration\n  > Project: Atlas')).toBe(result.items[0].key)
    expect(extractionPassageKey(body, 'Turnaround: 2 hours')).toBe(result.items[0].key)
    const corrected = body.replace('Turnaround: 2 hours', 'Turnaround: 4 hours')
    const updated = await proposeDraft('p', { body: corrected, noun: 'role', facts: '' }, [], null)
    expect(updated.items[0].key).not.toBe(result.items[0].key)
    expect(updated.items[1].key).toBe(result.items[1].key)
  })

  it('preserves punctuation in skill identities', async () => {
    const result = await proposeDraft('p', { body: '## Skills\nC++\nC#\nC++', noun: 'role', facts: '' }, [], null)
    expect(result.items).toMatchObject([{ kind: 'skill', name: 'C++' }, { kind: 'skill', name: 'C#' }])
  })
})
