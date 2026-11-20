import { describe, expect, it } from 'vitest'
import { toProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { buildVault, notesOf, PREFERENCES_NOTE_ID } from './build'
import { profileMap } from './map'
import { renderNote } from './render'
import { d, t, vaultSource } from './__fixtures__/source'
import type { CapabilityNote, EvidenceNote, ExperienceNote, ProjectNote } from './types'

const source = vaultSource

describe('buildVault', () => {
  const vault = buildVault(source())

  it('turns every row into a note, indexed by type', () => {
    expect(vault.byType.experience).toEqual(['e1'])
    expect(vault.byType.evidence).toEqual(['a1', 'a2'])
    expect(vault.byType.project).toEqual(['pr1'])
    expect(vault.byType.preferences).toEqual([PREFERENCES_NOTE_ID])
    expect(vault.identity.body).toContain('I run programs')
  })

  it('merges skills, tools and competencies into one capability set, de-duplicated by name', () => {
    const caps = notesOf(vault, 'capability')
    expect(caps.map((c) => `${c.props.kind}:${c.props.name}`)).toEqual([
      'skill:Release management', 'skill:Jira', 'skill:Agile', 'tool:Confluence', 'competency:Stakeholder management',
    ])
  })

  it('links narratives, evidence and capabilities, with computed backlinks', () => {
    const exp = vault.notes.get('e1')!
    expect(exp.links).toEqual([
      { type: 'contains', id: 'pr1' },
      { type: 'has', id: 'a1' },
      { type: 'has', id: 'a2' },
      { type: 'uses', id: 's2', via: 'confirmed' },
    ])
    expect(vault.notes.get('s1')!.backlinks).toEqual([{ type: 'demonstrates', id: 'a1' }])
  })

  it('derives links from exact mentions and [[wikilinks]], unless rejected', () => {
    const base = vaultSource()
    const exp = base.experiences[0]
    const v = buildVault(vaultSource({
      experiences: [{
        ...exp,
        summary: 'Rolled out [[Confluence]] and [[Kubernetes]] across teams.',
        activities: [
          { ...exp.activities[0], description: 'Moved planning into Jira', impact: null, skills: [] },
          { ...exp.activities[1], description: 'Ran agile ceremonies', skills: [{ skillId: 's3', status: 'rejected' }] },
        ],
      }],
    }))
    expect(v.notes.get('a1')!.links).toEqual([{ type: 'demonstrates', id: 's2', via: 'exact' }])
    // "Agile" is mentioned, but the user rejected that link.
    expect(v.notes.get('a2')!.links).toEqual([])
    expect(v.notes.get('e1')!.links).toContainEqual({ type: 'uses', id: 't2', via: 'wikilink' })
    expect(v.unresolved).toEqual([{ noteId: 'e1', name: 'Kubernetes' }])
    expect((v.notes.get('s2') as CapabilityNote).props.status).toBe('proven')
  })

  it('derives capability status from links', () => {
    const status = (id: string) => (vault.notes.get(id) as CapabilityNote).props.status
    expect(status('s1')).toBe('proven')
    expect(status('s2')).toBe('proven')
    expect(status('s3')).toBe('certified')
    expect(status('t2')).toBe('claimed')
  })

  it('narrows unknown evidence kinds to responsibility', () => {
    expect((vault.notes.get('a2') as EvidenceNote).props.kind).toBe('responsibility')
  })

  it('collapses project description and notes into one body', () => {
    expect(vault.notes.get('pr1')!.body).toBe('Quarterly release train.\n\nNotes about the train.')
  })
})

describe('project-owned evidence', () => {
  const base = vaultSource()
  const act = (id: string, description: string, order: number, over = {}) => ({
    id, experienceId: null, projectId: 'pr1', kind: 'achievement', description, impact: null, result: null, highlighted: false,
    order, tags: '[]', createdAt: t, updatedAt: t, skills: [], ...over,
  })
  const withEvidence = () => buildVault(vaultSource({
    projects: [{
      ...base.projects[0],
      highlights: '["Shipped 4 releases"]',
      activities: [act('pa1', 'Shipped 4 releases', 0), act('pa2', 'Ran Jira boards for the train', 1)],
    }],
  }) as never)

  it('builds evidence notes owned by the project, with derived links', () => {
    const v = withEvidence()
    expect(v.byType.evidence).toEqual(['a1', 'a2', 'pa1', 'pa2'])
    expect((v.notes.get('pa1') as EvidenceNote).props.parentId).toBe('pr1')
    // "Jira" is mentioned in the text, so the derived link exists.
    expect(v.notes.get('pa2')!.links).toEqual([{ type: 'demonstrates', id: 's2', via: 'exact' }])
  })

  it('links the project to its own evidence and keeps role edges to its own evidence only', () => {
    const v = withEvidence()
    expect(v.notes.get('pr1')!.links.filter((l) => l.type === 'has')).toEqual([
      { type: 'has', id: 'pa1' }, { type: 'has', id: 'pa2' },
    ])
    expect(v.notes.get('e1')!.links.filter((l) => l.type === 'has')).toEqual([
      { type: 'has', id: 'a1' }, { type: 'has', id: 'a2' },
    ])
    expect(v.notes.get('pa1')!.backlinks).toEqual([{ type: 'has', id: 'pr1' }])
  })

  it('uses evidence descriptions as project highlights, else the legacy column', () => {
    expect((withEvidence().notes.get('pr1') as ProjectNote).props.highlights).toEqual(['Shipped 4 releases', 'Ran Jira boards for the train'])
    expect((buildVault(source()).notes.get('pr1') as ProjectNote).props.highlights).toEqual(['Shipped 4 releases'])
    const bad = buildVault(vaultSource({ projects: [{ ...base.projects[0], highlights: '["ok", 3, "x"]' }] }))
    expect((bad.notes.get('pr1') as ProjectNote).props.highlights).toEqual(['ok', 'x'])
  })

  it('renders context, project evidence once under the project and role', () => {
    const v = withEvidence()
    expect(renderNote(v, 'pa1')).toContain('(Release train — Program Manager at Fictional Freight, Mar 2021 – present)')
    const project = renderNote(v, 'pr1')!
    expect(project).toContain('### Evidence\n- [achievement] Shipped 4 releases')
    expect(project.match(/Shipped 4 releases/g)).toHaveLength(1)
    const role = renderNote(v, 'e1')!
    expect(role).toContain('### Evidence from projects\n- [achievement] Shipped 4 releases')
    expect(role.match(/Shipped 4 releases/g)).toHaveLength(1)
    // Standalone project context is just its title.
    const standalone = buildVault(vaultSource({
      projects: [{ ...base.projects[0], experienceId: null, activities: [act('pa1', 'Shipped', 0)] }],
    }) as never)
    expect(renderNote(standalone, 'pa1')).toContain('(Release train)')
  })

  it('counts project achievements for the role and does not call role and project evidence duplicates', () => {
    const e1 = base.experiences[0]
    const v = buildVault(vaultSource({
      experiences: [{ ...e1, activities: [] }],
      projects: [{ ...base.projects[0], activities: [act('pa1', 'Launched the annual awards programme across four regions', 0)] }],
    }) as never)
    const messages = profileMap(v).gaps.map((g) => g.message)
    expect(messages.some((m) => m.includes('What did you achieve as Program Manager'))).toBe(false)
    const dup = buildVault(vaultSource({
      experiences: [{ ...e1, activities: [{ ...e1.activities[0], description: 'Launched the annual awards programme across four regions' }] }],
      projects: [{ ...base.projects[0], activities: [act('pa1', 'Launched the annual awards programme across four regions', 0)] }],
    }) as never)
    expect(profileMap(dup).gaps.map((g) => g.message).some((m) => m.includes('appears under both'))).toBe(false)
  })

  it('says in the role gist and map line when evidence comes from its projects', () => {
    const e1 = base.experiences[0]
    const pa = [act('pa1', 'Shipped', 0), act('pa2', 'Scaled', 1)]
    const withOwn = buildVault(vaultSource({ projects: [{ ...base.projects[0], activities: pa }] }) as never)
    expect(withOwn.notes.get('e1')!.gist).toContain('(+2 from projects)')
    const onlyProjects = buildVault(vaultSource({
      experiences: [{ ...e1, activities: [] }],
      projects: [{ ...base.projects[0], activities: pa }],
    }) as never)
    expect(onlyProjects.notes.get('e1')!.gist).toContain('2 evidence from projects')
    expect(profileMap(onlyProjects).entries.find((e) => e.id === 'e1')!.gist).toContain('2 evidence from projects')
    expect(buildVault(source()).notes.get('e1')!.gist).not.toContain('from projects')
  })

  it('words a duplicate between a standalone project and a role by what each parent is', () => {
    const e1 = base.experiences[0]
    const text = 'Launched the annual awards programme across four regions'
    const v = buildVault(vaultSource({
      experiences: [{ ...e1, activities: [{ ...e1.activities[0], description: text }] }],
      projects: [{ ...base.projects[0], experienceId: null, activities: [act('pa1', text, 0)] }],
    }) as never)
    const message = profileMap(v).gaps.map((g) => g.message).find((m) => m.includes('appears under both'))!
    expect(message).toContain('the project Release train')
    expect(message).toContain('Program Manager — Fictional Freight')
    expect(message).toContain('Which one does it belong to?')
    expect(message).not.toContain('Which role')
  })

  it('keeps the CV snapshot and its ## Projects text unchanged when evidence equals the old highlights', () => {
    const legacy = serializeProfileForLLM(toProfileSnapshot(buildVault(source())))
    const copied = serializeProfileForLLM(toProfileSnapshot(buildVault(vaultSource({
      projects: [{ ...base.projects[0], activities: [act('pa1', 'Shipped 4 releases', 0)] }],
    }) as never)))
    const section = (md: string) => md.slice(md.indexOf('## Projects'))
    expect(section(copied)).toBe(section(legacy))
    expect(copied).toBe(legacy)
    expect(section(copied)).toContain('- Shipped 4 releases')
    // Role activities stay role-owned: project evidence never appears under experience.
    const snap = toProfileSnapshot(buildVault(vaultSource({
      projects: [{ ...base.projects[0], activities: [act('pa1', 'Shipped 4 releases', 0)] }],
    }) as never))
    expect(snap.experiences[0].activities.map((a) => a.description)).toEqual(['Cut release time', 'Ran standups'])
  })
})

describe('renderNote', () => {
  const vault = buildVault(source())

  it('renders evidence self-contained, with its role context', () => {
    expect(renderNote(vault, 'a1')).toBe(
      '**Achievement** (Program Manager at Fictional Freight, Mar 2021 – present): Cut release time\n' +
      'Impact: 6 weeks → 2 weeks\nDemonstrates: Release management',
    )
  })

  it('scrubs contact details by default and includes them only on request', () => {
    const scrubbed = renderNote(vault, 'p1')!
    expect(scrubbed).not.toContain('robin@example.test')
    expect(scrubbed).not.toContain('+33')
    const full = renderNote(vault, 'p1', { pii: 'include' })!
    expect(full).toContain('robin@example.test')
    expect(full).toContain('github.com/robin')
  })

  it('lists a capability with the evidence behind it', () => {
    const md = renderNote(vault, 's1')!
    expect(md).toContain('Evidence:')
    expect(md).toContain('(Program Manager at Fictional Freight, Mar 2021 – present)')
  })

  it('returns null for an unknown id', () => {
    expect(renderNote(vault, 'nope')).toBeNull()
  })
})

describe('profileMap', () => {
  it('indexes every note and reports gaps as questions', () => {
    const map = profileMap(buildVault(source()))
    expect(map.counts.capability).toBe(5)
    expect(map.entries.find((e) => e.id === 'a1')).toMatchObject({ type: 'evidence', parentId: 'e1' })
    expect(map.entries.find((e) => e.id === 'pr1')).toMatchObject({ parentId: 'e1' })
    expect(map.gaps.map((g) => g.message)).toContainEqual(expect.stringContaining('PMP has expired'))
    expect(map.completeness).toBeGreaterThan(0)
    expect(map.completeness).toBeLessThanOrEqual(100)
  })

  it('flags overlapping roles at one company, duplicated evidence and unmatched wikilinks', () => {
    const base = vaultSource()
    const e1 = base.experiences[0]
    const a1 = e1.activities[0]
    const map = profileMap(buildVault(vaultSource({
      experiences: [
        { ...e1, summary: 'Worked with [[Kubernetes]].',
          activities: [{ ...a1, description: 'Launched the annual awards programme across four regions' }] },
        // Same company, starts a year into e1 (still running): a real overlap.
        { ...e1, id: 'e2', role: 'Senior Program Manager', startDate: d('2022-03'),
          activities: [{ ...a1, id: 'a9', experienceId: 'e2', description: 'Launched the annual awards programme across four regions.' }] },
        // Same company, starts within the three-month handover after e3 ends: fine.
        { ...e1, id: 'e3', company: 'Other Co', startDate: d('2015-01'), endDate: d('2016-01'), activities: [] },
        { ...e1, id: 'e4', company: 'Other Co', startDate: d('2015-11'), endDate: d('2017-01'), activities: [] },
      ],
    })))
    const messages = map.gaps.map((g) => g.message)
    expect(messages).toContainEqual(expect.stringMatching(/Program Manager and Senior Program Manager at Fictional Freight overlap/))
    expect(messages.filter((m) => m.includes('Other Co') && m.includes('overlap'))).toEqual([])
    expect(messages).toContainEqual(expect.stringMatching(/appears under both .* and /))
    expect(messages).toContainEqual(expect.stringContaining("[[Kubernetes]] in Program Manager — Fictional Freight doesn't match"))
  })

  it('flags an empty profile', () => {
    const map = profileMap(buildVault(source({
      headline: null, summary: null, experiences: [], projects: [], skills: [],
      educations: [], certifications: [], languages: [], settings: null,
    })))
    expect(map.gaps.map((g) => g.area)).toEqual(expect.arrayContaining(['identity', 'experience', 'capability', 'education', 'preferences']))
  })

  it('handles many long company names without pairwise normalization', () => {
    const vault = buildVault(source())
    const template = vault.notes.get('e1') as ExperienceNote
    vault.byType.experience = []
    for (let i = 0; i < 400; i++) {
      const id = `role-${i}`
      vault.byType.experience.push(id)
      vault.notes.set(id, {
        ...template, id, links: [],
        props: { ...template.props, company: `${'company '.repeat(3000)}${i}` },
      })
    }
    const started = performance.now()
    const map = profileMap(vault)
    expect(map.gaps.filter((g) => g.message.includes('overlap'))).toEqual([])
    // Leave room for concurrent CI workers; the pairwise version takes ~26 seconds.
    expect(performance.now() - started).toBeLessThan(3000)
  })

  it('bounds warnings when many roles overlap and says when results are omitted', () => {
    const vault = buildVault(source())
    const template = vault.notes.get('e1') as ExperienceNote
    vault.byType.experience = []
    for (let i = 0; i < 100; i++) {
      const id = `role-${i}`
      vault.byType.experience.push(id)
      vault.notes.set(id, {
        ...template, id, links: [],
        props: { ...template.props, role: 'Role'.repeat(1000), company: 'Company'.repeat(1000) },
      })
    }
    const warnings = profileMap(vault).gaps.filter((g) => g.message.includes('overlap'))
    expect(warnings.length).toBeLessThanOrEqual(101)
    expect(warnings.every((g) => g.message.length < 1000)).toBe(true)
    expect(warnings.at(-1)?.message).toContain('omitted')
  })

  it('finds nested overlaps in unsorted roles without losing a long-running role', () => {
    const base = source()
    const template = base.experiences[0]
    const experiences = [
      { id: 'late', role: 'Late', company: ' Acme ', startDate: d('2018-01'), endDate: d('2019-01') },
      { id: 'short', role: 'Handover', company: 'ACME', startDate: d('2015-01'), endDate: d('2015-02') },
      { id: 'outer', role: 'Outer', company: 'acme', startDate: d('2010-01'), endDate: d('2020-01') },
      { id: 'inner', role: 'Inner', company: 'acme', startDate: d('2012-01'), endDate: d('2013-01') },
    ].map((role) => ({ ...template, ...role, activities: [], skills: [] }))
    const warnings = profileMap(buildVault(source({ experiences }))).gaps.filter((g) => g.message.includes('overlap'))
    expect(warnings).toHaveLength(2)
    expect(warnings.map((g) => g.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('Outer and Inner'), expect.stringContaining('Outer and Late'),
    ]))
  })

  it('bounds duplicate-evidence text work and reports when the check is omitted', () => {
    const vault = buildVault(source())
    const atom = vault.notes.get('a1') as EvidenceNote
    vault.notes.set(atom.id, { ...atom, props: { ...atom.props, description: 'word '.repeat(30_000) } })
    expect(profileMap(vault).gaps.map((g) => g.message)).toContainEqual(
      expect.stringContaining('Duplicate evidence check omitted'),
    )
  })
})

describe('snapshot adapter', () => {
  const snapshot = toProfileSnapshot(buildVault(source()))

  it('gives every AI feature plain prose: [[wikilinks]] lose their brackets', () => {
    const base = vaultSource()
    const snap = toProfileSnapshot(buildVault(vaultSource({
      experiences: [{ ...base.experiences[0], summary: 'Moved the team to [[Jira|Jira Cloud]].',
        activities: [{ ...base.experiences[0].activities[0], description: 'Ran [[Agile]] rituals' }] }],
    })))
    expect(snap.experiences[0].summary).toBe('Moved the team to Jira Cloud.')
    expect(snap.experiences[0].activities[0].description).toBe('Ran Agile rituals')
  })

  it('keeps the legacy shape, now with summary, github and tools', () => {
    expect(snapshot.summary).toContain('I run programs')
    expect(snapshot.github).toBe('github.com/robin')
    expect(snapshot.tools).toEqual([{ name: 'Confluence', category: null }])
    expect(snapshot.skills.map((s) => s.name)).toEqual(['Release management', 'Jira', 'Agile'])
    expect(snapshot.experiences[0].activities.map((a) => a.description)).toEqual(['Cut release time', 'Ran standups'])
  })

  it('serializes without contact details unless asked', () => {
    const md = serializeProfileForLLM(snapshot)
    expect(md).not.toMatch(/robin@example\.test|\+33 6|linkedin\.com\/in\/robin/)
    expect(md).toContain('## Summary')
    expect(md).toContain('## Tools')
    expect(md).toContain('Mar 2021 – present')
    expect(serializeProfileForLLM(snapshot, { pii: 'include' })).toContain('robin@example.test')
  })
})

describe('contact scrubber', () => {
  it('removes contact values without collapsing other whitespace', async () => {
    const { makeContactScrubber } = await import('./pii')
    const scrub = makeContactScrubber({ email: 'robin@example.test', phone: null, linkedIn: null, github: null, website: null })
    expect(scrub('Line one  \n  - nested item\nMail: robin@example.test today')).toBe('Line one  \n  - nested item\nMail: today')
  })
})

describe('capLines', () => {
  it('keeps whole lines and says how many were dropped', async () => {
    const { capLines } = await import('./format')
    expect(capLines('aaaa\nbbbb\ncccc', 10, 'narrow it')).toBe('aaaa\nbbbb\n[1 more lines omitted; narrow it]')
    expect(capLines('short', 10)).toBe('short')
  })
})

describe('structured results', () => {
  const t0 = new Date('2026-01-01')
  const withResult = (result: unknown, impact: string | null) => {
    const src = vaultSource()
    src.experiences[0].activities = [{ id: 'r1', experienceId: 'e1', projectId: null, kind: 'achievement', description: 'Sped up asset hand-offs', impact, result, highlighted: false, order: 0, tags: '[]', createdAt: t0, updatedAt: t0, skills: [] }] as never
    const v = buildVault(src)
    return v.notes.get('r1') as import('./types').EvidenceNote
  }
  it('shows the structured result as the impact, with the figures once', () => {
    const e = withResult({ measure: 'asset turnaround time', value: '1 hour', baseline: '3 weeks' }, 'Cut from 3 weeks to 1 hour')
    expect(e.props.impact).toBe('asset turnaround time: 1 hour (from 3 weeks)')
    expect(e.props.result).toMatchObject({ value: '1 hour', baseline: '3 weeks', period: null })
    expect(e.gist).toContain('asset turnaround time: 1 hour')
  })
  it('keeps the free text when there is no result, and ignores an unreadable stored result', () => {
    expect(withResult(null, 'Cut release time').props.impact).toBe('Cut release time')
    const bad = withResult({ junk: 1 }, 'Cut release time')
    expect(bad.props.result).toBeNull()
    expect(bad.props.impact).toBe('Cut release time')
  })
})

describe('the independent experience', () => {
  const independent = () => {
    const base = vaultSource()
    return vaultSource({
      experiences: [
        ...base.experiences,
        { ...base.experiences[0], id: 'ind', company: 'Independent projects', role: 'Independent projects', type: 'independent', startDate: d('1970-01'), endDate: null, summary: '', activities: [], skills: [] },
      ],
    })
  }
  const vault = () => buildVault(independent())

  it('is a note with its type, and a normal job says employment', () => {
    expect(vault().notes.get('ind')).toMatchObject({ type: 'experience', props: { experienceType: 'independent' } })
    expect(vault().notes.get('e1')).toMatchObject({ props: { experienceType: 'employment' } })
  })
  it('is left out of the job-shaped map checks (no "add your work experience", no overlap, no thin-role gap)', () => {
    const gaps = profileMap(vault()).gaps
    expect(gaps.filter((g) => g.noteId === 'ind')).toEqual([])
    expect(gaps.map((g) => g.message).join('\n')).not.toMatch(/Independent projects/)
  })
  it('renders as a heading, not "role at company, dates", and shows no dates in the snapshot', () => {
    expect(renderNote(vault(), 'ind')).not.toMatch(/ at Independent|1970/)
    expect(renderNote(vault(), 'ind')).toContain('Independent projects')
    const exp = toProfileSnapshot(vault()).experiences.find((e) => e.type === 'independent')!
    expect(exp.role).toBe('Independent projects')
    expect(serializeProfileForLLM(toProfileSnapshot(vault()))).not.toMatch(/1970/)
  })
})

describe('the independent experience: wording', () => {
  it('has a plain title and gist, with no "at" and no dates', () => {
    const base = vaultSource()
    const v = buildVault(vaultSource({
      experiences: [...base.experiences, { ...base.experiences[0], id: 'ind', company: '', role: 'Independent projects', type: 'independent', startDate: d('1970-01'), endDate: null, summary: '', activities: [], skills: [] }],
    }))
    const note = v.notes.get('ind')!
    expect(note.title).toBe('Independent projects')
    expect(note.gist).toBe('Independent projects')
  })
  it('is not in the LLM text as a job: its own section, no dates', () => {
    const base = vaultSource()
    const v = buildVault(vaultSource({
      experiences: [...base.experiences, { ...base.experiences[0], id: 'ind', company: 'Independent projects', role: 'Independent projects', type: 'independent', startDate: d('1970-01'), endDate: null, summary: '', activities: [], skills: [] }],
    }))
    const text = serializeProfileForLLM(toProfileSnapshot(v))
    expect(text.indexOf('## Experience')).toBeLessThan(text.indexOf('## Independent projects'))
    expect(text.slice(text.indexOf('## Experience'), text.indexOf('## Independent projects'))).not.toContain('Independent projects')
  })
  it('does not push the map or readiness into "thin role" findings it cannot fix (checked via the overlap rule: same company twice is still a job pair only)', () => {
    const base = vaultSource()
    const v = buildVault(vaultSource({
      experiences: [...base.experiences, { ...base.experiences[0], id: 'ind', company: base.experiences[0].company, role: 'Independent projects', type: 'independent', startDate: d('2021-03'), endDate: null, summary: '', activities: [], skills: [] }],
    }))
    expect(profileMap(v).gaps.map((g) => g.message).join('\n')).not.toMatch(/alongside|overlap/i)
  })
})
