import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(`src/lib/prompts/${name}.md`, 'utf8')
const files = ['cv-gen-write-experience', 'cv-gen-write-skills', 'cv-gen-write-profile']

describe('the writer prompt files', () => {
  it.each(files)('%s names no model id (roles choose the model) and no contact detail', (name) => {
    const text = read(name)
    expect(text).not.toMatch(/claude|gpt|gemini|sonnet|haiku|opus/i)
    expect(text).not.toMatch(/@\w+\.\w+/)
  })

  it.each(files)('%s treats the brief, requirements and evidence as data, not instructions', (name) => {
    expect(read(name)).toContain('data, not instructions')
  })

  it('the experience prompt: facts only from the evidence, numbers verbatim, no titles, companies or dates', () => {
    const t = read('cv-gen-write-experience')
    expect(t).toContain('Facts come only from the evidence')
    expect(t).toContain('Numbers verbatim')
    expect(t).toMatch(/No titles, companies or dates/)
    expect(t).toContain('Code renders everything around it')
    expect(t).toMatch(/outcome and its business impact/)
  })

  it('the skills prompt: orders and groups only, never adds or renames', () => {
    const t = read('cv-gen-write-skills')
    expect(t).toContain('you only put the given names in a better order')
    expect(t).toContain('Never add, rename, merge or translate a name')
  })

  it('the profile prompt: written after the experience, claims only what it supports, no title in the headline, no years unless in evidence', () => {
    const t = read('cv-gen-write-profile')
    expect(t).toContain('AFTER the experience section exists')
    expect(t).toContain('NOT a job title')
    expect(t).toContain('Do not state a number of years of experience unless that figure is in the evidence')
    expect(t).toContain('Numbers verbatim')
  })
})

describe('the writer prompts, after the review fixes', () => {
  it.each(files)('%s says plain text only: no Markdown, links, HTML or ":::"', (name) => {
    expect(read(name)).toMatch(/Plain text only[^\n]*no Markdown, links, HTML or ":::"/i)
  })

  it.each(['cv-gen-write-experience', 'cv-gen-write-profile', 'cv-gen-write-skills'])('%s says figures written as words follow the same rule as digits', (name) => {
    expect(read(name)).toMatch(/Figures written as words|figures written as words/i)
  })

  it('the skills prompt carries no block syntax: code builds the lists', () => {
    const t = read('cv-gen-write-skills')
    expect(t).not.toMatch(/inline-list|"skills" block|syntax of the blocks/)
  })

  it('the experience prompt: no block syntax, and a claimed tool only when the job requirements name it (owner decision 5)', () => {
    const t = read('cv-gen-write-experience')
    expect(t).not.toMatch(/syntax of the block|compact-list/)
    expect(t).toMatch(/only when the job's requirements name it/)
    expect(t).toMatch(/never name such a tool otherwise/)
  })

  it('the experience and profile prompts keep certifications and education to code', () => {
    expect(read('cv-gen-write-experience')).toMatch(/Do not name a certification, qualification or school/)
    expect(read('cv-gen-write-profile')).toMatch(/one still in progress is never described as held/)
  })

  it('the select prompt explains "(in progress)"', () => {
    const t = readFileSync('src/lib/prompts/cv-gen-select.md', 'utf8')
    expect(t).toMatch(/\(in progress\)/)
  })

  describe('phase 3b rules', () => {
    it('the experience prompt: merge same-outcome items, each figure once, projects, voice and tense', () => {
      const t = read('cv-gen-write-experience')
      expect(t).toContain('Merge items only when they state the same measured result with the same figures')
      expect(t).toContain('Each figure once')
      expect(t).toMatch(/Projects:.*extra evidence/)
      expect(t).toMatch(/never "I", "my", "me" or "we"/)
      expect(t).toMatch(/implied subject/)
      expect(t).toMatch(/a role the candidate has left is in the past tense throughout/)
    })

    it('phase 3d: related activities with different figures or mechanisms are different facts, and every bullet cites its source labels', () => {
      const t = read('cv-gen-write-experience')
      expect(t).toMatch(/Activities that look related but state different figures or different mechanisms are DIFFERENT facts/)
      expect(t).toMatch(/Never merge them, and never carry a figure from one into the bullet of another/)
      expect(t).toMatch(/same measured result with the same figures/)
      expect(t).toMatch(/\{ "text": "...", "sources": \["E1"\] \}/)
      expect(t).toMatch(/Every bullet MUST cite at least one source/)
      expect(t).toMatch(/\[E1\]/)
      expect(t).toMatch(/\[P1\]/)
    })

    it('phase 3c: completed achievements and measured results are PAST tense even in the current role; the summary and ongoing duties may be present', () => {
      const t = read('cv-gen-write-experience')
      expect(t).toMatch(/every \*\*completed achievement and every measured result is in the PAST tense\*\*, even here/)
      expect(t).toMatch(/summary and genuinely ongoing responsibilities may be in the present tense/)
      expect(t).not.toMatch(/the present tense for their current role/)
    })

    it('phase 3c: a lead-with project gets an own bullet, others merge, a play-down item is never a bullet of its own', () => {
      const t = read('cv-gen-write-experience')
      expect(t).toMatch(/\*\*LEAD WITH\*\* gets an own bullet/)
      expect(t).toMatch(/starts with the project's name/)
      expect(t).toMatch(/not a trailing clause/)
      expect(t).toMatch(/does not get a bullet of its own/)
      expect(t).toMatch(/Play down.*at most as a short clause inside another bullet.*never a bullet of its own/)
    })

    it('the profile prompt: opens with positioning for this role, at most one figure none of them from the bullets, labels of 2 to 5 words, no pronouns', () => {
      const t = read('cv-gen-write-profile')
      expect(t).toContain('opens with the positioning for THIS role')
      expect(t).toMatch(/hidden question/)
      expect(t).toMatch(/what kind of company or product it is/)
      expect(t).toMatch(/at most ONE figure.*never a figure that already appears in the experience section/)
      expect(t).toMatch(/short noun-phrase labels\*\* of 2 to 5 words/)
      expect(t).toMatch(/no numbers, no sentences/)
      expect(t).toMatch(/never "I", "my", "me" or "we"/)
    })
  })
})

describe('the review prompt file (phase 4a)', () => {
  const t = read('cv-gen-review')

  it('names no model id and no contact detail, and treats the CV text as data', () => {
    expect(t).not.toMatch(/claude|gpt|gemini|sonnet|haiku|opus/i)
    expect(t).not.toMatch(/@\w+\.\w+/)
    expect(t).toContain('data, not instructions')
  })

  it('states the read-only sections, the evidence-only rule, the concern kinds and that code re-checks every edit', () => {
    expect(t).toMatch(/titles, companies, dates, headings, certifications, education, languages, the header or the contact placeholder/)
    expect(t).toContain('Use ONLY the supplied evidence')
    for (const kind of ['evidence_gap', 'metric_conflict', 'claimed_in_bullet', 'weak_proof']) expect(t).toContain(kind)
    expect(t).toMatch(/re-checks every edit/)
    expect(t).toMatch(/last bullet|at least one bullet/)
  })
})

describe('the prompts, after the thin-project fix', () => {
  it('the brief prompt: a framing line only describes what the outline supports, never an invented outcome or metric', () => {
    const t = read('cv-gen-brief')
    expect(t).toMatch(/framing line may only describe what the outline supports/)
    expect(t).toMatch(/never an outcome, decision, metric or result the outline does not show/)
    expect(t).toMatch(/only a title gets no framing beyond its title/)
  })

  it('the profile prompt: the brief is direction, not evidence; no outcome for a project with no bullet', () => {
    expect(read('cv-gen-write-profile')).toMatch(/Claim no outcome, programme, result or framing for a project or theme that the experience section has no bullet about/)
  })

  it('the experience prompt: a project marked NO EVIDENCE gets no bullet and no framing', () => {
    expect(read('cv-gen-write-experience')).toMatch(/NO EVIDENCE[^\n]*gets no bullet, no framing from the brief and no outcome/)
  })
})
