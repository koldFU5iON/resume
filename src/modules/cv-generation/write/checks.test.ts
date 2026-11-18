import { describe, expect, it } from 'vitest'
import {
  claimedHits, competencyLabelProblem, containsPhrase, credentialProblems, distinctNotableFigures, figuresIn, headlineTitleProblem, introducedNames,
  isNotableFigure, mentionsName, projectReflected, repeatedFigures, sharedFigures, titleLikePhrases, unsupportedFigures, wordCount,
} from './checks'

const keys = (text: string, opts?: Parameters<typeof figuresIn>[1]) => figuresIn(text, opts).map((f) => f.key)

describe('figuresIn', () => {
  it('reads figures by value: percentages, currency, separators and magnitudes', () => {
    expect(keys('Cut cost by 40% and 40 percent, saved $2.5M, £1,200 and 3x')).toEqual(['40%', '40%', '2500000', '1200', '3x'])
  })

  it('does not read "3 months" as a magnitude', () => {
    expect(keys('in 3 months')).toEqual(['3'])
  })

  it('expands k, m, bn and the words, and ignores trailing zeros and thousands separators', () => {
    expect(keys('14k')).toEqual(keys('14,000'))
    expect(keys('£500k')).toEqual(keys('£500,000'))
    expect(keys('1,000,000')).toEqual(keys('1m'))
    expect(keys('1.5m')).toEqual(keys('1.50m'))
    expect(keys('2 million')).toEqual(keys('2m'))
    expect(keys('3bn')).toEqual(keys('3 billion'))
    expect(keys('forty percent')).toEqual(keys('40%'))
  })

  it('ignores digit runs that touch a letter, and digits joined by a slash', () => {
    expect(keys('B2B SaaS on Web3 with GA4, Q3 goals and the 1st release, 24/7 cover')).toEqual([])
  })

  it('ignores digits inside the names of selected skills and tools', () => {
    expect(keys('Led ISO 27001 certification', { names: ['ISO 27001'] })).toEqual([])
    expect(keys('Led ISO 27001 certification')).toEqual(['27001'])
  })

  it('reads spelled-out numbers, compounds, scales and "a dozen"', () => {
    expect(keys('five markets, twenty-five teams, two hundred and five users, a hundred leads, a dozen titles, two dozen')).toEqual(['5', '25', '205', '100', '12', '24'])
    expect(keys('a million users and three thousand sites')).toEqual(['1000000', '3000'])
  })

  it('reads multipliers and counts a lone "one" only when asked', () => {
    expect(keys('doubled revenue, tripled reach, twice the speed')).toEqual(['2x', '3x', '2x'])
    expect(keys('one team')).toEqual([])
    expect(keys('one team', { bareOne: true })).toEqual(['1'])
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

describe('unsupportedFigures by value, number words and multipliers', () => {
  it.each([
    ['Grew sales 14k units', 'Sold 14,000 units'],
    ['Saved £500k', 'Saved £500,000 a year'],
    ['Reached 1,000,000 users', 'Reached 1m users'],
    ['Reached 1.5m users', 'Reached 1.50m users'],
    ['Cut churn by 40%', 'Cut churn by forty percent'],
    ['Cut churn by forty percent', 'Cut churn by 40%'],
    ['Opened 5 markets', 'Opened five markets'],
    ['Opened five markets', 'Opened 5 markets'],
    ['Doubled revenue', 'Revenue doubled'],
    ['Revenue up 2x', 'Doubled revenue'],
  ])('accepts "%s" when the evidence says "%s"', (output, evidence) => {
    expect(unsupportedFigures(output, [evidence])).toEqual([])
  })

  it.each([
    ['Grew sales 15k units', 'Sold 14,000 units'],
    ['Opened five new markets', 'Opened markets in the region'],
    ['Opened a dozen markets', 'Opened 10 markets'],
    ['Doubled revenue', 'Grew revenue'],
    ['Tripled revenue', 'Doubled revenue'],
    ['Reached a hundred clients', 'Reached 10 clients'],
    ['Cut churn by 40%', 'Cut churn by 40 points'],
  ])('flags "%s" when the evidence says "%s"', (output, evidence) => {
    expect(unsupportedFigures(output, [evidence]).length).toBeGreaterThan(0)
  })

  it('reports number words and multipliers as written', () => {
    expect(unsupportedFigures('Opened five new markets and doubled revenue', ['Ran launches'])).toEqual(['five', 'doubled'])
  })

  it('does not flag letters-and-digits names, ordinals or 24/7', () => {
    expect(unsupportedFigures('B2B SaaS, GA4, Web3, Q3, 1st place, 24/7 operations', ['Ran launches'])).toEqual([])
  })

  it('does not flag digits inside a selected name, and still flags the same digits elsewhere', () => {
    expect(unsupportedFigures('Led ISO 27001 work', ['Ran audits'], ['ISO 27001'])).toEqual([])
    expect(unsupportedFigures('Led 27001 work', ['Ran audits'], ['ISO 27001'])).toEqual(['27001'])
  })

  it('does not treat a bare "one" in prose as a figure', () => {
    expect(unsupportedFigures('Built one platform for the group', ['Ran launches'])).toEqual([])
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

describe('short claimed names', () => {
  const opts = { evidenceText: 'Ran launches', requirementText: 'Experience of go-to-market and R&D' }

  it('does not read "C" in "C-suite", "R" in "R&D" or "Go" in "go-to-market"', () => {
    expect(claimedHits('Briefed the C-suite on R&D and go-to-market plans', ['C', 'R', 'Go'], opts)).toEqual([])
    expect(containsPhrase('Briefed the C-suite', 'C')).toBe(false)
    expect(containsPhrase('Worked on R&D', 'R')).toBe(false)
    expect(containsPhrase("the C's", 'C')).toBe(false)
    expect(containsPhrase('Go-to-market', 'Go')).toBe(false)
  })

  it('still finds a short name used as itself, case-sensitively', () => {
    expect(containsPhrase('Wrote services in Go and R.', 'Go')).toBe(true)
    expect(containsPhrase('Wrote services in Go and R.', 'R')).toBe(true)
    expect(containsPhrase('go for it', 'Go')).toBe(false)
    expect(claimedHits('Wrote services in Go', ['Go'], opts)).toEqual([{ name: 'Go', requested: false }])
  })

  it('does not mark "Go" as requested because the requirements say go-to-market', () => {
    expect(claimedHits('Wrote services in Go', ['Go'], { ...opts, requirementText: 'go-to-market experience' })).toEqual([{ name: 'Go', requested: false }])
    expect(claimedHits('Wrote services in Go', ['Go'], { ...opts, requirementText: 'Strong Go or Rust' })).toEqual([{ name: 'Go', requested: true }])
  })
})

describe('aliases (best effort)', () => {
  it('treats GA4 and Google Analytics as the same name, both ways', () => {
    expect(mentionsName('Set up Google Analytics', 'GA4')).toBe(true)
    expect(mentionsName('Set up GA4', 'Google Analytics')).toBe(true)
    expect(claimedHits('Set up Google Analytics', ['GA4'], { evidenceText: '', requirementText: 'GA4 reporting' })).toEqual([{ name: 'GA4', requested: true }])
    expect(claimedHits('Set up Google Analytics', ['GA4'], { evidenceText: 'Built GA4 reports', requirementText: '' })).toEqual([])
  })

  it('does not know aliases outside the small map (a known gap)', () => {
    expect(mentionsName('Used Tableau Desktop', 'Tableau Server')).toBe(false)
  })
})

describe('title-like phrases', () => {
  it('flags a capitalised title phrase that is not one of the candidate titles', () => {
    expect(titleLikePhrases('As Head of Delivery I ran releases', ['Program Manager'], '')).toEqual(['Head of Delivery'])
    expect(titleLikePhrases('Worked as a Senior Product Manager on launches', ['Program Manager'], '')).toEqual(['Senior Product Manager'])
    expect(titleLikePhrases('A Chief Operating Officer sponsored it', [], '')).toEqual(['Chief Operating Officer'])
  })

  it('lets through the candidate\'s own titles, titles in the evidence, and lower-case prose', () => {
    expect(titleLikePhrases('Head of Delivery at the group', ['Head of Delivery'], '')).toEqual([])
    expect(titleLikePhrases('Reported to the Head of Delivery', [], 'Reported to the Head of Delivery')).toEqual([])
    expect(titleLikePhrases('led delivery as head of operations', [], '')).toEqual([])
  })

  it('introducedNames reports them with the titles', () => {
    expect(introducedNames('As Head of Delivery I ran it', { titles: ['Program Manager'], companies: [] }, '').titles).toEqual(['Head of Delivery'])
  })
})

describe('credentialProblems', () => {
  const creds = [{ name: 'PMP', inProgress: true }, { name: 'CISM', inProgress: false }, { name: 'MBA', inProgress: true }]

  it('flags a held certification the evidence does not mention', () => {
    expect(credentialProblems('CISM-certified leader', creds, 'Ran audits')[0]).toMatchObject({ name: 'CISM', inProgress: false })
    expect(credentialProblems('CISM-certified leader', creds, 'Passed the CISM exam')).toEqual([])
  })

  it('fails "PMP-certified" for an in-progress PMP, and passes it with in-progress wording', () => {
    expect(credentialProblems('PMP-certified delivery leader', creds, '')[0]).toMatchObject({ name: 'PMP', inProgress: true })
    expect(credentialProblems('Delivery leader, currently studying for the PMP', creds, '')).toEqual([])
    expect(credentialProblems('Delivery leader (PMP in progress)', creds, '')).toEqual([])
  })

  it('requires the wording next to EVERY mention of an in-progress item', () => {
    expect(credentialProblems('Studying for the MBA. MBA-trained operator.', creds, '')).toHaveLength(1)
  })

  it('says nothing when no credential is named', () => {
    expect(credentialProblems('Delivery leader', creds, '')).toEqual([])
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

describe('helpers', () => {
  it('counts words and matches phrases', () => {
    expect(wordCount('  one two\nthree ')).toBe(3)
    expect(containsPhrase('Led C++ work', 'C++')).toBe(true)
    expect(containsPhrase('Led Java work', 'Jav')).toBe(false)
  })
})

describe('repeated figures (one figure, one place)', () => {
  it('treats percentages, multipliers and numbers of 100 or more as notable; small numbers and years are not', () => {
    const notable = (t: string) => figuresIn(t).filter(isNotableFigure).map((f) => f.key)
    expect(notable('Won 14,000+ votes, cut 40% and doubled revenue')).toEqual(['14000', '40%', '2x'])
    expect(notable('8 teams across 3 markets in 2019 and 12 months')).toEqual([])
    expect(notable('Reached 2,000 players and £500k')).toEqual(['2000', '500000'])
  })

  it('finds a figure stated twice, by value (14k = 14,000), however it is written', () => {
    expect(repeatedFigures(['Won the Unity Awards with 14,000+ attendees.', 'Brought 14k people to the awards.'])).toEqual(['14,000'])
    expect(repeatedFigures(['Cut cost by 40%.', 'Raised margin 25%.'])).toEqual([])
    expect(repeatedFigures(['Cut cost by forty percent.', 'A 40% saving.'])).toEqual(['forty percent'])
    expect(repeatedFigures(['8 teams.', '8 markets.'])).toEqual([]) // small numbers are coincidence
  })

  it('finds the figures a text shares with others', () => {
    expect(sharedFigures('Leader behind the 14,000+ awards.', ['Won 14k votes.', 'Cut 40%.'])).toEqual(['14,000'])
    expect(sharedFigures('Leader behind the awards.', ['Won 14k votes.'])).toEqual([])
  })

  it('lists the distinct notable figures of a text', () => {
    expect(distinctNotableFigures('Grew 40% and then 40% again, plus 2M users')).toEqual(['40%', '2M'])
  })
})

describe('competencyLabelProblem (short noun phrases, 2-5 words, no numbers)', () => {
  const b = { min: 2, max: 5 }
  it.each(['Go-to-market strategy', 'Stakeholder management', 'Cross-functional programme leadership', 'Product launch planning and execution'])('accepts "%s"', (l) => {
    expect(competencyLabelProblem(l, b)).toBeNull()
  })

  it('rejects a single word, a long phrase, a number and a sentence', () => {
    expect(competencyLabelProblem('Leadership', b)).toMatch(/one word/)
    expect(competencyLabelProblem('Led the whole cross functional programme delivery', b)).toMatch(/7 words/)
    expect(competencyLabelProblem('Delivered 14,000 attendee events', b)).toMatch(/has a number/)
    expect(competencyLabelProblem('Five year planning', b)).toMatch(/has a number/)
    expect(competencyLabelProblem('Shipped titles on time.', b)).toMatch(/sentence/)
    expect(competencyLabelProblem('', b)).toMatch(/empty/)
    expect(competencyLabelProblem('Top 10 lists', b)).toMatch(/has a number/)
    expect(competencyLabelProblem('Growth. Leadership', b)).toMatch(/sentence/)
  })

  it.each(['B2B product marketing', 'Web3 community growth', '3D art pipeline', 'Node.js tooling', 'Vue.js and Next.js delivery'])('accepts a name that carries digits or a dot inside a token: "%s"', (l) => {
    expect(competencyLabelProblem(l, b)).toBeNull()
  })
})

describe('projectReflected', () => {
  const p = { name: 'Enemies Demo Campaign' }
  it('is reflected when the text names the project (case, accents and punctuation ignored), or uses a distinctive word of its name', () => {
    expect(projectReflected('Led the Enemies Demo Campaign.', p)).toBe(true)
    expect(projectReflected('Ran the enemies-demo campaign for launch.', p)).toBe(true)
    expect(projectReflected('Ran an Enemies demo reaching 14,000+ players.', p)).toBe(true)
  })
  it('is not reflected by unrelated text, nor by generic words alone', () => {
    expect(projectReflected('Cut release time by 40% across 8 teams.', p)).toBe(false)
    // Two shared 5+ letter words used to count as covered.
    expect(projectReflected('Launched marketing campaign across social channels', p)).toBe(false)
    expect(projectReflected('Ran a demo campaign reaching 14,000+ players before launch.', p)).toBe(false)
  })
  it('ignores a word the employer\'s ordinary activity text already uses', () => {
    expect(projectReflected('Ran the Enemies programme.', p, 'Ran the Enemies programme for studio partners')).toBe(false)
    expect(projectReflected('Ran the Enemies programme.', p, 'Cut release time')).toBe(true)
  })
  it('a name of generic words only is reflected by its full name alone', () => {
    expect(projectReflected('Ran the demo campaign.', { name: 'Demo Campaign' })).toBe(true)
    expect(projectReflected('Ran a campaign.', { name: 'Demo Campaign' })).toBe(false)
  })
})
