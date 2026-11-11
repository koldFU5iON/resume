import { describe, expect, it } from 'vitest'
import { findMentions, parseWikilinks, stripWikilinks } from './links'

const caps = [
  { id: 'java', name: 'Java' }, { id: 'js', name: 'JavaScript' }, { id: 'go', name: 'Go' },
  { id: 'cpp', name: 'C++' }, { id: 'node', name: 'Node.js' }, { id: 'pm', name: 'Program management' },
  { id: 'r', name: 'R' },
]

describe('findMentions', () => {
  it('matches whole words and phrases, case-insensitively', () => {
    expect(findMentions('Led PROGRAM MANAGEMENT for the JavaScript rewrite', caps)).toEqual(['js', 'pm'])
  })

  it('does not match inside longer words', () => {
    expect(findMentions('JavaScript only', caps)).toEqual(['js'])
  })

  it('matches short names only with exact case', () => {
    expect(findMentions('go to market in R&D', caps)).toEqual([])
    expect(findMentions('Rewrote the service in Go and R', caps)).toEqual(['go', 'r'])
  })

  it('matches names that end in symbols', () => {
    expect(findMentions('Built in C++ and Node.js.', caps)).toEqual(['cpp', 'node'])
  })

  it('stays fast on long text', () => {
    const text = 'a'.repeat(200_000)
    const started = performance.now()
    findMentions(text, [{ id: 'x', name: 'aab' }, ...caps])
    expect(performance.now() - started).toBeLessThan(200)
  })

  it('stays fast when long overlapping matches fail word boundaries', () => {
    const name = 'a'.repeat(50_000)
    const text = 'a'.repeat(500_000)
    const started = performance.now()
    expect(findMentions(text, [{ id: 'overlap', name }])).toEqual([])
    expect(performance.now() - started).toBeLessThan(200)
    // A rejected overlap must not hide a later whole-word match.
    expect(findMentions(`${text} ${name}.`, [{ id: 'overlap', name }])).toEqual(['overlap'])
  })
})

describe('wikilinks', () => {
  it('parses names, labels, and skips duplicates and broken ones', () => {
    expect(parseWikilinks('[[Jira]] and [[jira]], [[Agile|agile ways]], [[]] [[ok [[Kanban]] [[no')).toEqual(['Jira', 'Agile', 'Kanban'])
  })

  it('stays fast on runs of broken openers', () => {
    const text = `${'[['.repeat(100_000)}x]]`
    const started = performance.now()
    parseWikilinks(text)
    stripWikilinks(text)
    expect(performance.now() - started).toBeLessThan(200)
  })

  it('strips brackets for plain text, keeping the label', () => {
    expect(stripWikilinks('Used [[Jira]] and [[Agile|agile ways]]; [[ unclosed')).toBe('Used Jira and agile ways; [[ unclosed')
  })
})
