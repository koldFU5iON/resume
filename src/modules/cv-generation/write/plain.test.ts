import { describe, expect, it } from 'vitest'
import { hasFirstPerson, plainFeedback, plainLine, plainProblems, plainReasons } from './plain'

describe('plainLine', () => {
  it('strips images, keeps link text, and removes HTML tags', () => {
    expect(plainLine('See ![logo](https://evil.test/x.png) and [the report](https://x.test) <b>now</b><script>x</script>')).toBe('See and the report nowx')
  })

  it('removes headings, quotes and list markers at the start of a line', () => {
    expect(plainLine('# Title')).toBe('Title')
    expect(plainLine('> quoted')).toBe('quoted')
    expect(plainLine('- one')).toBe('one')
    expect(plainLine('* two')).toBe('two')
    expect(plainLine('first\n- second')).toBe('first second')
  })

  it('removes ":::" and "{{" markers wherever they are', () => {
    expect(plainLine('Led ::: the team')).toBe('Led the team')
    expect(plainLine(':::header')).toBe('header')
    expect(plainLine('Reach me at {{contact}} today')).toBe('Reach me at contact today')
  })

  it('keeps a "#1" ranking and ordinary hyphens', () => {
    expect(plainLine('Ranked #1 in the go-to-market league')).toBe('Ranked #1 in the go-to-market league')
  })

  it('removes emphasis and code marks silently', () => {
    expect(plainLine('**Led** __the__ `team`')).toBe('Led the team')
    expect(plainProblems('**Led** the team')).toEqual([])
  })

  it('collapses whitespace and newlines', () => {
    expect(plainLine('  a \n\n b\t c ')).toBe('a b c')
  })
})

describe('plainProblems / plainFeedback', () => {
  it('names what is wrong, and is empty for plain text', () => {
    expect(plainProblems('Plain text, 40% faster.')).toEqual([])
    expect(plainProblems('![x](http://a.test/i.png)')).toContain('links or images')
    expect(plainProblems('[a](http://b.test)')).toContain('links or images')
    expect(plainProblems('<img src=x>')).toContain('HTML tags')
    expect(plainProblems('- bullet')).toContain('a heading, quote or list marker')
    expect(plainProblems('Led :::block')).toContain('":::"')
    expect(plainProblems('Call {{contact}}')).toContain('"{{"')
  })

  it('is repeatable (no regex state leaks between calls)', () => {
    for (let i = 0; i < 3; i++) expect(plainProblems('[a](http://b.test)')).toContain('links or images')
  })

  it('builds the retry feedback line', () => {
    expect(plainFeedback('bullet 2', 'ok')).toBeNull()
    expect(plainFeedback('bullet 2', '[a](http://b.test)')).toMatch(/bullet 2 contains links or images; write plain text only/)
  })
})

describe('first person (the voice is an implied subject)', () => {
  it.each([
    'I led the migration.',
    'Led my team of five.',
    "I've shipped twelve titles.",
    'We cut release time by half.',
    'Our team launched it.',
    'The role gave me ownership.',
    'Built it myself.',
    'Delivered it. I also coached two juniors.',
  ])('flags "%s"', (text) => {
    expect(hasFirstPerson(text)).toBe(true)
    expect(plainProblems(text).join(' ')).toMatch(/first person/)
    expect(plainReasons(text)).toEqual(['first person'])
  })

  it.each([
    'Led the migration of 8 teams.',
    'Cut release time by 40%.',
    'Works with the US team.',
    'Owns the I/O layer.',
    'Medicine and metrics for ME markets.',
    'Mentored the team at Mercury.',
    'Raised our-of-pocket costs.'.replace('our-of', 'out-of'),
    'Weekly rhythm and wellness programmes.',
    'Go-to-market for the Meta ads platform.',
  ])('does not flag "%s"', (text) => {
    expect(hasFirstPerson(text)).toBe(false)
    expect(plainProblems(text)).toEqual([])
  })

  it('is repeatable (no regex state leaks between calls)', () => {
    for (let i = 0; i < 3; i++) expect(hasFirstPerson('I led it')).toBe(true)
  })

  it('names the voice in the retry feedback', () => {
    expect(plainFeedback('bullet 1', 'We shipped it')).toMatch(/bullet 1 contains first person.*write plain text only.*no "I", "my", "we"/)
  })

  it('cannot be fixed by the cleaner: the text is kept and the problem is reported (retry, then accept with a note)', () => {
    expect(plainLine('Led my team')).toBe('Led my team')
  })
})

describe('first person: verbatim names and roman numerals are not violations', () => {
  const evidence = [
    'Launched the My Talking Tom campaign', 'Shipped We Happy Few to console', "Licensed the \"I'm Lovin' It\" jingle", 'Published Our World in Data dashboards',
    'Ran the I Am Legend premiere', 'Led the "Me Too" campaign for the studio',
  ].join('\n')

  it.each([
    'Led the My Talking Tom launch.',
    'Shipped We Happy Few on three platforms.',
    "Reworked the I'm Lovin' It jingle.",
    'Built dashboards for Our World in Data.',
    'Hosted the I Am Legend premiere.',
    'Led the "Me Too" campaign.',
  ])('ignores a title taken verbatim from the evidence: "%s"', (text) => {
    expect(hasFirstPerson(text)).toBe(true) // without the evidence it is flagged
    expect(hasFirstPerson(text, evidence)).toBe(false)
    expect(plainProblems(text, evidence)).toEqual([])
  })

  it.each(['Delivered Phase I of the rollout.', 'Researched World War I memorials.', 'Surveyed Grade I listed buildings.', 'Phase I launched on time.', 'Played Final Fantasy I'])('ignores a roman-numeral I: "%s"', (text) => {
    expect(hasFirstPerson(text)).toBe(false)
  })

  it('still flags a real violation, even next to evidence text', () => {
    expect(hasFirstPerson('I led the My Talking Tom launch.', evidence)).toBe(true)
    expect(hasFirstPerson('Led my team on the Me Too campaign.', evidence)).toBe(true)
    expect(hasFirstPerson('We shipped it.', evidence)).toBe(true)
    expect(hasFirstPerson('Then I led the team.', evidence)).toBe(true)
    expect(hasFirstPerson('Led Team I managed.', evidence)).toBe(true)
    expect(plainReasons('We shipped it.', evidence)).toEqual(['first person'])
  })
})
