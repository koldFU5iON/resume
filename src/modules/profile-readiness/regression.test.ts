// Review of #432: the panel must stay quiet on legitimate profiles. Each case
// below is a legitimate profile that once produced a 'fix' finding.
import { describe, expect, it } from 'vitest'
import { checkProfileReadiness } from './index'
import { NOW, activity, certification, project, role, vaultOf } from './__fixtures__/profiles'

const fixes = (v: ReturnType<typeof vaultOf>) => checkProfileReadiness(v, NOW).findings.filter((f) => f.severity === 'fix').map((f) => f.kind)
const ok = { issuer: 'Example Institute', issued: '2020-01' }
const body = 'Owned delivery for the regional rollout: scoped the work with the business, ran a team of eight and reported to the steering group every month.'
const ev = (id: string, owner: string) => activity(id, { experienceId: owner }, 'achievement', `Delivered the ${id} work for the team`, 'In 3 weeks')

describe('no fix finding on legitimate profiles', () => {
  it('1. certification names that contain ordinary words, or carry a future issue date', () => {
    const v = vaultOf({ certifications: [
      certification('a', 'Ongoing Professional Development', ok),
      certification('b', 'Certificate in Expected Credit Loss (IFRS 9)', ok),
      certification('c', 'Customer Due Diligence Certificate', ok),
      certification('d', 'AWS Solutions Architect (in progress)', { issuer: 'Example Cloud', issued: '2027-03' }),
    ] })
    expect(fixes(v)).toEqual([])
    expect(checkProfileReadiness(v, NOW).findings.filter((f) => f.kind === 'cert_status_in_name')).toEqual([])
  })

  it('2. a role whose text lives in its projects', () => {
    const v = vaultOf({
      experiences: [role('e', 'Co', 'Lead', '2022-01', null, '', [])],
      projects: [project('p', 'Atlas', 'Moved the parcel tracking platform to a new vendor for every depot, with a phased cut-over, daily reporting and a rollback plan.', { experienceId: 'e' })],
    })
    expect(fixes(v)).toEqual([])
  })

  it('3. an old role with a short summary and no evidence', () => {
    const v = vaultOf({ experiences: [
      role('now', 'Current Co', 'Lead', '2022-01', null, body, [ev('a1', 'now')]),
      role('old', 'Old Co', 'Assistant', '2005-01', '2008-01', 'Short note about the role that is not long.', []),
    ] })
    expect(fixes(v)).toEqual([])
  })

  it('4. recurring or yearly projects with similar names', () => {
    const v = vaultOf({
      experiences: [role('e1', 'One Co', 'Lead', '2020-01', '2022-01', body, [ev('a1', 'e1')]), role('e2', 'Two Co', 'Lead', '2022-02', null, body, [ev('a2', 'e2')])],
      projects: [
        project('p1', 'Unity Awards 2024', 'Ran the yearly awards ceremony for the community, from the shortlist to the stage plan.', { experienceId: 'e2' }),
        project('p2', 'Unity Awards 2025', 'Ran the yearly awards ceremony for the community, from the shortlist to the stage plan.', { experienceId: 'e2' }),
        project('p3', 'Weekly report', 'Wrote the weekly delivery report for the board, covering risks, spend and the next two milestones.', { experienceId: 'e1' }),
        project('p4', 'Weekly report', 'Built the weekly sales report for the regional managers, from the raw order data to the final charts.', { experienceId: 'e2' }),
      ],
    })
    expect(fixes(v)).toEqual([])
  })
})
