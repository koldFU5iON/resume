import { describe, expect, it } from 'vitest'
import { cleanProjectLine, projectEvidenceText } from './project-evidence'
import { INDEPENDENT_RESULT, independentProjectsFixture } from './__fixtures__/independent-projects'
import { evidenceFromVault, type IndependentProjectEvidence } from './write/evidence'
import { renderIndependentProject } from './write/render'
import { PROJECT_EVIDENCE_MAX_CHARS } from './write/limits'

function fallback(body: string) {
  const { vault, selection } = independentProjectsFixture()
  const note = vault.notes.get('assistant')!
  if (note.type !== 'project') throw new Error('Expected project')
  note.body = body
  note.props.description = ''
  return renderIndependentProject(evidenceFromVault(vault, selection).independentProjects.find(p => p.id === note.id)!)
}

describe('independent project output safety', () => {
  it('reads visible paragraph text and skips every task item, including checked tasks', () => {
    const rendered = fallback('Built support tooling to make customer handoffs reliable.\n<!--\nClient code 9988 is secret.\n-->\n\n- [ ] Could we claim 500 customers?\n- [x] Ask the owner about 700 customers.\n\nPublished operating guides so community contributors can maintain the tooling.')
    expect(rendered.markdown).toContain('Published operating guides')
    expect(rendered.markdown).not.toMatch(/9988|secret|500|700|claim|Ask the owner/)
  })

  it('removes complete balanced Markdown destinations and explicit contact variants', () => {
    const scrub = (text: string) => text
    expect(cleanProjectLine('[Pilot](../clients/(private)/pilot-99)', scrub)).toBe('Pilot')
    expect(cleanProjectLine('Built tooling; tel:+44 7700 900123; linkedin.com/in/other', scrub)).not.toMatch(/7700|900123|linkedin|other/)
    expect(cleanProjectLine('[+44 7700 900123](tel:+447700900123) Built tooling', scrub)).toBe('Built tooling')
    expect(cleanProjectLine('Published [operator guides](../clients/(private)/pilot-99) for contributors.', scrub)).toBe('Published operator guides for contributors.')
  })

  it('prints an embedded structured result once while retaining a distinct outcome', () => {
    const { vault, selection } = independentProjectsFixture()
    const note = vault.notes.get('workshop')!
    const atom = vault.notes.get('workshop-atom')!
    if (note.type !== 'project' || atom.type !== 'evidence') throw new Error('Expected project evidence')
    note.links = note.links.filter(link => link.id === atom.id)
    atom.props.description = `Built billing exports. ${INDEPENDENT_RESULT}`
    atom.props.impact = `${INDEPENDENT_RESULT}; Eliminated weekend reconciliation`
    const rendered = renderIndependentProject(evidenceFromVault(vault, selection).independentProjects[0])
    expect(rendered.markdown.split(INDEPENDENT_RESULT)).toHaveLength(2)
    expect(rendered.markdown).toContain('Eliminated weekend reconciliation')
  })

  it('omits whole oversized atoms and bounds the remaining output without truncating results', () => {
    const project: IndependentProjectEvidence = {
      id: 'p', name: 'Community tools', text: '', thin: false,
      atoms: [
        { id: 'huge', kind: 'achievement', text: 'Built tooling '.repeat(300), impact: INDEPENDENT_RESULT, highlighted: false },
        ...Array.from({ length: 40 }, (_, i) => ({ id: `a${i}`, kind: 'achievement' as const, text: `Built complete billing exports for contributor group ${i}`, impact: INDEPENDENT_RESULT, highlighted: false })),
      ],
    }
    const short = renderIndependentProject({ ...project, atoms: [{ id: 'award', kind: 'achievement', text: 'Won BAFTA', impact: null, highlighted: false }] })
    expect(short.markdown).toContain('Won BAFTA')
    const rendered = renderIndependentProject(project)
    expect(rendered.markdown.length).toBeLessThan(PROJECT_EVIDENCE_MAX_CHARS + 100)
    expect(rendered.bullets.length).toBeGreaterThan(0)
    expect(rendered.bullets.length).toBeLessThan(40)
    expect(rendered.bullets.every(b => b.text.includes(INDEPENDENT_RESULT))).toBe(true)
    expect(rendered.bullets.flatMap(b => b.sources.map(s => s.id))).not.toContain('huge')
    expect(rendered.notes.join(' ')).toMatch(/omitted.*budget/)
  })

  it('omits title-only and single-character accepted atoms rather than using unaccepted context', () => {
    const { vault } = independentProjectsFixture()
    const project = vault.notes.get('workshop')!
    const atom = vault.notes.get('workshop-atom')!
    if (project.type !== 'project' || atom.type !== 'evidence') throw new Error('Expected project evidence')
    project.links = project.links.filter(link => link.id === atom.id)
    for (const text of ['Workshop Campaign 18', 'x', '7']) {
      atom.props.description = text
      atom.props.impact = null
      atom.props.result = null
      const evidence = projectEvidenceText(project, vault, { forCvOutput: true })
      expect(evidence.thin).toBe(true)
      expect(renderIndependentProject({ id: project.id, name: 'Workshop Campaign 18', ...evidence }).markdown).toBe('')
    }
  })
})
