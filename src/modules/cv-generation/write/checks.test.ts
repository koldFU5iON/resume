import { describe, expect, it } from 'vitest'
import {
  claimedHits, containsPhrase, figuresIn, headlineTitleProblem, introducedNames, parseListBlock, unsupportedFigures, wordCount,
} from './checks'

describe('figuresIn', () => {
  it('normalises percentages, currency, separators and magnitudes', () => {
    expect(figuresIn('Cut cost by 40% and 40 percent, saved $2.5M, £1,200 and 3x')).toEqual(['40%', '40%', '2.5m', '1200', '3x'])
  })

  it('does not read "3 months" as a magnitude', () => {
    expect(figuresIn('in 3 months')).toEqual(['3'])
  })
})

describe('unsupportedFigures (numbers verbatim)', () => {
  const evidence = ['Cut platform release time by 40% across 8 teams', 'saved 2 weeks per release', 'Coached twelve producers']

  it('accepts figures that are in the evidence, however they are formatted', () => {
    expect(unsupportedFigures('Cut release time by 40 percent across 8 teams, 2 weeks per release', evidence)).toEqual([])
  })

  it('accepts a number written as a word in the evidence', () => {
    expect(unsupportedFigures('Coached 12 producers', evidence)).toEqual([])
  })

  it('lists figures the evidence does not contain, as written', () => {
    expect(unsupportedFigures('Cut release time by 45% across 8 teams and saved $3M', evidence)).toEqual(['45%', '$3M'])
  })

  it('does not accept a rounded or converted figure', () => {
    expect(unsupportedFigures('Cut release time by about 50%', evidence)).toEqual(['50%'])
  })

  it('has nothing to say about text without figures', () => {
    expect(unsupportedFigures('Led planning for the platform org', evidence)).toEqual([])
  })
})

describe('claimedHits', () => {
  const opts = { evidenceText: 'Built dashboards in Looker', requirementText: 'Must have Tableau experience\nSQL' }

  it('reports a claimed name the output mentions, with whether the job asks for it', () => {
    expect(claimedHits('Built Tableau dashboards and used Power BI', ['Tableau', 'Power BI'], opts)).toEqual([
      { name: 'Tableau', requested: true },
      { name: 'Power BI', requested: false },
    ])
  })

  it('does not report a claimed name the evidence itself contains', () => {
    expect(claimedHits('Built dashboards in Looker', ['Looker'], opts)).toEqual([])
  })

  it('matches whole words only and ignores case', () => {
    expect(claimedHits('Used tableaux and java', ['Tableau', 'Java'], opts)).toEqual([{ name: 'Java', requested: false }])
  })
})

describe('introducedNames', () => {
  const names = { titles: ['Snr. Program Manager', 'Coordinator'], companies: ['Unity', 'Blizzard Entertainment'] }

  it('flags profile titles and companies that the evidence does not contain', () => {
    expect(introducedNames('As Snr. Program Manager at Unity I cut cost', names, 'Cut cost')).toEqual({ titles: ['Snr. Program Manager'], companies: ['Unity'] })
  })

  it('lets a name through when the evidence itself has it', () => {
    expect(introducedNames('Moved work from Blizzard Entertainment', names, 'Moved work from Blizzard Entertainment')).toEqual({ titles: [], companies: [] })
  })
})

describe('headlineTitleProblem', () => {
  const titles = ['Snr. Program Manager', 'Program Manager']

  it('rejects an exact title, and a title word that no own title uses', () => {
    expect(headlineTitleProblem('Program Manager', titles)).toMatch(/job title/)
    expect(headlineTitleProblem('Director of Delivery', titles)).toMatch(/"director"/)
    expect(headlineTitleProblem('Senior delivery leader', ['Program Manager'])).toMatch(/"senior"/)
  })

  it('accepts a descriptor', () => {
    expect(headlineTitleProblem('Delivery and operations leader | systems thinker', titles)).toBeNull()
  })
})

describe('parseListBlock', () => {
  it('returns the bullets of a valid block', () => {
    expect(parseListBlock(':::compact-list\n- one\n- two\n:::', 'compact-list')).toEqual({ ok: true, bullets: ['one', 'two'] })
  })

  it.each([
    ['no closing fence', ':::compact-list\n- one\n'],
    ['wrong block', ':::skills\n- one\n:::'],
    ['text outside the list', ':::compact-list\nHello\n- one\n:::'],
    ['a bullet over two lines', ':::compact-list\n- one\n  continued\n:::'],
    ['an empty block', ':::compact-list\n:::'],
    ['a nested list', ':::compact-list\n- one\n  - nested\n:::'],
  ])('rejects %s', (_name, block) => {
    expect(parseListBlock(block, 'compact-list').ok).toBe(false)
  })
})

describe('helpers', () => {
  it('counts words and matches phrases', () => {
    expect(wordCount('  one two\nthree ')).toBe(3)
    expect(containsPhrase('Led C++ work', 'C++')).toBe(true)
    expect(containsPhrase('Led Java work', 'Jav')).toBe(false)
  })
})
