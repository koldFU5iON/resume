import { beforeEach, describe, expect, it, vi } from 'vitest'
import { completeStructured, getLLMConfigStatus } from '@/modules/llm/client'
import { ExtractedSuggestionsSchema } from './extract-schema'
import { findAchievementMatch } from './duplicate-detect'
import { parseNotes } from './tag-parser'
import { groundClaim, proposeDraft } from './extraction-proposals'
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
      { kind: 'achievement', original, project: { kind: 'new', name: 'Harbor' }, source: 'llm' },
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
