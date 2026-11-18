import { describe, expect, it } from 'vitest'
import { toProfileSnapshot } from '@/modules/profile/snapshot'
import { parseWritingDeskMarkdown } from '@/modules/writing-desk/markdown'
import { DEFAULT_CV_STRUCTURE } from '@/modules/writing-desk/structure-guide'
import { validateDraftMarkdown } from '@/modules/writing-desk/validate'
import { OLD_CO, UNITY, BLIZZARD, writeVault, writtenSections } from './__fixtures__/write'
import { assembleCv, bodyWordCount, lengthNote, renderHeader, type AssembleInput } from './assemble'
import { CV_BODY_WORDS_SOFT_LIMIT } from './write/limits'
import { parseAssembled } from './schema'
import type { WrittenSection } from './write/types'

const sections: WrittenSection[] = writtenSections()
const input = (over: Partial<AssembleInput> = {}): AssembleInput => ({
  name: 'Robin Placeholder', headline: 'Delivery and operations leader', sections,
  employerOrder: [UNITY, BLIZZARD, OLD_CO], checkNotes: [], snapshot: toProfileSnapshot(writeVault()), ...over,
})

describe('renderHeader (the headline is model text)', () => {
  it('cleans markup out of the headline, so ":::" or {{contact}} cannot break or double the header', () => {
    expect(renderHeader('Robin Placeholder', '## **Delivery** ::: leader {{contact}}')).toBe(':::header\n# Robin Placeholder\n## Delivery leader contact\n{{contact}}\n:::')
    expect(renderHeader('Robin Placeholder', ':::')).toBe(':::header\n# Robin Placeholder\n{{contact}}\n:::')
  })
})

describe('assembleCv', () => {
  const r = assembleCv(input())
  if (!r.ok) throw new Error(r.issues.join('; '))
  const md = r.assembled.markdown

  it('orders the sections by the DEFAULT structure, not by the order they were written in', () => {
    const headings = [...md.slice(md.indexOf('\n:::\n') + 5).matchAll(/^## (.+)$/gm)].map((m) => m[1])
    const expected = DEFAULT_CV_STRUCTURE.filter((s) => s.key !== 'header').map((s) => s.heading)
    // Every default heading that has content, in default order. The header block comes first.
    expect(headings).toEqual(expected.filter((h) => headings.includes(h)))
    expect(headings).toEqual(['Professional Profile', 'Core Competencies', 'Professional Experience', 'Tools', 'Skills', 'Certifications', 'Education', 'Languages'])
    expect(md.startsWith(':::header')).toBe(true)
    expect(r.assembled.sections.map((s) => s.kind)).toEqual(['header', 'profile', 'competencies', 'experience', 'experience', 'experience', 'tools', 'skills', 'certification', 'education', 'languages'])
  })

  it('puts the employers in the selection’s order, under one Professional Experience heading', () => {
    expect(md.indexOf('### Unity')).toBeLessThan(md.indexOf('### Blizzard Entertainment'))
    expect(md.indexOf('### Blizzard Entertainment')).toBeLessThan(md.indexOf('### Old Co'))
    expect(md.match(/## Professional Experience/g)).toHaveLength(1)
  })

  it('writes the header with the name, the headline and the literal {{contact}} placeholder, never contact details', () => {
    expect(md.startsWith(':::header\n# Robin Placeholder\n## Delivery and operations leader\n{{contact}}\n:::')).toBe(true)
    for (const pii of ['robin@example.test', '+33 6 12 34 56 78', 'linkedin.com/in/robin', 'github.com/robin', 'robin.example.test']) expect(md).not.toContain(pii)
  })

  it('omits the headline line when there is none', () => {
    expect(renderHeader('Robin', null)).toBe(':::header\n# Robin\n{{contact}}\n:::')
  })

  it('produces a document the writing desk validator accepts, with only registered blocks', () => {
    const v = validateDraftMarkdown(md)
    expect(v.ok).toBe(true)
    expect(v.issues.filter((i) => i.severity === 'error')).toEqual([])
    const blocks: string[] = []
    const walk = (nodes: Array<{ type: string; name?: string; children?: unknown[] }>) => nodes.forEach((n) => { if (n.type === 'writingDeskBlock' && n.name) blocks.push(n.name); if (n.children) walk(n.children as never) })
    walk(parseWritingDeskMarkdown(md) as never)
    expect(new Set(blocks)).toEqual(new Set(['header', 'compact-list', 'skills', 'inline-list']))
  })

  it('stores the markdown, the sections and nothing else sensitive, and reads back tolerantly', () => {
    const stored = JSON.parse(JSON.stringify(r.assembled))
    expect(parseAssembled(stored)).toEqual(r.assembled)
    expect(r.assembled.sections.find((s) => s.id === 'skills')).toMatchObject({ model: 'm', tokens: { input: 10, output: 5 } })
    expect(r.assembled.sections.find((s) => s.id === 'header')).toEqual({ id: 'header', kind: 'header', markdown: expect.stringContaining('{{contact}}') })
    expect(r.assembled.sections.filter((s) => s.kind === 'experience').map((s) => s.employerKey)).toEqual([UNITY, BLIZZARD, OLD_CO])
  })

  it('never introduces the word "promoted"', () => {
    expect(md).not.toMatch(/promot/i)
  })

  it('keeps at most three "worth a quick check" notes', () => {
    const many = assembleCv(input({ checkNotes: ['a', 'b', 'c', 'd', 'e'] }))
    expect(many.ok && many.assembled.checkNotes).toEqual(['a', 'b', 'c'])
  })

  it('turns fact-check findings into warnings and does not fail on them', () => {
    const wrong = sections.map((s) => (s.id === `experience:${UNITY}` ? { ...s, markdown: s.markdown.replace('Jan 2019 – present', 'Jan 2012 – Dec 2013') } : s))
    const res = assembleCv(input({ sections: wrong }))
    expect(res.ok).toBe(true)
    expect(res.ok && res.assembled.warnings.join(' ')).toMatch(/Dates differ from your profile/)
  })

  it('FAILS (block validity is hard) on an unclosed block, naming the section', () => {
    const broken = sections.map((s) => (s.id === 'skills' ? { ...s, markdown: ':::skills\n- Release management\n' } : s))
    const res = assembleCv(input({ sections: broken }))
    expect(res.ok).toBe(false)
    expect(!res.ok && res.issues.join(' ')).toMatch(/never closed/)
    expect(!res.ok && res.issues.join(' ')).toMatch(/skills/)
  })

  it('FAILS on an unknown block', () => {
    const broken = sections.map((s) => (s.id === 'tools' ? { ...s, markdown: ':::fancy\n- Jira\n:::' } : s))
    expect(assembleCv(input({ sections: broken })).ok).toBe(false)
  })

  it('skips sections with no content instead of printing an empty heading', () => {
    const res = assembleCv(input({ sections: sections.filter((s) => s.kind !== 'languages' && s.kind !== 'competencies') }))
    expect(res.ok && res.assembled.markdown).not.toMatch(/## Languages|## Core Competencies/)
  })
})

describe('parseAssembled (backwards compatibility and tolerance)', () => {
  it('reads null for a run stored before Phase 3 and for junk', () => {
    for (const v of [null, undefined, 'x', 3, [], {}, { markdown: 3 }]) expect(parseAssembled(v)).toBeNull()
  })

  it('drops bad entries inside the lists instead of the whole CV', () => {
    const a = parseAssembled({ markdown: '# x', sections: [{ id: 'a', kind: 'k', markdown: 'm' }, { nope: true }], warnings: ['w', 5], checkNotes: 'no' })
    expect(a).toEqual({ markdown: '# x', sections: [{ id: 'a', kind: 'k', markdown: 'm' }], warnings: ['w'], checkNotes: [] })
  })
})

describe('Core Competencies as short labels in a :::skills block (phase 3b)', () => {
  it('assembles the competency labels as an inline :::skills list that the validator accepts', () => {
    const r = assembleCv(input())
    if (!r.ok) throw new Error(r.issues.join('; '))
    expect(r.assembled.markdown).toMatch(/## [^\n]*[Cc]ompetenc[^\n]*\n\n:::skills\n- Cross-functional leadership\n:::/)
    const issues = validateDraftMarkdown(r.assembled.markdown).issues.filter((i) => i.severity === 'error')
    expect(issues).toEqual([])
  })
})

describe('body length (soft, Phase 3c)', () => {
  const md = (body: string) => `:::header\n# Robin Placeholder\n## A headline that is not counted\n{{contact}}\n:::\n\n## Profile\n\n${body}\n`
  it('counts the words of the body: not the header block, the block fences or the Markdown marks', () => {
    expect(bodyWordCount(md('One two three.\n\n:::compact-list\n- Four five\n- Six\n:::'))).toBe(7) // "## Profile" counts "Profile" (1) + 6
  })
  it('says nothing at or under the limit, and names the count and the limit above it', () => {
    expect(lengthNote(md(Array.from({ length: CV_BODY_WORDS_SOFT_LIMIT - 1 }, () => 'w').join(' ')))).toBeNull()
    const note = lengthNote(md(Array.from({ length: CV_BODY_WORDS_SOFT_LIMIT + 100 }, () => 'w').join(' ')))
    expect(note).toMatch(new RegExp(`about ${CV_BODY_WORDS_SOFT_LIMIT + 101} words, over the ~${CV_BODY_WORDS_SOFT_LIMIT}`))
    expect(note).toMatch(/Nothing was trimmed/)
  })
  it('a real assembled fixture CV is well under the limit', () => {
    const r = assembleCv(input())
    if (!r.ok) throw new Error('assemble failed')
    expect(lengthNote(r.assembled.markdown)).toBeNull()
  })
})
