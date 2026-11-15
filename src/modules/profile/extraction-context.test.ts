import { describe, expect, it } from 'vitest'
import { EXTRACTION_SYSTEM, extractionPrompt, noNotesMessage, projectSubject, roleSubject } from './extraction-context'

const role = { role: 'Lead', company: 'Acme', summary: 'Ran the team.', startDate: new Date('2020-03-10'), endDate: null }

describe('roleSubject', () => {
  it('frames a role as it always has been: facts with dates, "Present" when current', () => {
    const subject = roleSubject(role)
    expect(subject).toEqual({ body: 'Ran the team.', noun: 'role', facts: '**Lead** at Acme (Mar 2020 → Present)' })
    expect(roleSubject({ ...role, endDate: new Date('2022-06-01') }).facts).toBe('**Lead** at Acme (Mar 2020 → Jun 2022)')
  })

  it('reads an empty note as empty', () => {
    expect(roleSubject({ ...role, summary: null }).body).toBe('')
  })
})

describe('projectSubject', () => {
  it('reads the project\'s description and notes as one text, with the role it belongs to', () => {
    const subject = projectSubject({ name: 'Launch', description: 'A launch.', notes: 'We shipped it.', role: { role: 'Lead', company: 'Acme' } })
    expect(subject.body).toBe('A launch.\n\nWe shipped it.')
    expect(subject.noun).toBe('project')
    expect(subject.facts).toBe('**Launch** (part of Lead at Acme)')
  })

  it('has no "part of" for a project of its own, and tolerates a missing description', () => {
    const subject = projectSubject({ name: 'Side', description: '', notes: 'Notes only.' })
    expect(subject.facts).toBe('**Side**')
    expect(subject.body).toBe('Notes only.')
  })
})

describe('prompts', () => {
  it('keeps the role wording and swaps the noun for a project', () => {
    expect(EXTRACTION_SYSTEM('role')).toContain("the person's own work at this role.")
    expect(EXTRACTION_SYSTEM('project')).toContain("the person's own work on this project.")
    const prompt = extractionPrompt(roleSubject(role), 'Some prose')
    expect(prompt.startsWith('# Role context (already structured — do not re-extract these facts)\n\n**Lead** at Acme')).toBe(true)
    expect(prompt).toContain('# Unstructured notes to extract from\n\nSome prose\n')
    expect(extractionPrompt(projectSubject({ name: 'Launch', description: '', notes: 'x' }), 'p').startsWith('# Project context')).toBe(true)
  })

  it('tells the person what is missing in their own words', () => {
    expect(noNotesMessage('role')).toBe('Add some notes first — paste anything about this role and click Extract.')
    expect(noNotesMessage('project')).toContain('this project')
  })
})
